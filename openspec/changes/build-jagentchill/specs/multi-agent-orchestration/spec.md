## ADDED Requirements

### Requirement: Capability scope and Gateway dependency
Multi-agent orchestration SHALL provide two co-existing ways for several agents to work on one user goal: **free agents** (any agent creates, messages, waits for and hands work to other agents along an ownership tree) and **fixed-role teams** (a Supervisor → Lead → Peer run driven by a durable coordinator). Both ways share one agent record store, one hand-off/hand-back vocabulary, one approval policy object ("Common approval policy") and one oversight UI. Every feature of this capability needs a connected host that advertises the handshake feature `multi-agent`; without it the app SHALL hide the Team control, the Autonomous control, the Agents tab and the sub-agents track (hidden, not disabled) and SHALL keep them visible but disabled with the tooltip "Reconnect to the host to manage agents" while a previously connected host is disconnected. The local editor works unchanged without this capability. While the host is connected but its OpenClaw Gateway is not linked to the server, the server stays up: agent trees, rooms, boards and run state stay readable from the server's store, and every device action that needs an agent turn answers `GATEWAY_UNAVAILABLE` (`server-api.Gateway supervision and lifecycle`). Work the server itself drives — a team run, a worker and verifier loop, a heartbeat turn, an autonomous run, a queued delivery to an agent — is parked instead of failed, by the rule of `server-api.Job cancellation and restart recovery` as "Run recovery after Gateway restart" applies it: wait reason `waiting_gateway`, automatic continuation when the link is ready, failure with `GATEWAY_UNAVAILABLE` after 600 000 ms. [NEW] [JAD JD-CMP-018]

#### Scenario: Gateway without the feature
- **WHEN** the app connects to a Gateway whose `ready.features` lacks `multi-agent`
- **THEN** the composer shows no Team and no Autonomous control and the workspace new-tab page does not list "Agents"

#### Scenario: Connection lost during a team run
- **WHEN** channel P drops while a team run is `running`
- **THEN** the run continues on the Gateway, the Agents tab shows its last known state with a "Disconnected" banner, and every intervene action is disabled until `ready` is received again
- **AND** on reconnect the client pulls `jagentchill.agent.tree.get` and `jagentchill.orc.run.get` before re-enabling actions

### Requirement: Reused Gateway primitives and server-built parts
The server SHALL build this capability on these OpenClaw 2026.9.8 facts with no edit to OpenClaw and no code loaded into it. **Reused:** sessions as the unit of an agent (`sessions.create {parentSessionKey, spawnDepth, model, agentRuntime, thinkingLevel, permissionMode, cwd}`, `sessions.patch`, `sessions.abort`, `sessions.list`, event `sessions.changed`); runs started by the server with the Gateway's `agent` RPC (session key, message, extra system prompt and `idempotencyKey`; the model, runtime, working directory and an explicit `permissionMode` are fixed on the session beforehand with `sessions.create` / `sessions.patch`, `server-api.Agent session relay`) and awaited with `agent.wait` — the run path proven by execution is `sessions.create` followed by `chat.send`, and context injected with `chat.inject` or `chat.send.workContext` does not reach the model on a CLI runtime (`docs/decisions/0002-own-server-gateway-sidecar.md` rows 7 and 12), so whether the `agent` RPC and its extra system prompt reach the model is measured per runtime by spike S8, and on a runtime where they do not the server starts the run with `chat.send` and puts the role contract and brief at the head of the message text — (`gateway/openclaw/docs/gateway/protocol/rpc-talk-config-and-agents.md`); the agent tools `sessions_spawn`, `sessions_send`, `sessions_yield`, `subagents` and `agents_wait` when a runtime exposes them; `agents.create`/`agents.update` and `config.patch` for persona agents and allow-lists (`agents.entries.*.subagents.allowAgents`, `maxSpawnDepth`, `maxChildrenPerAgent`, `maxConcurrent`); the policy keys `tools.agentToAgent {enabled, allow}` and `tools.sessions.visibility`; the Gateway tool policy (`tools.allow | deny`, `agents.entries.<agentId>.tools.allow | deny`, `tools.subagents.tools.deny` and the per-session tool overrides of `sessions.patch`; `gateway/openclaw/docs/gateway/config-tools/tool-policy.md`, `gateway/openclaw/docs/gateway/sandbox-vs-tool-policy-vs-elevated.md`), which the server writes and the Gateway enforces; the Gateway's approval and question objects, which only the server answers over its link ("Approvals resolved by the server"); the Gateway events `agent` (whose tool items — `stream: "item"`, `kind: "tool"`, `phase: "start" | "end"` — carry `sessionKey`, `toolCallId` and the tool `name`), the approval events `plugin.approval.requested` and `exec.approval.requested` with their `.resolved` counterparts (delivered only to a link that declares the approval capabilities, `server-api.Gateway link`), `session.message` and `sessions.changed`, to which the server subscribes (`gateway/openclaw/docs/gateway/protocol/rpc-bootstrap-and-events.md`). The server has no hook inside the Gateway: a rule about a `jc_*` tool is enforced at the server's tool endpoint, where the server binds the call to its agent session from the Gateway-reported tool call (`server-api.Agent tool endpoint and session binding`), and a rule about a native OpenClaw tool is enforced by tool policy written before the run and by approval answers. Every one of these Gateway calls is made by the server over its gateway link (`server-api.Gateway link`); no device connects to the native Gateway channel or holds an OpenClaw scope (design D7), so each device request reaches this capability as a `jagentchill.agent.*` or `jagentchill.orc.*` method on channel P and is relayed under "Device access to agent sessions" (`server-api.Gateway link`, `server-api.Agent session relay`). **Built by the server:** the agent record store and tree, ownership checks, the `jc_agent_*`, `jc_room_*`, `jc_board_*`, `jc_team_*`, `jc_loop_*`, `jc_heartbeat_*`, `jc_review_submit` and `jc_autonomous_report` tools, hand-off and hand-back, rooms, the board, the Team model, the team coordinator and its durable run state, the approval policy evaluator, the agent writer token, usage roll-up and every UI surface. Behaviours that rest on unverified Gateway behaviour SHALL name their gating spike of design D18 and fallback in the requirement that uses them. Calls over the gateway link to admin-gated Gateway methods (`agents.create`, `config.patch`) are gated by spike S12; when S12 fails the server SHALL perform them by running the Gateway's own `openclaw` command against the managed state directory, initiated by an `admin` device action (`jagentchill.agent.config.apply`) or by the server's host CLI `jagentchill`, and SHALL report "Host approval needed to change agent configuration" to non-admin callers. [NEW]

#### Scenario: Child run started by the server
- **WHEN** an agent calls `jc_agent_create` with a valid request
- **THEN** the server creates a Gateway session with `parentSessionKey` set to the caller's session key and starts the first turn with the Gateway's `agent` RPC carrying an `idempotencyKey`
- **AND** no file under `gateway/openclaw/` is modified or added

#### Scenario: Admin-scoped call unavailable
- **WHEN** spike S12 has recorded that requests over the gateway link cannot reach admin-gated Gateway methods and an `editor` device saves a new team persona
- **THEN** the save fails with `SCOPE_DENIED` and the message "Host approval needed to change agent configuration"
- **AND** the same action from an `admin` device succeeds through `jagentchill.agent.config.apply`, which runs the Gateway's own host command

### Requirement: Agent record
Every agent visible to this capability SHALL have exactly one record in the server host store (`jagentchill.sqlite`, table `agents`): `{id ("agt_" + 26-character ULID), sessionKey, gatewayAgentId, personaId, title (1–60 characters), class: "creative" | "workspace", origin: "user" | "agent" | "team" | "workflow" | "automation" | "native" | "runtime", parentId?, rootId, depth (0–5), ownerDeviceId?, access: "host" | "private", ownerAgentId?, labels, runtime, provider, model, thinking?, mode, permissionMode, projectId?, workspaceId?, cwd?, state, waitingReason?, attention: "none" | "approval" | "question" | "handoff" | "error", lastMessagePreview (0–280 characters), usage {inputTokens, outputTokens, costUsd, costKnown}, budget {limitUsd?, reservedUsd, spentUsd}, created_ms, updated_ms, finished_ms?, archived_ms?, detached_ms?}`. A root agent (depth 0) is the agent of a chat session of `chat-agent.Agent sessions run on Gateway sessions`; its `ownerDeviceId` is the device that created the session (for a root started by an automation or a workflow, the device recorded by `automations.Start-session instruction` or the device that started the workflow run) and its `access` mirrors the session record of `server-api.Session ownership and visibility`, which is the owner of both fields (default `private`); descendants carry their root's `ownerDeviceId` and `access`. `sessionKey` is unique among non-purged records. The record is the single source the UI, the tools and the coordinator read; the client MUST NOT derive tree structure from session keys. [NEW] [JAD JD-ORC-018]

#### Scenario: Record created for a new chat session
- **WHEN** a device creates a chat session
- **THEN** a record exists with `depth: 0`, `rootId` equal to its own `id`, `origin: "user"`, `ownerDeviceId` equal to that device, `access: "private"` and no `parentId`

#### Scenario: Duplicate session key
- **WHEN** a second record is inserted for a `sessionKey` that already has a non-purged record
- **THEN** the insert is rejected with `ALREADY_EXISTS` and no second record exists

### Requirement: Agent classes and creation privileges
Each agent SHALL belong to one of the two classes of design D25. A **creative** agent runs a `jagentchill-*` persona whose effective tools are JAgentChill tools only (`agent-editing-tools.Tool policy profile`); it is the default for every creation path. A **workspace** agent runs a CLI/ACP runtime or the built-in runtime with file and exec tools in a workspace directory (`workspaces-terminal.Workspace agents run in the workspace directory`). Which runtimes make a session workspace-class, including the one carve-out for CLI and ACP runtimes that can run with JAgentChill tools only, is decided by `agent-runtimes.Creative sessions on CLI and ACP runtimes`. A workspace agent SHALL be created only when the root of its tree was created by a device with role `admin`, or by a device with role `editor` while the host setting "Allow workspace agents for editors" (`agents.allowWorkspaceAgentsForEditors`, default false, changed with scope `jagentchill.config.write`; this key is the single definition of that setting for every capability) is on. A child's class MUST NOT exceed its parent's: a creative agent requesting a workspace child is refused with `AGENT_CLASS_DENIED`. The class of an agent is fixed when it is created and is never raised by an agent: no tool call of any agent (`jc_agent_set_model {runtime}`, `jc_agent_handoff` with a created receiver, `jc_agent_create`, a loop, a heartbeat, a schedule proposal) and no automation or workflow edit made without the workspace privilege turns a creative agent, or a creative tree, into a workspace one; each such attempt is refused with `AGENT_CLASS_DENIED` and written to the `security` audit class. A person changes the class of an existing session only through `agent-runtimes.Switch runtime operation`, from a device that holds the workspace privilege and is permitted to act on the session by "Device access to agent sessions". When the host setting is turned off, workspace-class sessions owned by `editor` devices are frozen for their owner: records and transcripts stay readable by that owner, running turns are aborted within 5 s, and sending, steering and approving from an `editor` device are refused (`SCOPE_DENIED`, message "Workspace agents are limited to admin devices on this host"). Devices with role `viewer` cannot create, message, stop or change any agent; they can view records, timelines and team runs only of creative-class sessions that were explicitly shared with the host (`access: "host"`). Starting any agent turn requires scope `jagentchill.agent.use` and act access to the session. [NEW]

#### Scenario: Editor without the host setting
- **WHEN** an `editor` device asks to create a workspace agent and `agents.allowWorkspaceAgentsForEditors` is false
- **THEN** the request fails with `SCOPE_DENIED` and the composer's runtime list shows workspace runtimes dimmed with the reason "Only an admin device can start workspace agents on this host"

#### Scenario: Creative parent asks for a workspace child
- **WHEN** a creative agent calls `jc_agent_create` with `class: "workspace"`
- **THEN** the tool returns `ok: false` with `error.code: "AGENT_CLASS_DENIED"` and no session is created

#### Scenario: Viewer watches a run
- **WHEN** a `viewer` device opens a session that has a running team
- **THEN** it sees the roster, timelines and run panel read-only and every intervene control is absent

### Requirement: Device access to agent sessions
Every device request about an agent — list, read a timeline, prompt, steer, interrupt, stop, close, archive, change mode, model, runtime or thinking, answer a question, an approval or a hand-off, or any action of "Intervene actions" — SHALL arrive on the single client channel (`server-api.Single client channel`) and be relayed by the server, the only client of the Gateway (`server-api.Agent session relay`, design D7, D25). An agent tree has one owner and one visibility: those of its root session's record in `server-api.Session ownership and visibility` (`ownerDeviceId`, `ownerState`, `agentClass`, `access`), which this capability does not redefine; every member of the tree, every team run whose home session is that root, every room, board topic, loop, heartbeat and autonomous run of the tree is read and acted on under that record's read and act rules, evaluated against the caller's current device record on every call. Consequences this capability relies on:

| Tree root | Read (roster, timelines, run panel, rooms, board) | Act (every action method of "Agent RPC surface and events") |
|---|---|---|
| any session, caller is its owner | yes | yes with `jagentchill.agent.use`; in a workspace-class tree only while the owner is `admin`, or `editor` with `agents.allowWorkspaceAgentsForEditors` on — with the setting off the editor owner keeps read access and cannot send, steer or approve |
| caller is an `admin` that is not the owner | yes | yes |
| creative-class, `access: "private"` (the default of every new session), caller is neither owner nor `admin` | no — the agents are absent from lists and answer `AGENT_NOT_FOUND` | no |
| creative-class, `access: "host"` (the owner or an admin shared it with `jagentchill.session.access.set`) | every device with `jagentchill.projects.read`, a `viewer` included | `editor` devices with `jagentchill.agent.use`; never a `viewer` |
| workspace-class (always `private`), caller is an `editor` that is not the owner, or a `viewer` | no | no, whatever the host setting |

A refusal for a readable tree is `SCOPE_DENIED` with `details.reason: "not_owner"` or `details.requiredRole`, audited with outcome `denied`. An `editor` device therefore cannot prompt, steer, stop or approve in a workspace-class session owned by another device under any setting, and cannot create a workspace-class session while the host setting is off. **Initiator of a turn.** Every turn of every member is started by the server, which records its initiator per `server-api.Run initiator attribution and host-execution gating`; a turn started by an agent, a completion notification, a hand-back, a heartbeat or a schedule is attributed to the tree (`initiator.kind: "agent"`, or `"automation"`), and its `permitted.hostExec` is true only while the tree's owner device — for an automation, the device of its `workspaceGrant` (`automations.Start-session instruction`) — is still allowed to act in the workspace-class root at that instant; the gate of that requirement then refuses exec, process, file-write, `jc_terminal_*` and `jc_workspace_script_*` calls of any run without it (`jc_*` calls at the server's tool endpoint; native calls by the approval answer the server gives), and a session on a workspace runtime that has no server record is never listed, adopted or driven. **Owner revoked.** When the owner device is revoked (`device-pairing-signing.Revocation`), the root becomes `orphaned`: the running turns that device started are aborted, and every team run, loop, autonomous run, heartbeat and scheduled automation it started or owns is cancelled or disabled with reason `device_revoked` (`endReason` / `stopReason` / `pausedReason: "device_revoked"`); work started in the same tree by other devices continues; an orphaned tree is readable by `admin` devices only and no turn starts in it until an admin assigns a new owner. Relay fidelity per runtime is gated by spike S21; a runtime that fails it is not offered. [NEW]

#### Scenario: Editor prompts an admin's workspace session
- **WHEN** an `editor` device calls `jagentchill.agent.send` naming an agent of a workspace-class session owned by an `admin` device, with "Allow workspace agents for editors" on
- **THEN** the call fails with `AGENT_NOT_FOUND`, no turn starts, and a `denied` audit record names the device

#### Scenario: New session is private
- **WHEN** an `editor` device creates a creative session and a `viewer` device and a second `editor` device list agents
- **THEN** neither sees the session; after the owner shares it with the host both can read it, the second editor can prompt it, and the viewer cannot

#### Scenario: Host setting turned off
- **WHEN** an admin turns "Allow workspace agents for editors" off while an `editor`-owned workspace session is running
- **THEN** its turn is aborted within 5 s, that editor can still open the session and read its timeline, and a prompt or an approval answer from it fails with `SCOPE_DENIED`

#### Scenario: Run without a permitted initiator
- **WHEN** a workspace-class session executes a command tool in a run whose record lacks `permitted.hostExec: true`
- **THEN** the command does not run — the server answers the Gateway's approval request for it with a denial whose reason starts `SCOPE_DENIED:` — and a `security` audit record is written

#### Scenario: Owner device revoked
- **WHEN** the device that started a team run and an autonomous run is revoked while both are running, and another device started a loop in the same host
- **THEN** the team run is `cancelled` with `endReason: "device_revoked"`, the autonomous run is `stopped` with `stopReason: "device_revoked"`, their running turns were aborted, and the other device's loop continues

### Requirement: Personas for agents
Every agent SHALL run a persona: one of the shipped personas of `chat-agent.Default agent personas`, a user copy of one, or a team-role persona generated from a Team (see "Team roles and tiers"). A persona resolves to a Gateway agent entry `agents.entries.jagentchill-<personaId>` holding its instructions, tool allow-list, skill list and the ORC role whose default route supplies provider, model and thinking (`orc-model-routing.Mapping onto Gateway agent and provider configuration`). Creating a persona agent entry that is absent uses `agents.create` followed by a config mutation for `tools`, `skills` and `subagents` (gated by spike S12, fallback as in "Reused Gateway primitives and server-built parts"). The persona shown for an agent is `{personaId, name, avatarGlyph, roleLabel?}`; an agent whose persona was deleted keeps running with the snapshot of instructions taken at creation and shows the name with the suffix "(removed)". [NEW]

#### Scenario: Child uses a different persona
- **WHEN** the Director creates a child with `persona: "screenwriter"`
- **THEN** the child record has `personaId: "screenwriter"`, `gatewayAgentId: "jagentchill-screenwriter"` and its provider and model come from the `screenwriter` role default route unless the request overrides them

#### Scenario: Unknown persona
- **WHEN** `jc_agent_create` names a persona id that does not exist
- **THEN** the tool fails with `INVALID_PARAMS` and `details.field: "persona"` listing up to 20 valid ids

### Requirement: Parentage and the agent tree
An agent created by another agent SHALL record that creator as `parentId` and inherit its `rootId`; `depth` is the parent's depth plus 1. The set of records sharing one `rootId` is a **tree**. `ownerAgentId` equals `parentId` at creation and changes only through an accepted hand-off (see "Hand-off effects on ownership and lead"). Parentage never changes when a child is placed in a different workspace or bound to a different project: placement and parentage are independent. Tree membership is durable across Gateway restarts and across runtime or model changes of any member. The server exposes the tree through `jagentchill.agent.tree.get {rootId | agentId, includeArchived?}` returning the records in depth-first order with at most 200 records per page (`server-api.List pagination`). [JAD JD-MA-003, JD-MA-011] [NEW]

#### Scenario: Three-level tree
- **WHEN** root R creates A, and A creates B
- **THEN** B has `parentId` A, `rootId` R and `depth` 2, and `jagentchill.agent.tree.get {rootId: R}` returns R, A, B in that order

#### Scenario: Child placed in another workspace
- **WHEN** A creates B with a `workspaceId` different from A's
- **THEN** B's `parentId` is still A and B is listed in A's sub-agents track

### Requirement: Agent labels
Agents SHALL carry string labels `{key: value}`. System labels are written only by the server: `jc.origin`, `jc.parent`, `jc.root`, `jc.project`, `jc.workspace`, `jc.team.run`, `jc.team.brief`, `jc.team.role`, `jc.team.tier`, `jc.team.route`, `jc.team.profile`, `jc.team.assignment`, `jc.loop`, `jc.workflow.run`, `jc.workflow.node`, `jc.automation`. User labels are set by a human or by `jc_agent_create`/`jc_agent_update`: at most 16 per agent, key matching `^[a-z][a-z0-9._-]{0,39}$` and not starting with `jc.`, value 0–120 characters. An attempt to write a `jc.`-prefixed label through a tool or RPC is rejected with `INVALID_PARAMS`. Team membership, role and assignment are decided from system labels plus the run record, never from the agent's title or prompt text. [JAD JD-ORC-018] [NEW]

#### Scenario: Peer labels
- **WHEN** a Lead creates a Peer for route `edit` in run `run_1`, brief `brf_1`, assignment `asg_3` with profile `editor-main`
- **THEN** the Peer's labels contain `jc.team.run=run_1`, `jc.team.brief=brf_1`, `jc.team.tier=peer`, `jc.team.role=editor`, `jc.team.route=edit`, `jc.team.profile=editor-main`, `jc.team.assignment=asg_3`

#### Scenario: Tool tries to forge a team label
- **WHEN** an agent calls `jc_agent_create` with `labels: {"jc.team.tier": "lead"}`
- **THEN** the call fails with `INVALID_PARAMS` and no agent is created

### Requirement: Agent lifecycle states
An agent's `state` SHALL be one of: `creating` (session being prepared), `idle` (no turn running, last turn ended without error), `running` (a turn is executing), `waiting` (a turn is blocked; `waitingReason` is `approval`, `question`, `children`, `handoff` or `slot`), `failed` (the last turn ended with an error; the agent accepts a new prompt), `closed` (terminated; accepts no prompt). `archived_ms` and `detached_ms` are flags independent of `state`. Allowed transitions: `creating → idle | running | failed`; `idle → running | closed`; `running → idle | waiting | failed | closed`; `waiting → running | idle | failed | closed`; `failed → running | closed`. A cancellation is reflected (`running → idle`) only after the Gateway acknowledges `sessions.abort`; a rejected abort leaves the agent `running` and returns `AGENT_BUSY` to the caller. State is derived from the Gateway run, tool and approval events the server receives over its gateway link (`agent`, including its tool items, and `session.approval`) and persisted within 500 ms of the event. The UI maps states onto the fixed vocabulary of `design-system.Avatar, badge and status pill`: `creating` → Queued, `running` → Working, `waiting`/`approval` → Needs approval, other `waiting` → Paused (with the reason as secondary text: "Waiting for sub-agents", "Waiting for your answer", "Waiting for hand-off", "Waiting for a free agent slot"), `idle` → Ready, `failed` → Failed, `closed` → Completed, and cancelled-last-turn → Cancelled. [NEW] [JAD JD-MID-012]

#### Scenario: Child waits for its own children
- **WHEN** agent A ends its turn with `sessions_yield` or `jc_agent_wait {mode: "notify"}` while two children run
- **THEN** A's state is `waiting` with `waitingReason: "children"` and its pill reads "Paused" with the secondary text "Waiting for sub-agents"

#### Scenario: Abort not acknowledged
- **WHEN** a stop is requested and the Gateway rejects `sessions.abort`
- **THEN** the agent stays `running`, the requester receives `AGENT_BUSY`, and the stop button returns from "Stopping…" to "Stop" with the toast "The agent did not stop. Try again."

### Requirement: Tree limits
The server SHALL enforce these limits before creating any agent: `maxDepth` (deepest allowed `depth`; default 3, range 1–5), `maxConcurrentChildren` (children of one agent in state `creating`, `running` or `waiting`; default 4, range 1–20), `maxConcurrentAgentsPerTree` (members of one tree in those states; default 8, range 1–32) and `maxAgentsPerTree` (default 24, range 1–200). The first three count records that are neither `closed` nor archived. `maxAgentsPerTree` counts agents created in the tree, including closed and archived ones, within one **counting window**: for a tree whose root is a team Supervisor, the window is the current run (agents carrying that run's `jc.team.run` label, the Supervisor excluded), so that every new run of a reused Supervisor starts at zero; for every other tree it is the tree's lifetime. Worker and verifier agents of finished loop iterations ("Worker and verifier loops") and members disposed at the end of an earlier run ("Team run state machine") are not counted. Violations return `AGENT_LIMIT_DEPTH`, `AGENT_LIMIT_CHILDREN`, `AGENT_LIMIT_CONCURRENT` or `AGENT_LIMIT_TOTAL` with `details {limit, current}` and create nothing. The limits are host settings changed with scope `jagentchill.config.write` on the "Agents" settings page (`jagentchill.agent.limits.set`); a Team's own limits (see "Team limits") apply in addition inside a team run, and the stricter value wins. The only extension is by a person: a device with scope `jagentchill.agent.use` that can act on the tree ("Device access to agent sessions") raises `maxAgentsPerTree` for one tree — for a Supervisor tree, for its current run — by 24 at a time, up to 200, with `jagentchill.agent.limits.raise {rootId}` from the limit banner ("This session reached its agent limit (24). Allow 24 more"); no agent, automation or workflow can call it. There is no other reset of the count. [NEW]

#### Scenario: Depth limit
- **WHEN** an agent at depth 3 calls `jc_agent_create` with the default `maxDepth` of 3
- **THEN** the call fails with `AGENT_LIMIT_DEPTH`, `details: {limit: 3, current: 3}`

#### Scenario: Total limit and human extension
- **WHEN** the 25th agent of a tree is requested with `maxAgentsPerTree` 24
- **THEN** the call fails with `AGENT_LIMIT_TOTAL` and the root session shows the limit banner
- **AND** after the user presses "Allow 24 more" the same request succeeds

#### Scenario: Finished children free a concurrent slot
- **WHEN** an agent has 4 children of which one becomes `idle`
- **THEN** a fifth `jc_agent_create` succeeds because only 3 children count against `maxConcurrentChildren`

#### Scenario: Third run of a reused Supervisor
- **WHEN** two earlier runs of the same Supervisor created 13 agents each and a third run starts with `maxAgentsPerTree` 24
- **THEN** the third run's count starts at 0 and its Lead and first Peer are created without `AGENT_LIMIT_TOTAL`

### Requirement: Limits mapped onto Gateway configuration
At server start and after every change of the tree limits, the server SHALL write the matching Gateway keys for every `jagentchill-*` agent entry through config mutation: `subagents.maxSpawnDepth` = `maxDepth`, `subagents.maxChildrenPerAgent` = `maxConcurrentChildren`, `subagents.maxConcurrent` = `maxConcurrentAgentsPerTree`, and `subagents.allowAgents` = the persona ids the agent's policy preset permits. The server's own counters remain authoritative and are applied where the server is in the call path: every `jc_agent_create`, `jc_team_bootstrap_lead` and `jc_team_create_peer` is checked at the tool endpoint before any Gateway call. A native `sessions_spawn` does not pass through the server, so it is bounded in two steps: the Gateway refuses it at the projected keys, and for a bound the keys cannot express (`maxAgentsPerTree`) the server corrects after the fact — when it adopts a native child ("Adoption of natively spawned sessions") that puts the tree over a server counter, it aborts the child's run (`sessions.abort`), archives the child within 1 s of the adoption, delivers `AGENT_LIMIT_TOTAL: <message>` to the parent as a system notice on its next turn and writes a `denied` audit record; the child's first turn can have started in that interval, which the notice states. Agents that must never spawn natively (every member of a team run, every creative agent) have `sessions_spawn`, `sessions_send` and `subagents` denied by tool policy instead ("Team shape enforcement at the tool endpoint"). Whether the Gateway keys alone hold a three-tier shape, and whether the correction completes within 1 s, is gated by spike S14; when S14 fails, native `sessions_spawn` and `subagents` are denied by tool policy for every agent the server manages and `jc_agent_create` is the only way to create a child. The projection is idempotent and touches only `jagentchill-*` entries. [NEW]

#### Scenario: Limit change is projected
- **WHEN** an `admin` device sets `maxDepth` to 2
- **THEN** within 5 s every `agents.entries.jagentchill-*.subagents.maxSpawnDepth` reads 2 and no other agent entry changed

#### Scenario: Native spawn beyond the server counter
- **WHEN** a workspace agent on the built-in runtime calls native `sessions_spawn` while its tree already has `maxAgentsPerTree` members
- **THEN** the server adopts the new child, aborts and archives it within 1 s, and the parent's next turn carries a notice starting with `AGENT_LIMIT_TOTAL:`

### Requirement: Adoption of natively spawned sessions
When a session appears in `sessions.changed` with a `parentSessionKey` that belongs to a known agent record and no record exists for it, the server SHALL adopt it within 1 s as a record with `origin: "native"`, the parent's `rootId`, class and project binding, and SHALL apply all ownership, limit and policy rules to it from then on. Native `sessions_send` calls between known agents do not pass through the server; they are bounded by the Gateway keys the policy preset projects (`tools.sessions.visibility`, `tools.agentToAgent`, "Policy presets"), which the Gateway enforces itself, and each one the server observes as a tool item of the Gateway's `agent` events is recorded on both agents' timelines and counted by "Loop prevention". A session whose parent is unknown to the server is ignored. What `sessions.changed` reports for nested children is gated by spike S14; fallback: the server lists `sessions.list` every 5 s for trees that have a member in state `running` and adopts from that list. [NEW]

#### Scenario: Native child appears in the tree
- **WHEN** a workspace agent spawns a child with native `sessions_spawn`
- **THEN** within 1 s (or 5 s on the polling fallback) the child is listed in the parent's sub-agents track with the badge "Native"

#### Scenario: Native send outside policy
- **WHEN** an agent calls native `sessions_send` to a session in another tree under the `tree` preset
- **THEN** the Gateway refuses the call under `tools.sessions.visibility: "tree"`, no message is delivered, and the server records the refused attempt it observed with code `AGENT_POLICY_DENIED`

### Requirement: Runtime-native sub-agents
Sub-agents that a runtime creates inside its own loop without a Gateway session (for example a CLI runtime's internal task tool) SHALL be shown as records with `origin: "runtime"` kept in a separate table, derived from the runtime's tool and item events. They are read-only: their pane has a timeline and no composer, and they cannot be messaged, stopped individually, detached, archived, rewound, forked or handed work. They appear in the parent's sub-agents track with the badge "Runtime". "Archive finished" hides finished runtime rows for the current app session only; a hidden row reappears when it runs again. They count toward neither tree limits nor policy checks, and their usage is included in the parent's. Event availability per runtime is gated by spike S8 and published as flag `subAgents` in `agent-runtimes.Published capability matrix`; a runtime that emits no such events shows no runtime rows. [JAD JD-MA-015]

#### Scenario: Read-only pane
- **WHEN** the user opens a runtime sub-agent row
- **THEN** a pane opens with its timeline, the header note "Managed by the <runtime label> runtime — read-only" and no composer or row menu actions other than "Close"

#### Scenario: Hidden row runs again
- **WHEN** the user pressed "Archive finished" and a hidden runtime sub-agent emits a new event
- **THEN** its row reappears in the track with state Working

### Requirement: Archive, close and cascade
`archive` SHALL be a soft delete: it sets `archived_ms`, interrupts a running turn first, removes the agent from default lists and tracks, keeps its transcript and record, and is reversible with "Restore" for 30 days, after which the record and its session are purged (`sessions.patch {archived: true}` at archive time; session deletion at purge). Archiving cascades recursively to every descendant except descendants that were detached or that are the current `ownerAgentId` target of an accepted hand-off from outside the subtree; those are detached instead. Closing a sub-agent's tab is layout only and changes no record. Closing a root agent's session tab asks "Archive this session?" with the extra line "<n> sub-agents are still running and will be stopped" when any descendant is `running` or `waiting`, and archives on confirm. `close` (terminate) moves the agent to `closed` without archiving: it accepts no further prompt and keeps its place in the tree. Archive and close of a root require a device with scope `jagentchill.agent.use`; an `autoArchive: true` agent is archived automatically 5 s after its first turn reaches a terminal event. [JAD JD-MA-012, JD-MA-013, JD-MA-008] [NEW]

#### Scenario: Cascade
- **WHEN** agent A with children B and C (C has child D) is archived
- **THEN** A, B, C and D all have `archived_ms` set, running turns among them were aborted first, and none of them appears in default lists

#### Scenario: Detached child survives
- **WHEN** B was detached before A is archived
- **THEN** B keeps running and has no `archived_ms`

#### Scenario: Closing a sub-agent tab
- **WHEN** the user closes the tab of a running sub-agent
- **THEN** the sub-agent keeps running and stays in the track

### Requirement: Detach
`detach` SHALL remove an agent from its parent: `parentId` and `ownerAgentId` are cleared, `detached_ms` is set, the agent becomes the root of its own tree (its descendants follow with recomputed `rootId` and `depth`), and nothing else changes — it keeps running, keeps its project, workspace and cwd, and leaves the former parent's track. Detach is a human action only (`jagentchill.agent.detach {agentId}`, scope `jagentchill.agent.use`; the detaching device becomes `ownerDeviceId`); no agent tool performs it, and a team member with an `active` assignment cannot be detached (`TEAM_SHAPE_VIOLATION`). Pending completion notifications from the detached agent to its former parent are cancelled. [JAD JD-MA-013]

#### Scenario: Detach a running child
- **WHEN** the user chooses "Detach" on a running sub-agent
- **THEN** it disappears from the parent's track, appears in the sidebar session list as its own session, and continues its turn uninterrupted

#### Scenario: Detach inside a team run
- **WHEN** the user tries to detach a Peer whose assignment is `active`
- **THEN** the request fails with `TEAM_SHAPE_VIOLATION` and the message "Cancel or reassign this assignment before detaching the agent"

### Requirement: Agent store durability and restart recovery
Agent records, rooms, board topics, hand-offs, loops, heartbeats, autonomous runs and team runs SHALL be stored in the server host store and written in transactions through one serialised writer, so that a crash leaves either the previous or the next consistent state. At server service start the server SHALL reconcile every non-archived record with `sessions.list` within 10 s: a record whose session no longer exists becomes `closed` with `attention: "error"` and the note "Session missing after host restart"; a record that was `running`, `creating` or `waiting` and has no active Gateway run becomes `failed` with the timeline item "Interrupted by a host restart"; waiters (`jc_agent_wait`, `jc_room_wait`) are dropped and their callers, when prompted again, read state through the status tools. Armed completion notifications survive the restart and fire when the child next reaches a terminal state. [NEW] [JAD JD-ORC-017]

#### Scenario: Restart during a child turn
- **WHEN** the Gateway restarts while child B is `running` with a completion notification armed for parent A
- **THEN** after start B is `failed` with the item "Interrupted by a host restart" and A receives exactly one completion notification reporting `outcome: "failed"`, `reason: "host_restart"`

#### Scenario: Crash between two writes
- **WHEN** the process is killed while a hand-off acceptance is being stored
- **THEN** after restart the hand-off is either still `pending` with the old owner or `accepted` with the new owner, never a mix

### Requirement: Agent RPC surface and events
The server SHALL expose on channel P, under the closed domains `agent` and `orc` of `server-api.RPC naming and schema ownership`: reads (scope `jagentchill.projects.read`) `jagentchill.agent.list` (per session tree by default; `scope: "host"` for the list of "Host-wide Agents screen"), `.agent.get`, `.agent.tree.get`, `.agent.activity.get`, `.agent.handoff.list`, `.agent.room.list`, `.agent.room.read`, `.agent.board.get`, `.agent.board.diagram.get` (one stored diagram version), `.agent.loop.list`, `.agent.loop.get`, `.agent.heartbeat.list`, `.agent.autonomous.get`, `.orc.team.list`, `.orc.team.get`, `.orc.run.list`, `.orc.run.get`, `.orc.approval.get`; actions (scope `jagentchill.agent.use`, and act access to the tree per "Device access to agent sessions") `jagentchill.agent.send`, `.agent.stop`, `.agent.close`, `.agent.archive`, `.agent.restore`, `.agent.detach`, `.agent.update`, `.agent.setMode`, `.agent.setModel`, `.agent.reassign`, `.agent.stopAll` (`{rootId | runId}`), `.agent.limits.raise` (`{rootId}`), `.agent.delivery.resume` (`{rootId}`), `.agent.writer.take` (`{projectId}`) (scope `jagentchill.projects.write`), `.agent.handoff.create`, `.agent.handoff.resolve`, `.agent.handback.resolve` (`{handbackId, decision: "accept" | "return", note?}`), `.agent.room.create`, `.agent.room.post`, `.agent.room.update` (`{roomId, name?, purpose?, retentionDays?}`), `.agent.room.delete`, `.agent.room.restore` (`{roomId}`), `.agent.room.message.remove` (`{roomId, messageId}`), `.agent.board.post`, `.agent.board.vote`, `.agent.board.task.create`, `.agent.board.task.update`, `.agent.board.review.post`, `.agent.board.stage.set` (`{topicId, stage, note?}`), `.agent.loop.start`, `.agent.loop.stop`, `.agent.heartbeat.delete`, `.agent.autonomous.start`, `.agent.autonomous.stop`, `.orc.brief.prepare`, `.orc.run.start`, `.orc.run.answerBrief` (`{runId, answers[] | brief}`), `.orc.run.pause`, `.orc.run.resume`, `.orc.run.cancel`, `.orc.run.replaceLead`, `.orc.run.resolveEscalation`, `.orc.run.raiseLimit` (`{runId, limit: "maxAssignmentsPerBrief" | "maxConcurrentPeersPerLead"}`) (the second value needs `jagentchill.config.write`), `.orc.run.showResult` (`{runId}`), `.orc.signoff.resolve` (`{approvalId, decision: "approve" | "request_changes" | "reject", note?}`); configuration (scope `jagentchill.config.write`) `jagentchill.orc.team.save`, `.orc.team.delete`, `.orc.team.reset`, `.orc.approval.set`, `.agent.policy.set`, `.agent.limits.set`, `jagentchill.agent.config.apply` (`{change}`; `admin` devices only; performs a pending agent-configuration change through the Gateway's own host command when spike S12 fails, "Reused Gateway primitives and server-built parts"). Side-effecting actions accept `idempotencyKey` (`server-api.Idempotency of side-effecting RPCs`). Targeted events: `jagentchill.agent.updated` (stream `agent:<rootId>`), `jagentchill.agent.room.message` (stream `room:<roomId>`), `jagentchill.agent.board.updated` (stream `board:<topicId>`), `jagentchill.orc.run.updated` (stream `run:<runId>`); each carries the changed record or a `{id, rev}` pointer, at most 4 events per second per stream with terminal changes never dropped, and each stream has the pull RPC named above. These lists are the complete human-facing surface of the two domains, apart from the sub-namespaces that `server-api.RPC domain ownership` delegates to another capability — `agent.persona.*` to `chat-agent.Persona list and editor`, and `orc.config.*`, `orc.restore.*`, `orc.test.*`, `orc.override.*`, `orc.readiness.*` and the definition of `orc.brief.prepare` to `orc-model-routing.ORC RPC surface` —: every human action another requirement of this capability describes is one of these methods, or is named in that requirement as a method of another capability (pausing, resuming and running a heartbeat once are the enable and run methods of `automations.Enable and disable` and `automations.Trigger now`; "Open as workflow" reads the diagram with `.agent.board.diagram.get` and creates the draft through `agent-workflows`). The agent turn itself (prompting, streaming, steering, aborting) is relayed by the server on channel P: `jagentchill.agent.send` and `.agent.stop` apply the role, session-ownership, class and policy checks of "Device access to agent sessions", write the audit record and then call the Gateway method over the gateway link; the streaming of a pane follows `chat-agent.Stream event envelope with seq and epoch`. No method of this capability is reachable on any other channel. [NEW]

#### Scenario: Viewer calls an action
- **WHEN** a `viewer` device calls `jagentchill.agent.stop`
- **THEN** the response is `ok: false` with `error.code: "SCOPE_DENIED"` and the agent keeps running

#### Scenario: Event gap
- **WHEN** a client receives `jagentchill.agent.updated` with `seq` 12 after `seq` 9 on stream `agent:agt_R`
- **THEN** it calls `jagentchill.agent.tree.get {rootId: "agt_R"}` and replaces its local tree with the result

#### Scenario: Every human action has a method
- **WHEN** the contract test `rpc-ownership` lists the human actions named in this capability (accept or return a hand-back, resolve a sign-off, raise a limit, resume delivery, stop all, rename or restore a room, remove a room message, create a board task, post a review, change the stage, read a diagram version, read a loop)
- **THEN** each maps to exactly one method of the lists above

### Requirement: Multi-agent error codes
This capability SHALL add these domain codes, referenced by name from the registry of `server-api.RPC error envelope` and returned in the tool envelope of `agent-editing-tools.Result envelope`: `AGENT_NOT_FOUND`, `AGENT_NOT_OWNED`, `AGENT_POLICY_DENIED`, `AGENT_CLASS_DENIED`, `AGENT_ARCHIVED`, `AGENT_CLOSED`, `AGENT_BUSY`, `AGENT_LIMIT_DEPTH`, `AGENT_LIMIT_CHILDREN`, `AGENT_LIMIT_CONCURRENT`, `AGENT_LIMIT_TOTAL`, `AGENT_LOOP_DETECTED`, `HANDOFF_NOT_PENDING`, `HANDOFF_TARGET_INVALID`, `ROOM_NOT_FOUND`, `ROOM_NAME_TAKEN`, `ROOM_CURSOR_UNKNOWN`, `ROOM_MENTION_LIMIT`, `BOARD_NOT_FOUND`, `BOARD_STAGE_DENIED`, `TEAM_DISABLED`, `TEAM_NOT_FOUND`, `TEAM_RUN_NOT_FOUND`, `TEAM_ROLE_DENIED`, `TEAM_SHAPE_VIOLATION`, `TEAM_TOPOLOGY_VIOLATION`, `TEAM_LEAD_UNHEALTHY`, `TEAM_NO_PEER_ROUTE`, `TEAM_LIMIT_CONCURRENT_PEERS`, `TEAM_LIMIT_ASSIGNMENTS`, `TEAM_DISSENT_ROUND_USED`, `BRIEF_NEEDS_CLARIFICATION`, `WRITER_HELD`, `LOOP_NOT_FOUND`, `HEARTBEAT_NOT_OWNED`. Runtime-related refusals use the `runtime/*` codes of `agent-runtimes.Error mapping` (`runtime/mode-not-inheritable`, `runtime/unattended-not-granted`, `runtime/unsupported-capability`) and are not duplicated here. `retryable` is true only for `AGENT_BUSY`, `AGENT_LIMIT_CHILDREN`, `AGENT_LIMIT_CONCURRENT`, `TEAM_LIMIT_CONCURRENT_PEERS` and `WRITER_HELD`. Messages are written for the model: they state what was refused and which tool or action to use instead. When the server denies a Gateway approval request for a native tool call, the denial reason it gives is `<CODE>: <message>`. [NEW]

#### Scenario: Message names the alternative
- **WHEN** a team Peer calls `jc_agent_create`
- **THEN** the error is `TEAM_ROLE_DENIED` with a message that says the Peer role cannot create agents and that work is returned with `jc_agent_handback`

#### Scenario: Retryable flag
- **WHEN** `jc_team_create_peer` fails because three Peers are active with a concurrent limit of 3
- **THEN** the error is `TEAM_LIMIT_CONCURRENT_PEERS` with `retryable: true` and `details: {limit: 3, active: 3}`

### Requirement: Agent management tool delivery
The agent-management tools SHALL form the tool family `agent` (plus `room`, `board`, `team`, `loop`, `heartbeat`, `autonomous`) served as MCP tools by the server's tool endpoint (`server-api.Agent tool endpoint and session binding`), which agents see under the prefix their runtime adds (`agent-editing-tools.Tool naming and families`). The MCP tool list is the same for every caller, because the Gateway's MCP client sends no session identity; the catalogue **per caller** is therefore produced in two places. The server writes, for each agent entry and each session it creates, a Gateway tool allow-list naming exactly the `jc_*` tools of that caller's catalogue (in the prefixed form of the session's runtime) (the role-scoped subset inside a team run, see "Role-scoped team tools"), so that tools outside it are not offered to the model; and the endpoint resolves the calling session by binding the call's MCP connection to the agent session whose Gateway-reported tool call matches (the tools take no caller-identity parameter) — a call that cannot be bound fails with `SESSION_UNBOUND`, and a call to a tool outside the caller's catalogue fails with `TOOL_NOT_AVAILABLE` whatever the model was offered. Names follow `agent-editing-tools.Tool naming and families`, which is the index of every `jc_*` family; their behaviour is defined here. The built-in runtime reaches them through the Gateway's own MCP client; CLI and ACP runtimes receive the same MCP server definition through the Gateway's projection for that runtime when the runtime's flag `jcTools` is `native` or `bridge` (`agent-runtimes.Capability flags per runtime`). The host switch "Agent management tools" (`agents.tools.enabled`, default true, scope `jagentchill.config.write`) removes the whole family from every catalogue; a change takes effect at the next turn of each session, and the settings row states "Applies from each agent's next turn". Every tool uses the common parameter conventions, result envelope, idempotency keys and audit record of `agent-editing-tools.Common parameter conventions`, `agent-editing-tools.Result envelope`, `agent-editing-tools.Idempotency keys` and `agent-editing-tools.Audit log`. [JAD JD-MA-001] [NEW]

#### Scenario: Switch turned off
- **WHEN** an `admin` device turns "Agent management tools" off and an agent starts its next turn
- **THEN** that turn's effective tool list (`tools.effective`) contains no `jc_agent_*`, `jc_room_*`, `jc_board_*` or `jc_team_*` tool

#### Scenario: Runtime without JAgentChill tools
- **WHEN** a session runs on a runtime whose flag `jcTools` is `none`
- **THEN** the composer's Team and Autonomous controls are dimmed with the reason "This runtime cannot use JAgentChill tools" and the agent cannot be chosen as a team member

### Requirement: Ownership checks along the tree
Every tool or RPC that reads or acts on another agent SHALL be authorised against the tree before it has any effect. For an agent caller C and target T: **act** (send, cancel, close, archive, update, set mode, set model, answer permissions) is allowed only when T is a descendant of C whose chain of `ownerAgentId` links leads to C, or when the active policy preset grants act on T (see "Who-can-call-whom policy presets"); **read** (status, activity, list) is allowed for C itself, its ancestors' identity fields (`id`, `title`, `personaId`, `state` only), its descendants, and whatever the preset adds. An agent can never act on its own ancestors except to send them a message through `jc_agent_handback`, `jc_agent_send` to its direct owner, or a room. A refused act returns `AGENT_NOT_OWNED` (target inside the caller's readable set) or `AGENT_NOT_FOUND` (outside it — the response does not reveal that the id exists). A device caller is not limited by tree position; it is limited by role, scope, session ownership and class exactly as "Device access to agent sessions" states, for every act and every read. Every refusal is written to the audit log with outcome `denied`. [NEW]

#### Scenario: Sibling tries to cancel a sibling
- **WHEN** child B calls `jc_agent_cancel` on its sibling C under the `tree` preset
- **THEN** the result is `AGENT_NOT_OWNED`, C keeps running, and an audit record with `outcome: "denied"` exists

#### Scenario: Unknown or foreign id
- **WHEN** an agent calls `jc_agent_status` with the id of an agent in another tree under the `tree` preset
- **THEN** the result is `AGENT_NOT_FOUND`

#### Scenario: Grandparent acts on grandchild
- **WHEN** root R, owner of A, which owns B, calls `jc_agent_cancel` on B
- **THEN** the call succeeds because B's ownership chain leads to R

### Requirement: Who-can-call-whom policy presets
The host SHALL have one active policy preset, default `tree`:

| Preset | Read | Send / wait | Act (cancel, close, archive, update, set mode/model, answer permission) | Gateway keys written |
|---|---|---|---|---|
| `tree` (default) | self, descendants, ancestor identity | descendants; direct owner | owned descendants | `tools.sessions.visibility: "tree"`, `tools.agentToAgent.enabled: false` |
| `team` | `tree` + every member of the same team run or board topic | `tree` + members of the same team run or topic, within the shape rules of "Team shape enforcement at the tool endpoint" | owned descendants | `tools.sessions.visibility: "tree"`, `tools.agentToAgent {enabled: true, allow: [persona agent ids of enabled Teams]}` |
| `all` | every non-archived agent on the host whose project the root's owner device can read | same set | owned descendants only | `tools.sessions.visibility: "all"`, `tools.agentToAgent {enabled: true, allow: [all jagentchill-* agent ids]}` |

Act is never widened by a preset. Under `team` and `all`, cross-tree sends through native `sessions_send` are bounded only by the projected Gateway keys of the preset, and team members have native `sessions_send` denied by tool policy. The preset widens only what the table states; class rules, limits, budgets and team shape always apply. `all` exposes other sessions' transcripts to agents, so selecting it requires the admin confirmation and the audit record of "Policy preset admin setting". [NEW]

#### Scenario: Default preset
- **WHEN** a fresh host starts
- **THEN** the preset is `tree`, `tools.sessions.visibility` reads `"tree"` and an agent listing agents sees only itself and its descendants

#### Scenario: Team preset lets peers message each other
- **WHEN** the preset is `team` and Peer P1 calls `jc_agent_send` to Peer P2 of the same run with a Team whose `peerMessaging` is `direct`
- **THEN** the message is delivered and recorded in the run's message log

#### Scenario: All preset does not widen act
- **WHEN** the preset is `all` and an agent calls `jc_agent_archive` on an agent of another tree
- **THEN** the result is `AGENT_NOT_OWNED`

### Requirement: Policy preset admin setting
The preset SHALL be changed only by a device with scope `jagentchill.config.write` on Settings → Agents → "Who agents can call" (a three-option radio group with one-line descriptions: "Same session tree", "Team members", "Every agent on this host") through `jagentchill.agent.policy.set {preset, confirm?}`. Selecting `all` ("Every agent on this host") SHALL require an explicit confirmation by an `admin` device: the dialog "Let agents reach every agent on this host?" states "Agents will be able to read and message every agent on this host, including sessions started on other devices.", lists the number of sessions and projects that become reachable, and enables "Allow" only after the admin ticks "I understand that agents can read other sessions' transcripts"; the RPC then carries `confirm: "all"`, and a call with `preset: "all"` without it fails with `INVALID_PARAMS` (`details.reason: "confirmation_required"`). No agent, tool, automation, workflow or host CLI command can set `all`; a device below `admin` receives `SCOPE_DENIED`. A change is applied to the Gateway keys within 5 s, takes effect for tool calls issued after the change, writes an audit record of class `security` (`server-api.Audit log`) with old and new value, the confirming device id and, for `all`, the counts shown in the dialog, and is the baseline the run profile check of `platform-skeleton.Gateway run profile` accepts: any value of `tools.sessions.visibility` other than the one mapped from the stored preset is reset to the mapped value at server start. Non-admin devices see the current value read-only with "Managed by the host admin". [NEW]

#### Scenario: Editor opens the setting
- **WHEN** an `editor` device opens Settings → Agents
- **THEN** the radio group is read-only and shows "Managed by the host admin"

#### Scenario: Drift is corrected
- **WHEN** the stored preset is `tree` and the Gateway config was edited by hand to `tools.sessions.visibility: "all"`
- **THEN** at the next server start the key reads `"tree"` again and a `security` audit record notes the correction

#### Scenario: Preset all needs confirmation
- **WHEN** an admin selects "Every agent on this host", ticks the acknowledgement and presses "Allow"
- **THEN** the preset becomes `all` within 5 s and a `security` audit record holds the old value, `all`, the admin's device id and the reachable session count

#### Scenario: Preset all without confirmation
- **WHEN** `jagentchill.agent.policy.set {preset: "all"}` is called without `confirm`
- **THEN** it fails with `INVALID_PARAMS` and the preset is unchanged

### Requirement: Tool jc_agent_create
`jc_agent_create` SHALL create a child agent of the caller. Parameters: `title` (required, 1–60 characters), `prompt` (required, 1–32,000 characters; the first message), `persona?` (persona id; default the caller's persona), `class?` (`creative` default | `workspace`), `runtime?`, `model?` (`"<provider>/<model>"`), `thinking?`, `mode?` (`ask | plan | edit | auto`), `role?` + `route?` (resolve provider, model and thinking through ORC instead of naming them), `projectId?` (default the caller's bound project), `workspaceId?`, `worktree? {baseBranch?, branchName?, refName?}`, `labels?`, `skills?` (0–8 skill ids), `budgetUsd?` (0.01–1,000), `wait?` (`notify` default | `block` | `none`), `timeout_ms?` (1,000–300,000, default 30,000; used with `block`), `autoArchive?` (default false), `contextMode?` (`isolated` default | `brief` — a summary of the caller's conversation of at most 12,288 characters is prepended), `idempotencyKey?`. From an agent caller the child always runs in the background of the caller's turn; `wait` decides how the caller learns the outcome (see "Waiting semantics"). The child is the caller's sub-agent in the caller's project and workspace unless `workspaceId` or `projectId` is given; placement never changes parentage. A device or workflow caller (no agent) creates a root agent and waits by default; a workspace-class agent requested by a device or workflow caller without `workspaceId` fails with `INVALID_PARAMS` (`details.field: "workspaceId"`), because no workspace is ever created implicitly. `worktree` places the child in a new owned worktree workspace of the parent's folder: it is accepted only for a workspace-class child whose parent's workspace is of kind `local_checkout` or `worktree`, in a tree whose root owner device holds `jagentchill.host.exec`; it is counted and named by `workspaces-terminal.Worktree targets and limits`, a failed worktree creation creates no agent, and in every other case the call fails with `AGENT_CLASS_DENIED`. A `workspaceId` other than the caller's own is accepted only when the tree's root owner device can use that workspace under `workspaces-terminal.Role and permission matrix`. Result `data`: `{agentId, state, title, persona, runtime, provider, model, thinking?, mode, availableModes[], projectId?, workspaceId?, cwd?, lastMessage?, pendingApproval?, waitArmed, guidance}` where `guidance` for `notify` is "You will be notified when this agent finishes, fails or needs a decision. Do not poll." Errors: `INVALID_PARAMS`, the limit codes, `AGENT_CLASS_DENIED`, `runtime/mode-not-inheritable`, `runtime/unattended-not-granted`, `runtime/unsupported-capability`, `NO_ROUTE`, `BUDGET_EXCEEDED`, `TEAM_ROLE_DENIED`, `AGENT_LOOP_DETECTED`. [JAD JD-MA-002, JD-MA-003, JD-MA-004, JD-ORC-024]

#### Scenario: Default creation from an agent
- **WHEN** the Director calls `jc_agent_create {title: "Hook options", prompt: "Write five hooks…", persona: "screenwriter"}`
- **THEN** the result has `ok: true`, `state` `creating` or `running`, `waitArmed: true`, the guidance text above, and the Director's turn continues without waiting

#### Scenario: Title too long
- **WHEN** `title` has 61 characters
- **THEN** the call fails with `INVALID_PARAMS` and `details.field: "title"`

#### Scenario: Replayed idempotency key
- **WHEN** the same `idempotencyKey` and parameters are sent twice within 24 h
- **THEN** the second call returns the first call's `agentId` and creates no agent

#### Scenario: Workspace agent without a workspace
- **WHEN** a workflow caller requests `class: "workspace"` and gives no `workspaceId`
- **THEN** the call fails with `INVALID_PARAMS`, `details.field: "workspaceId"`, and no directory or workspace record is created

#### Scenario: Worktree for a child in an editor-owned tree
- **WHEN** a workspace agent whose tree root is owned by an `editor` device calls `jc_agent_create {worktree: {baseBranch: "main"}}`
- **THEN** the call fails with `AGENT_CLASS_DENIED` and no worktree is created

### Requirement: Child mode and permission inheritance
This requirement is the single definition of how a child's mode is resolved (`agent-runtimes.Unattended inheritance for agent-created agents` adds only the unattended grant rule). A child's mode SHALL be resolved in this order: (1) an explicit `mode` valid for the target runtime is used; (2) with no parent (device or workflow caller) the target's default mode is used, or its unattended mode only when the creation explicitly requested `auto`; (3) same runtime as the parent → the parent's current mode; (4) different runtime and the parent is in `auto` → the target's unattended mode; (5) different runtime and the target has no modes → no mode; (6) otherwise the call fails with `runtime/mode-not-inheritable` listing the target's modes. On top of that resolution, a child MUST NOT be more permissive than its parent: product mode order `ask < plan < edit < auto` and Gateway `permissionMode` order `read-only < guarded < workspace < full`; a request above the parent's level is refused with `INVALID_PARAMS` (`details.maxMode`). `permissionMode: "full"` and a CLI runtime's bypass mode are available only in trees whose root session holds the unattended grant of `agent-runtimes.Unattended modes and their warning` (set by an `admin` device; design D25); without it an unattended result of the resolution fails with `runtime/unattended-not-granted`, and every agent in such a mode shows the warning badge "Unattended". A parent that lowers its own mode does not change running children; a parent that is changed by a human to `ask` causes its children's next write tool call to fail with `MODE_READ_ONLY`. [JAD JD-PRV-011] [NEW]

#### Scenario: Cross-runtime without explicit mode
- **WHEN** a parent in mode `edit` on the built-in runtime creates a child on a CLI runtime that has modes and gives no `mode`
- **THEN** the call fails with `runtime/mode-not-inheritable` and `details.modes` lists the target runtime's modes

#### Scenario: Child asks for more than the parent has
- **WHEN** a parent in mode `plan` calls `jc_agent_create {mode: "auto"}`
- **THEN** the call fails with `INVALID_PARAMS` and `details.maxMode: "plan"`

#### Scenario: Parent in auto, child on another runtime
- **WHEN** a parent in `auto` in an Unattended tree creates a child on a different runtime with no `mode`
- **THEN** the child starts in that runtime's unattended mode and shows the "Unattended" badge

### Requirement: Cross-runtime children
A child SHALL be allowed to run on a different runtime, provider and model than its parent. The target is given explicitly (`runtime`, `model`, `thinking`) or through ORC (`role` + `route`, resolved by `orc-model-routing.Route resolution and fallback`, with fallbacks tried in order when session creation or the first turn fails with a fallback class). The server creates the child with `sessions.create {model, agentRuntime, thinkingLevel}` and starts it with the Gateway's `agent` RPC; the model is the one fixed on the session, and `agents.defaults.modelPolicy.allow` lists the enabled catalogue (`agent-runtimes.Runtime policy enforcement on the host`). The resolved `{runtime, provider, model, thinking}` and whether a fallback was used are stored on the record and shown on the row ("Editor · <model label> · fallback"). Acceptance of `agentRuntime` at session creation is gated by spike S7 and model override by spike S12. Fallback when either fails: children are limited to the built-in runtime with the parent's provider family, `jc_agent_create` with another runtime returns `runtime/unsupported-capability`, and `jc_agent_catalog` marks those runtimes `availableForChildren: false` with the reason "This host cannot start sub-agents on this runtime". A workspace-class child on a CLI/ACP runtime uses the CLI's own login (`agent-runtimes.Login and health check`); the server passes no credential. [NEW]

#### Scenario: Child on another model through ORC
- **WHEN** a parent calls `jc_agent_create {role: "reviewer", route: "audit", …}` and the route's primary profile is on a different provider
- **THEN** the child record shows that provider and model and `fallbackUsed: false`

#### Scenario: Primary profile unavailable
- **WHEN** the primary target fails session creation with `model_unavailable` and the route has one fallback
- **THEN** the child is created on the fallback, `fallbackUsed: true`, and the row shows "· fallback"

#### Scenario: Host cannot start children on a runtime
- **WHEN** spike S7 recorded failure and an agent requests `runtime: "acp-opencode"`
- **THEN** the call fails with `runtime/unsupported-capability` and nothing is created

### Requirement: Tool jc_agent_list
`jc_agent_list` (read-only) SHALL return compact metadata of agents the caller can read. Parameters: `scope?` (`children` default | `descendants` | `tree` | `team` | `all`, limited by the active preset), `states?` (array of states), `includeArchived?` (default false), `projectId?`, `workspaceId?`, `persona?`, `label?` (`{key, value?}`), `limit?` (1–200, default 50), `cursor?`. Result `data`: `{agents: [{agentId, title, persona, tier?, parentId?, depth, state, waitingReason?, attention, runtime, model, mode, updated_ms, lastMessagePreview}], nextCursor?}` ordered by `updated_ms` descending. A `scope` wider than the preset allows returns `AGENT_POLICY_DENIED`. [JAD JD-MA-007]

#### Scenario: Default list
- **WHEN** an agent with 3 children (one archived) calls `jc_agent_list {}`
- **THEN** the result contains the 2 non-archived children

#### Scenario: Limit above the maximum
- **WHEN** `limit: 201` is passed
- **THEN** the call fails with `INVALID_PARAMS`

#### Scenario: Scope beyond the preset
- **WHEN** the preset is `tree` and an agent calls `jc_agent_list {scope: "all"}`
- **THEN** the result is `AGENT_POLICY_DENIED`

### Requirement: Tool jc_agent_send
`jc_agent_send` SHALL deliver a prompt to an agent the caller is allowed to send to. Parameters: `agentId` (required), `prompt` (required, 1–32,000 characters), `delivery?` (`steer` default | `followup` | `interrupt`; applies when the target is `running`), `skills?` (0–8 skill ids, rewritten per target runtime by `skills.Invocation rewriting per runtime`), `wait?` (`notify` default for agent callers | `block` | `none`; device callers default `none`), `timeout_ms?` (1,000–300,000, default 30,000), `idempotencyKey?`. The server delivers through the Gateway send path with the matching `queueMode`; a target runtime that cannot steer receives the message as `followup` and the result carries `warnings: ["steer_unavailable_followup_used"]` (steer support per runtime is gated by spike S11 and published as flag `steer` in `agent-runtimes.Published capability matrix`; degradation follows `agent-runtimes.Steer support contract`). The message appears in the target's timeline attributed to the sender ("From <sender title>"). Result `data`: `{agentId, delivered: "steer" | "followup" | "interrupt" | "started", state, waitArmed, result?}`; `result` is present only when `wait: "block"` finished in time (see "Result return to the caller"). Errors: `AGENT_NOT_FOUND`, `AGENT_NOT_OWNED`, `AGENT_POLICY_DENIED`, `AGENT_ARCHIVED`, `AGENT_CLOSED`, `TEAM_SHAPE_VIOLATION`, `AGENT_LOOP_DETECTED`, `BUDGET_EXCEEDED`. [JAD JD-MA-005, JD-MID-010]

#### Scenario: Send to an idle child
- **WHEN** a parent sends a prompt to an idle child with defaults
- **THEN** the child starts a turn, the result has `delivered: "started"`, `waitArmed: true`

#### Scenario: Steer on a runtime that cannot steer
- **WHEN** the target runs on an ACP runtime and is `running`
- **THEN** the message is queued as a follow-up, `delivered: "followup"`, and the result has the warning `steer_unavailable_followup_used`

#### Scenario: Send to an archived agent
- **WHEN** the target has `archived_ms`
- **THEN** the call fails with `AGENT_ARCHIVED` and the message states that the agent must be restored by a human first

### Requirement: Tools jc_agent_status and jc_agent_activity
`jc_agent_status {agentId}` (read-only) SHALL return the latest snapshot: `{agentId, title, persona, tier?, state, waitingReason?, attention, runtime, provider, model, thinking?, mode, capabilities {steer, modes[], rewind, jcTools}, pendingApprovals [{requestId, kind, title, created_ms}], pendingQuestion?, handoff?, children {running, waiting, idle, failed}, usage {inputTokens, outputTokens, costUsd, costKnown}, budget {limitUsd?, spentUsd}, lastTurn {outcome: "completed" | "failed" | "cancelled", ended_ms, error?}}`. `jc_agent_activity {agentId, sinceCursor?, maxItems? (1–100, default 20)}` (read-only) SHALL return a curated summary of recent timeline entries: `{updateCount, cursor, currentMode, content}` where `content` is plain text of at most 12,000 characters built from user messages, assistant messages, tool call names with one-line outcomes, proposals and errors — never reasoning text, tool inputs of tools outside the `jc_*` families, secrets or file contents. Both tools obey read authorisation. [JAD JD-MA-007]

#### Scenario: Status of a child waiting for approval
- **WHEN** a child has one pending cost approval
- **THEN** `jc_agent_status` returns `state: "waiting"`, `waitingReason: "approval"` and one entry in `pendingApprovals`

#### Scenario: Activity since a cursor
- **WHEN** `jc_agent_activity` is called with the cursor of a previous call and 4 entries were added since
- **THEN** `updateCount` is 4 and `content` covers only those entries

#### Scenario: Reasoning is not leaked
- **WHEN** the child's timeline contains reasoning items
- **THEN** `content` contains none of their text

### Requirement: Waiting semantics
The caller of `jc_agent_create`, `jc_agent_send` and `jc_agent_wait` SHALL choose between two ways to wait. **Blocking with a budget** (`wait: "block"` or `jc_agent_wait {mode: "block"}`): the tool call returns as soon as every awaited agent reaches a settled state (`idle`, `failed`, `closed`, or `waiting` with reason `approval`, `question` or `handoff`) or `timeout_ms` elapses (1,000–300,000 ms, default 30,000); on timeout it returns `{timedOut: true, notifyArmed: true}` and arms the completion notification, never an error. **Completion notification** (`wait: "notify"` or `jc_agent_wait {mode: "notify"}`): the call returns at once and the server delivers one notification message per settled agent (see "Completion notification"). `jc_agent_wait` parameters: `agentIds` (1–20 ids the caller can read), `mode` (`block` default | `notify`), `until?` (`all` default | `any`), `timeout_ms?`. Result `data`: `{settled: [{agentId, state, outcome, result?}], pending: [agentId], timedOut, notifyArmed}`. A blocking wait holds no lock and does not count as activity for idle timers. A caller that ends its turn while notifications are armed moves to `waiting`/`children` and is resumed by the first notification; this uses `sessions_yield` semantics where the runtime has it and a server-started follow-up run (the Gateway's `agent` RPC on the caller's session) otherwise. At most 20 blocking waits are open per tree; the next one returns `RATE_LIMITED`. [JAD JD-MA-005] [NEW]

#### Scenario: Blocking wait finishes in time
- **WHEN** `jc_agent_wait {agentIds: [B], timeout_ms: 30000}` is called and B becomes `idle` after 8 s
- **THEN** the call returns after about 8 s with `settled` containing B and its `result`, `timedOut: false`

#### Scenario: Blocking wait times out
- **WHEN** B is still `running` after `timeout_ms`
- **THEN** the call returns `timedOut: true`, `notifyArmed: true`, `pending: [B]` and `ok: true`

#### Scenario: Wait for any
- **WHEN** `until: "any"` is used with three agents and one settles
- **THEN** the call returns with that agent in `settled` and the other two in `pending`

### Requirement: Completion notification
When an agent with an armed notification settles — finishes a turn, fails, is closed, or starts waiting for an approval, a question or a hand-off decision — the server SHALL deliver exactly one message to the agent that armed it, as a follow-up prompt on that agent's session that does not interrupt a running tool call: a structured block `{kind: "agent_notification", agentId, title, outcome: "completed" | "failed" | "cancelled" | "closed" | "needs_approval" | "needs_answer" | "handoff_pending", reason?, summary (≤ 2,000 characters), handbackId?, usage {costUsd}}` followed by the line "Use jc_agent_status or jc_agent_activity for details. Do not poll." Several children that settle within 2 s of each other are delivered as one message with one block each. A notification is delivered at most once per settle event (keyed by `agentId` + the turn id), survives a Gateway restart, is cancelled when the child is detached or the armer is archived, and is retried up to 3 times at 2 s / 8 s / 30 s when delivery fails, after which the root session shows the item "A sub-agent result was not delivered to <title>" with a "Deliver now" action. **Delivery rule (referenced by hand-backs, hand-off packages, mention wakes, reviewer results and heartbeats):** delivery into a session that has a running turn is gated by spike S18 (and by S11 for steer) and follows the same server-side rule as a workflow report — the durable per-session outbox of `agent-workflows.Workflow started from a chat session`, exactly once, after the running turn, in arrival order; where it is unavailable, and always for an armer with no running turn (`idle`, or `waiting` with reason `children`), the server holds the message in its durable delivery queue and, as soon as the armer has no active run, starts one turn itself with the Gateway's `agent` RPC whose message is the queued blocks in arrival order; a queued message is never left waiting for a turn that only it can start. Every such server-started turn counts toward the guards of "Loop prevention". [JAD JD-MA-006]

#### Scenario: Two children finish together
- **WHEN** children B and C both complete within 1 s
- **THEN** the parent receives one follow-up message containing two notification blocks

#### Scenario: Child needs permission
- **WHEN** a child with an armed notification starts waiting for a cost approval
- **THEN** the parent receives a notification with `outcome: "needs_approval"` and the human sees the approval card once (see "Child approvals surface once")

#### Scenario: Exactly once
- **WHEN** the server restarts after storing but before acknowledging a delivery
- **THEN** the parent's timeline contains that notification exactly once

#### Scenario: Armer waiting with no turn coming
- **WHEN** a parent on a runtime that rejects follow-up injection is `waiting` with reason `children` and its only child completes
- **THEN** the server starts one turn on the parent whose message is the queued notification block, within 2 s of the child settling

### Requirement: Result return to the caller
The result of a child's work SHALL reach its caller in a defined form: `result = {outcome, summary, handback?, artefacts [{kind: "proposal" | "media" | "script" | "file" | "job" | "diagram" | "note", id, title}], lastMessage (≤ 12,000 characters), usage {inputTokens, outputTokens, costUsd, costKnown}}`. When the child ended its work with `jc_agent_handback`, `handback` is that record and `summary` is its first 2,000 characters of `whatChangedOrInspected`; otherwise `summary` is the first 2,000 characters of the child's final assistant message. Results flow one level at a time: a grandchild's result goes to its owner, never directly to the root. A child's proposals are artefacts, not applied changes: they are presented to the human in the root session (see "Proposals from team members"). Large outputs are referenced by id, never inlined beyond the stated caps. [NEW]

#### Scenario: Child ends without a hand-back
- **WHEN** a child's turn completes with a final message of 5,000 characters and no `jc_agent_handback`
- **THEN** the caller's `result.summary` is the first 2,000 characters and `result.lastMessage` the full 5,000

#### Scenario: Child staged a proposal
- **WHEN** a child staged and submitted a proposal during its turn
- **THEN** `result.artefacts` contains `{kind: "proposal", id, title}` and the project is unchanged until a human or policy accepts it

### Requirement: Tools jc_agent_cancel, jc_agent_archive and jc_agent_update
`jc_agent_cancel {agentId, close? (default false), reason? (0–500 characters)}` SHALL abort the target's running turn and keep the agent (`idle`); with `close: true` it also terminates the agent (`closed`). Cancelling an agent cascades to the running turns of all its descendants. `jc_agent_archive {agentId, reason?}` SHALL archive per "Archive, close and cascade". `jc_agent_update {agentId, title?, labels? (replaces user labels)}` SHALL change name and user labels. All three need act authorisation; none can target the caller itself, an ancestor, or a root agent (`AGENT_NOT_OWNED`); permanent purge is not available to agents. Results: `{agentId, state, cancelledDescendants?: number, archived?: boolean}`. Each call writes an audit record with the caller and `reason`. [JAD JD-MA-008]

#### Scenario: Cancel keeps the agent
- **WHEN** a parent cancels a running child
- **THEN** the child becomes `idle` after the abort is acknowledged, its transcript is intact and it accepts a new prompt

#### Scenario: Cancel with close
- **WHEN** `close: true` is passed
- **THEN** the child becomes `closed` and a subsequent `jc_agent_send` to it fails with `AGENT_CLOSED`

#### Scenario: Agent tries to archive its root
- **WHEN** a child calls `jc_agent_archive` with the root's id
- **THEN** the result is `AGENT_NOT_OWNED`

### Requirement: Tools jc_agent_set_mode and jc_agent_set_model
`jc_agent_set_mode {agentId, mode}` SHALL change an owned descendant's mode within the ceiling of "Child mode and permission inheritance"; `jc_agent_set_model {agentId, model? ("<provider>/<model>" or null for the persona default), runtime?, thinking?}` SHALL change its model, runtime or thinking. The server applies both with `sessions.patch` guarded by `expectedSessionId`. The stored value is the value read back from the Gateway after the patch. A change the runtime can apply only between turns (a CLI-backed run rejects live permission changes) is queued and applied before the target's next turn, and the result carries `notice: "applies_next_turn"`. Changing `runtime` is performed with `agent-runtimes.Switch runtime operation` (running turn cancelled, mode, thinking and features reset to the new runtime's defaults) and `agent-runtimes.Durable history hand-over` (durable history summary attached to the next turn; context carried is gated by spike S10). An agent caller can never change an agent's class: a `runtime` (or a `model` that implies a runtime) whose resulting class would be `workspace` per `agent-runtimes.Creative sessions on CLI and ACP runtimes` is refused with `AGENT_CLASS_DENIED` unless the target is already workspace-class, the caller is workspace-class, and the tree's root was created under the workspace privilege of "Agent classes and creation privileges" that is still valid; step (1) of `agent-runtimes.Switch runtime operation` is evaluated with the tree's root owner device as the caller. `jc_agent_set_mode` never enters an unattended mode. Results: `{agentId, mode | {runtime, provider, model, thinking?}, applied: "now" | "next_turn", notice?}`. Errors: `AGENT_NOT_OWNED`, `AGENT_CLASS_DENIED`, `INVALID_PARAMS` (mode or model not offered by the target runtime, with the valid list), `runtime/unsupported-capability`, `runtime/unattended-not-granted`, `TEAM_SHAPE_VIOLATION` (a team member's model is changed only by a human or by the route). [JAD JD-MA-008, JD-MID-001, JD-MID-002, JD-MID-005]

#### Scenario: Mode change during a CLI-backed run
- **WHEN** a parent sets a running CLI-runtime child from `edit` to `plan`
- **THEN** the result has `applied: "next_turn"`, `notice: "applies_next_turn"`, and the child's next turn runs in `plan`

#### Scenario: Invalid model
- **WHEN** `model` names a model that is disabled in the catalogue
- **THEN** the call fails with `INVALID_PARAMS` and `details.validModels` lists at most 50 enabled ids

#### Scenario: Creative parent moves its child to a CLI runtime
- **WHEN** a creative agent in a tree started by an `editor` device calls `jc_agent_set_model {agentId: <its child>, runtime: "claude-code"}` and that runtime would make the child workspace-class
- **THEN** the call fails with `AGENT_CLASS_DENIED`, the child's runtime is unchanged, and a `security` audit record is written

### Requirement: Tool jc_agent_catalog
`jc_agent_catalog {kind? ("personas" | "runtimes" | "models" | "roles" | "teams"; default all), runtime?, query?, limit? (1–100, default 50)}` (read-only) SHALL let an agent discover valid ids before creating or changing agents: personas `{id, name, description, class, orcRole}`; runtimes `{id, label, ready, availableForChildren, reason?, capabilities {steer, modes[], jcTools, nativeToolCoverage}}`; models `{id ("<provider>/<model>"), label, runtime, thinkingLevels[], available, unavailableReason?}` taken from `models.list`; ORC roles and routes `{roleId, routes[], defaultProfile}`; enabled Teams `{id, name, roles[]}`. Disabled providers and models are omitted. The tool reveals no credential state beyond `available` and a reason from the closed set `missing-auth`, `auth-failed`, `cooldown`, `unsupported-runtime`, `disabled`. [JAD JD-MA-010]

#### Scenario: Agent looks up models before creating a child
- **WHEN** an agent calls `jc_agent_catalog {kind: "models", query: "flash"}`
- **THEN** it receives only enabled models whose id or label contains "flash", each with `available` and its `runtime`

#### Scenario: Runtime not ready
- **WHEN** a CLI runtime is installed but not logged in
- **THEN** its entry has `ready: false` and `reason: "missing-auth"`

### Requirement: Agents answering descendants' permission requests
An agent SHALL be able to list and answer permission requests of its owned descendants with `jc_agent_permission_list {agentId?}` (read-only; returns `[{requestId, agentId, kind, title, detail, estimateUsd?, created_ms, humanOnly}]`) and `jc_agent_permission_respond {requestId, decision: "allow_once" | "deny", note? (0–500 characters)}`. An agent decision is accepted only when all of these hold, checked in this order: the request belongs to an owned descendant; the request is not `humanOnly` (checked before the mode, so a `humanOnly` request always reports `human_only`); and the caller's own mode would have allowed the same action without a prompt (`exceeds_caller_mode` otherwise). `humanOnly` is true for: out-of-project effects (`agent-editing-tools.Approval for out-of-project effects`), costs above the per-call threshold or beyond a budget, host command execution, terminal keys, workspace script start or stop and file writes outside the workspace, skill creation and updates, publishing and share links, provider data consent (`generation-providers.Data leaving the machine`), entering an unattended mode, and plan approvals in `plan` mode. A refused attempt returns `PERMISSION_DENIED` with `details.reason: "human_only" | "exceeds_caller_mode"` and leaves the request pending for the human. `deny` is always accepted for owned descendants. An agent can never grant "always allow". Every agent decision is shown on the request card ("Allowed by Director (agent)") and audited. JAgentDesk lets any agent answer any agent's request; that gap is closed here. [JAD JD-MA-009] [NEW]

#### Scenario: Parent in auto allows a small in-budget cost
- **WHEN** a parent in `auto` with remaining session budget answers `allow_once` for a child's 0.10 USD generation that is not `humanOnly`
- **THEN** the child proceeds, the card shows "Allowed by <parent title> (agent)" and no human prompt remains

#### Scenario: Human-only request
- **WHEN** a parent answers `allow_once` for a child's request to export to a path outside the workspace
- **THEN** the call fails with `PERMISSION_DENIED`, `details.reason: "human_only"`, and the human's approval card stays pending

#### Scenario: Cost above the threshold is human-only
- **WHEN** a parent in `edit` answers `allow_once` for a child's cost above 0.50 USD
- **THEN** the call fails with `PERMISSION_DENIED`, `details.reason: "human_only"`

#### Scenario: Parent in ask mode
- **WHEN** a parent in `ask` answers `allow_once` for a child's in-project write that is not `humanOnly`
- **THEN** the call fails with `PERMISSION_DENIED`, `details.reason: "exceeds_caller_mode"`

### Requirement: Cost and budget inheritance
Every agent in a tree SHALL spend against the budgets of its root: the session budget, project budget and all wider budgets of `generation-providers.Budgets with hard stop` apply to the whole tree as one spender, and mode thresholds of `agent-editing-tools.Cost guard` are evaluated with the tree's cumulative spend. A creator can give a child a sub-budget (`budgetUsd`), which is reserved from the creator's remaining budget at creation and returned unspent when the child closes or is archived; a child's sub-budget can never exceed its creator's remaining amount (`BUDGET_EXCEEDED` with `details.remainingUsd`). A child without `budgetUsd` draws directly on its creator's budget. Model-token cost of each agent is added to its `usage` and, when the provider reports a price (`costKnown: true`), to tree spend; plan-billed runtimes contribute tokens only, so a tree on a plan-billed runtime is bounded by the turn and running-time ceilings of "Loop prevention" (guards 6 and 7), which apply to every tree whatever its billing. When a tree budget is exhausted every member's next costed call fails with `BUDGET_EXCEEDED`, running turns are not aborted, and the root session shows one "Budget reached" card with "Raise budget" on admin devices (raising or removing any hard-stop budget needs `jagentchill.config.write`, per `generation-providers.Budgets with hard stop`) and "Ask an admin device" on the others; no member, tool or mode bypasses the stop. Warnings at 80 % are raised once per tree, not once per member. [NEW]

#### Scenario: Sub-budget reservation
- **WHEN** a parent with 3.00 USD remaining creates a child with `budgetUsd: 1.00`
- **THEN** the parent's remaining amount shows 2.00 USD and the child's `budget.limitUsd` is 1.00

#### Scenario: Unspent sub-budget returns
- **WHEN** that child closes after spending 0.40 USD
- **THEN** 0.60 USD returns to the parent's remaining amount

#### Scenario: Tree budget exhausted
- **WHEN** the session budget of 5.00 USD is fully spent by three agents together
- **THEN** each agent's next costed tool call fails with `BUDGET_EXCEEDED` and the root session shows exactly one "Budget reached" card

### Requirement: Loop prevention
The server SHALL prevent runaway agent-to-agent activity with these guards, each returning `AGENT_LOOP_DETECTED` with `details.guard`. A **reset point** is a prompt typed by a person, a heartbeat fire or an automation start in the tree; every counter below is counted "since the last reset point in the tree". (1) **cycle** — an agent cannot create, send to or hand off to itself, and a chain A → B → A in which each message was caused by the previous one is refused at the third round trip of the same pair since the last reset point (`guard: "ping_pong"`, limit 2 round trips per pair); (2) **hop count** — every agent-originated message carries a hop counter that is 0 at a reset point and is incremented on each agent-to-agent delivery; a turn started by any server-delivered message that originates from an agent — a completion notification, a hand-back, a hand-off package, a room mention, a reviewer result — inherits the highest hop count of the messages that started it, and those deliveries count as hops; a delivery with hop count above 12 is refused (`guard: "hops"`); (3) **rate** — at most 30 agent-to-agent sends per agent per 60 s and 200 per tree per 60 s (`guard: "rate"`, `details.retryAfter_ms`); (4) **duplicate** — a prompt whose SHA-256 over `(sender, target, normalised text)` equals one delivered in the previous 120 s is refused (`guard: "duplicate"`); (5) **mention storms** — see "Mentions that wake agents"; (6) **turn ceiling** — at most 200 agent turns per tree since the last reset point, counting every turn of every member including turns started by completion notifications and hand-backs (host setting 20–2,000); the next turn is not started (`guard: "turns"`); (7) **running-time ceiling** — at most 240 minutes of summed `running` time of all members since the last reset point (host setting 10–1,440; `guard: "time"`). Guards (6) and (7) are the ceilings for trees on plan-billed runtimes, where no budget applies; inside a team run the Team's `maxRunMinutes` and inside an autonomous run its own caps apply in addition and the stricter value wins. When guard (6) or (7) is reached, or any other guard fires 3 times within 5 minutes in one tree, the server pauses agent-to-agent delivery for that tree (queued notifications and hand-backs are kept, not dropped), sets the root's `attention` to `error`, raises one `agent.failed` notification and shows the banner "Agents in this session kept calling each other. Delivery is paused." (for guards 6 and 7: "This session reached its activity limit (200 turns)." or "… (240 minutes).") with "Resume" (`jagentchill.agent.delivery.resume {rootId}`, which is a reset point) and "Stop all" (`jagentchill.agent.stopAll`), both scope `jagentchill.agent.use` with act access to the tree. Guards (2)–(4), (6) and (7) are host settings with ranges hops 4–32, sends 5–120 per minute per agent, duplicate window 10–600 s, and the two ranges stated above. [NEW]

#### Scenario: Ping-pong
- **WHEN** A sends to B, B replies to A, A sends to B again, B replies again, and A attempts a third send caused by that reply with no person, heartbeat or automation prompt in between
- **THEN** the third send fails with `AGENT_LOOP_DETECTED`, `details.guard: "ping_pong"`

#### Scenario: Tree paused after repeated trips
- **WHEN** guards fire 3 times within 5 minutes in one tree
- **THEN** further agent-to-agent sends in that tree fail with `AGENT_LOOP_DETECTED`, `details.guard: "paused"`, until a human presses "Resume"

#### Scenario: Human prompt resets the hop count
- **WHEN** a human sends a message to an agent whose last inbound message had hop count 12
- **THEN** the next agent-to-agent send from that agent carries hop count 1 and is delivered

#### Scenario: Notification-driven loop is bounded
- **WHEN** a parent on a plan-billed runtime repeatedly sends a different prompt to its child each time the child's completion notification wakes it, with no person involved
- **THEN** the completion notifications raise the hop count, the thirteenth delivery is refused with `guard: "hops"`, and after the tree's 200th turn no further turn starts and the banner with "Resume" and "Stop all" is shown

#### Scenario: Running-time ceiling
- **WHEN** the members of a free tree have accumulated 240 minutes of `running` time since the last prompt typed by a person
- **THEN** no further turn starts, delivery is paused with `guard: "time"`, and one `agent.failed` notification exists

### Requirement: Hand-off verb
`handoff` SHALL transfer the lead of a piece of work — and the ownership that goes with it — from one agent to another, together with a context package. Tool `jc_agent_handoff` parameters: `to` (required; an `agentId` the caller can send to, or `{persona | role + route, title}` to create the receiver as a child of the caller's owner, under every check of `jc_agent_create` — limits, class (the receiver's class never exceeds the caller's, `AGENT_CLASS_DENIED`), mode ceiling and team shape), `scope` (required: `task` — the receiver takes over the stated task and reports to the caller's owner; `lead` — the receiver also takes over the caller's owned descendants and, in a team run, the caller's tier; `conversation` — the receiver becomes the agent that answers the human in the root session), `package` (required): `{brief (1–8,000 characters: goal, constraints, definition of done), historySummary (1–12,288 characters: what was tried and decided), artefacts [{kind, id, title, note?}] (0–50; proposals, scripts, media, files, jobs, diagrams, room or board references), openQuestions [string] (0–20, each ≤ 500 characters), acceptanceCriteria [string] (0–20), dueHint?}`, `writer?` (boolean; also pass the agent writer token, see "Agent writer token"), `reason?` (0–500 characters), `expires_ms?` (60,000–86,400,000; default 1,800,000). The call creates a hand-off record `{id ("hof_" + ULID), fromAgentId, toAgentId, scope, package, status: "pending" | "accepted" | "rejected" | "cancelled" | "expired", decidedBy?: {kind: "agent" | "device", id}, decisionNote?, created_ms, decided_ms?}`, delivers the package to the receiver as a structured message, sets both agents' `attention` to `handoff`, and returns `{handoffId, status: "pending"}` without ending the caller's ownership. Scope `conversation` and any hand-off that crosses agent class or raises the receiver's mode always require a human decision. A sender with no owner — a root, or a detached agent — can hand off only with scope `conversation`: `task` and `lead` from such a sender return `HANDOFF_TARGET_INVALID` with the message "Create a sub-agent with jc_agent_create instead", so a root never gives its tree away without a person's decision, and `to: {persona | role + route}` from such a sender creates the receiver as the sender's own child. A caller has at most 1 pending outgoing hand-off per scope. Gateway `sessions.assignOwner` is not used for ownership: the server's records are authoritative and no spike gates this behaviour. [NEW]

#### Scenario: Task hand-off to an existing sibling
- **WHEN** the Editor agent calls `jc_agent_handoff {to: <Reviewer id>, scope: "task", package: {…}}`
- **THEN** a record with `status: "pending"` exists, the Reviewer's timeline shows a hand-off card with brief, history summary, artefacts and open questions, and the Editor still owns the task

#### Scenario: Package too large
- **WHEN** `package.historySummary` has 12,289 characters
- **THEN** the call fails with `INVALID_PARAMS`, `details.field: "package.historySummary"`

#### Scenario: Conversation hand-off needs the human
- **WHEN** an agent requests `scope: "conversation"`
- **THEN** the hand-off stays `pending` until a device with scope `jagentchill.agent.use` and act access to the session accepts it, regardless of the receiver's answer

#### Scenario: Root tries a lead hand-off
- **WHEN** a root agent calls `jc_agent_handoff {scope: "lead", to: <its child>}`
- **THEN** the call fails with `HANDOFF_TARGET_INVALID`, the message names `jc_agent_create`, and no record is created

### Requirement: Hand-off acceptance and rejection
The receiver SHALL answer with `jc_agent_handoff_respond {handoffId, decision: "accept" | "reject" | "cancel", note? (0–1,000 characters; required for reject), clarifications? [string] (0–10)}` (`accept` and `reject` from the receiver only, `cancel` from the sender only; any other caller receives `AGENT_NOT_OWNED`), or a human answers with `jagentchill.agent.handoff.resolve {handoffId, decision, note?}` from the hand-off card ("Accept for <receiver>", "Reject", "Cancel hand-off"). A hand-off whose decision belongs to a person — scope `conversation`, a receiver that is the user, or a hand-off the active approval policy routes to a human — raises one `agent.handoff_pending` notification (`notifications.Notification event catalogue`) when it becomes `pending` and sets the root's `attention` to `handoff`; a hand-off decided by the receiving agent raises none. The first valid decision wins; a second returns `HANDOFF_NOT_PENDING`. A receiver in a tier or class that is not allowed to hold the scope is refused at creation with `HANDOFF_TARGET_INVALID`. `reject` leaves ownership unchanged and notifies the sender with the note. A pending hand-off expires at `expires_ms` (`status: "expired"`), is cancelled when either agent is archived or closed, and can be cancelled by the sender with `jc_agent_handoff_respond {decision: "cancel"}`. A receiver that is `running` receives the package as a follow-up, never as an interrupt. When the receiver did not exist, it is created on `to` and the hand-off is delivered as its first prompt; creation failure fails the hand-off call and leaves no record. [NEW]

#### Scenario: Accept
- **WHEN** the receiver answers `accept`
- **THEN** the record is `accepted` with `decidedBy.kind: "agent"`, and the effects of "Hand-off effects on ownership and lead" apply within 1 s

#### Scenario: Reject with a note
- **WHEN** the receiver answers `reject` with the note "Missing the approved script version"
- **THEN** the record is `rejected`, the sender receives a notification containing the note, and nothing else changed

#### Scenario: Second decision
- **WHEN** a human rejects a hand-off the receiver already accepted
- **THEN** the RPC returns `HANDOFF_NOT_PENDING` and the hand-off stays `accepted`

#### Scenario: Hand-off waiting for the user
- **WHEN** an agent hands the conversation off to another persona and the decision is the user's
- **THEN** the hand-off card shows "Needs approval", exactly one `agent.handoff_pending` notification exists, and no `agent.question` notification is raised

### Requirement: Hand-off effects on ownership and lead
On acceptance the server SHALL apply, in one transaction: for `task` — the receiver's `ownerAgentId` becomes the sender's owner (the receiver now reports to whoever the sender reported to; the sender always has an owner, see "Hand-off verb"), the receiver's armed notifications for that task point to that owner, and the sender is marked "handed off" for the task; for `lead` — additionally every agent whose `ownerAgentId` was the sender now has the receiver as `ownerAgentId`, pending notifications from them are re-targeted to the receiver, and in a team run the run record's `leadAgentId` (or the assignment's holder for a Peer) is replaced and the tier labels move; for `conversation` — the root session's "answering agent" becomes the receiver: subsequent human messages in that session are routed to the receiver's session and the composer header shows "<receiver persona> is leading this conversation" with "Hand back to <previous>". `parentId` never changes (the creation lineage is preserved). The sender stays alive, loses act rights over transferred descendants, and keeps read rights. With `writer: true` the agent writer token moves to the receiver in the same transaction. A hand-off that would leave a team run without a Lead, or with two, is refused with `TEAM_TOPOLOGY_VIOLATION`. [NEW]

#### Scenario: Lead hand-off moves the children
- **WHEN** Lead L1 with Peers P1 and P2 hands off `lead` to L2 and L2 accepts
- **THEN** P1 and P2 have `ownerAgentId` L2, the run's `leadAgentId` is L2, L1 calling `jc_agent_cancel` on P1 returns `AGENT_NOT_OWNED`, and P1's next hand-back is delivered to L2

#### Scenario: Conversation hand-off
- **WHEN** a human accepts a `conversation` hand-off from Director to Editor
- **THEN** the next message typed in that session's composer starts a turn on the Editor's session and the header shows "Editor is leading this conversation"

### Requirement: Hand-back record
`handback` SHALL return work to the owner in a structured form. Tool `jc_agent_handback` parameters: required `whatChangedOrInspected`, `evidence`, `remainingUncertainty`, `counterEvidence` (each 1–12,000 characters; "None" is a valid value that the agent must state explicitly); optional `requestedResolution`, `currentDirection`, `claim`, `risk` (each 0–12,000 characters), `artefacts [{kind, id, title, note?}]` (0–50), `outcome` (`done` default | `partial` | `blocked` | `disagree`), `handoffId?` (the accepted hand-off this answers). The call stores a hand-back record `{id ("hbk_" + ULID), fromAgentId, toAgentId (the sender's current owner), fields…, status: "delivered" | "accepted" | "returned" | "superseded", created_ms, decided_ms?}`, delivers it to the owner as a structured message that does not interrupt a running tool call (delivery rule of "Completion notification"), and ends the sender's turn (the sender becomes `idle`). An agent with no owner (a root) cannot hand back (`INVALID_PARAMS`, message "Report to the user in your reply instead"). `outcome: "disagree"` or a non-empty `requestedResolution` opens a dissent in a team run (see "Dissent resolution"). In a team run this is the only tool a Peer has for returning work, and the record is stored in the run. [JAD JD-ORC-014] [NEW]

#### Scenario: Complete hand-back
- **WHEN** a Peer calls `jc_agent_handback` with all four required fields
- **THEN** a record with `status: "delivered"` exists, the Lead receives the structured message, and the Peer is `idle`

#### Scenario: Missing counter-evidence
- **WHEN** `counterEvidence` is omitted or empty
- **THEN** the call fails with `INVALID_PARAMS`, `details.field: "counterEvidence"`, and the message says to state "None" explicitly when there is none

#### Scenario: Field over the cap
- **WHEN** `evidence` has 12,001 characters
- **THEN** the call fails with `INVALID_PARAMS` and nothing is delivered

### Requirement: Hand-back acceptance and return
The owner SHALL close each hand-back: `jc_agent_handback_respond {handbackId, decision: "accept" | "return", note? (0–2,000 characters; required for return)}` for free agents; in a team run the Lead uses `jc_team_resolve_dissent` and `jc_team_accept_result`. `accept` sets `status: "accepted"`. `return` sets `status: "returned"`, sends the note to the sender as a new prompt and allows one further hand-back, which supersedes the first; an owner can return the same piece of work at most 2 times, after which `return` fails with `INVALID_PARAMS` (`details.reason: "max_returns"`) and the owner must accept, cancel the agent, or escalate with `jc_session_ask`. A human can accept or return any hand-back in a tree they can act on from the hand-back card (`jagentchill.agent.handback.resolve`, scope `jagentchill.agent.use`, same decision values and return limit). A hand-back left `delivered` for 30 minutes while its owner is `idle` raises the owner's `attention` to `handoff` and shows "Hand-back waiting" on the roster. [NEW]

#### Scenario: Return once
- **WHEN** the owner returns a hand-back with a note and the sender hands back again
- **THEN** the first record is `superseded`, the second is `delivered`

#### Scenario: Third return refused
- **WHEN** the owner tries to return the same work a third time
- **THEN** the call fails with `INVALID_PARAMS`, `details.reason: "max_returns"`

### Requirement: Hand-off and hand-back UI state
Hand-offs and hand-backs SHALL be visible as first-class items: (1) a card in both agents' timelines — hand-off card with header "Hand-off · <scope label>" ("Task", "Lead", "Conversation"), from → to avatars, the brief (collapsed after 6 lines), "History" and "Open questions (n)" disclosures, artefact chips that open the artefact, a status pill (Needs approval while `pending` and a human decision is required, otherwise Queued; Ready for `accepted`; Failed for `rejected`; Cancelled for `cancelled`/`expired`) and the human actions allowed for the viewer; hand-back card with header "Hand-back · <outcome label>", the four required sections as labelled blocks ("What changed or was inspected", "Evidence", "Remaining uncertainty", "Counter-evidence"), optional sections when present, artefact chips, and status; (2) a directional arrow badge on roster rows ("→ handing off", "← hand-off received", "↩ handed back"); (3) in a workflow run, the package passed between nodes under "Hand-off" in the node detail panel (`agent-workflows.Hand-off package between agents`, `agent-workflows.Node detail panel`), and a hand-off to a person as the waiting reason `human_handoff` on the node (`workflow-diagram.Node run-status styles`); (4) a "Hand-offs" filter in the Agents tab listing all records of the tree, newest first. Cards update in place within 1 s of a status change on every connected device. Each section's text is selectable and has a "Copy" action; cards are reachable by keyboard and announce "Hand-off from <a> to <b>, <status>". [NEW]

#### Scenario: Pending hand-off needing a human
- **WHEN** a `conversation` hand-off is pending
- **THEN** its card shows the pill "Needs approval" and the buttons "Accept for <receiver>" and "Reject" to devices with scope `jagentchill.agent.use`, and no buttons to `viewer` devices

#### Scenario: Status change propagates
- **WHEN** the hand-off is accepted on one device
- **THEN** every other connected device shows the card as Ready within 1 s

### Requirement: Hand-off and hand-back audit trail
Every hand-off and hand-back state change SHALL append an immutable audit record of class `agent` (`agent-editing-tools.Audit log`, retention 90 days by default): `{id, time_ms, kind: "handoff" | "handback", recordId, action: "created" | "accepted" | "rejected" | "cancelled" | "expired" | "returned" | "superseded", fromAgentId, toAgentId, scope?, actor: {kind: "agent" | "device" | "system", id}, rootId, runId?, projectId?, packageDigest (SHA-256 of the canonical package), ownershipBefore?, ownershipAfter?, writerMoved?}`. The package text itself is stored on the hand-off record, not in the audit row. The trail of a tree is readable through `jagentchill.agent.handoff.list {rootId, kind?, limit?, cursor?}` and from the Agents tab ("Hand-offs" filter → "History"), and is exported with the session's audit export. Records are never edited; a correction is a new record. [NEW]

#### Scenario: Accepted lead hand-off is traceable
- **WHEN** a `lead` hand-off is accepted by a device
- **THEN** two audit records exist (`created`, `accepted`), the second with `actor.kind: "device"`, and `ownershipBefore`/`ownershipAfter` listing the moved agent ids

#### Scenario: Viewer reads the trail
- **WHEN** a `viewer` device opens "History"
- **THEN** it sees the records of projects it can read and no action buttons

### Requirement: Agent chat rooms
A room SHALL be a named, durable message channel that agents and humans share: `{id ("rm_" + ULID), name (1–40 characters, `^[a-z0-9][a-z0-9-]*$`, unique case-insensitively per scope), purpose (1–280 characters, required), scope: {kind: "tree", rootId} | {kind: "run", runId} | {kind: "project", projectId} | {kind: "host"}, createdBy, members [agentId | deviceId] (derived: everyone who posted or was mentioned, plus explicit members), retentionDays (1–365, default 30), created_ms, lastMessage_ms, archived_ms?}`. Rooms are addressed by id or by name within the caller's scope. Room visibility follows the policy preset: `tree` and `run` rooms are readable by members of that tree or run; `project` rooms by agents bound to that project under `team` or `all`; `host` rooms only under `all`. Creating a `host` or `project` room requires a device with scope `jagentchill.agent.use` or an agent under a preset that allows it. Limits: 50 rooms per tree, 200 per host, 5,000 messages per room (oldest messages beyond that are trimmed), message body 1–8,000 characters. Messages older than `retentionDays` are deleted daily; an archived room is deleted with its messages 30 days after archiving. Every team run gets one room named `team` with purpose "Coordination for run <title>". [JAD JD-MA-016] [NEW]

#### Scenario: Name collision
- **WHEN** a room `Review` is requested in a tree that already has `review`
- **THEN** creation fails with `ROOM_NAME_TAKEN`

#### Scenario: Missing purpose
- **WHEN** a room is created without `purpose`
- **THEN** creation fails with `INVALID_PARAMS`, `details.field: "purpose"`

#### Scenario: Retention
- **WHEN** a room has `retentionDays: 30` and a message is 31 days old at the daily cleanup
- **THEN** that message is deleted and newer messages remain

### Requirement: Room tools
Agents SHALL use rooms through: `jc_room_create {name, purpose, scope? (default the caller's tree), members?, retentionDays?}` → `{roomId, name}`; `jc_room_list {scope?, includeArchived?}` (read-only) → `[{roomId, name, purpose, scope, memberCount, lastMessage_ms}]`; `jc_room_inspect {room}` (read-only) → room record plus members with `{id, kind, title, state}`; `jc_room_post {room, body, replyTo? (message id that must exist in the room), kind? ("note" default | "question" | "decision" | "result"), mentions? (explicit ids in addition to parsed @names)}` → `{messageId, seq, wokenAgentIds[]}`; `jc_room_read {room, since_ms?, afterMessageId?, authorId?, limit? (1–200, default 20)}` (read-only) → the last `limit` matching messages in ascending order, each `{messageId, seq, author {id, kind, title}, body, kind, replyTo?, mentions[], reactions {emoji: count}, created_ms}`; `jc_room_wait {room, afterMessageId, timeout_ms? (1,000–300,000, default 30,000)}` (read-only) → messages after the cursor immediately when any exist, otherwise blocks until a post or the timeout and then returns an empty list with `timedOut: true`; an unknown cursor returns `ROOM_CURSOR_UNKNOWN`; `jc_room_delete {room}` archives a room the caller created (devices with scope `jagentchill.agent.use` can archive any room they can read). `room` is an id or a name. Posting requires read access to the room; an agent posting to a room it cannot read receives `ROOM_NOT_FOUND`. [JAD JD-MA-016, JD-MA-018]

#### Scenario: Reply to a missing message
- **WHEN** `jc_room_post` names a `replyTo` id that is not in the room
- **THEN** the call fails with `INVALID_PARAMS`, `details.field: "replyTo"`

#### Scenario: Wait returns on a post
- **WHEN** an agent waits with a valid cursor and another member posts after 4 s
- **THEN** the wait returns after about 4 s with that one message

#### Scenario: Wait times out
- **WHEN** nobody posts within `timeout_ms`
- **THEN** the wait returns `{messages: [], timedOut: true}` with `ok: true`

#### Scenario: Unknown cursor
- **WHEN** `afterMessageId` does not exist in the room
- **THEN** the call fails with `ROOM_CURSOR_UNKNOWN`

### Requirement: Mentions that wake agents
A room message SHALL wake the agents it mentions. Mentions are parsed from `@name` tokens that follow the start of the text, whitespace or "(", where `name` matches a member's handle (persona id, team role id, or the agent's title lower-cased with spaces replaced by `-`), plus ids passed in `mentions`. Each mentioned, eligible agent receives one follow-up prompt (delivery rule of "Completion notification"): a structured block `{kind: "room_mention", roomId, roomName, messageId, author, excerpt (≤ 500 characters)}` and the line "Read the room with jc_room_read before answering." Eligibility: the agent is not the author, is not archived, not `closed`, not `failed`, can read the room, and has not been woken by the same room in the previous 10 s (further mentions within that window are folded into the next wake). `@everyone` expands to every agent that has posted in the room and is refused with `ROOM_MENTION_LIMIT` when it would exceed 25 targets; a message can mention at most 25 distinct agents. `@lead` and `@supervisor` resolve inside a run room. Mention wakes count toward the hop and rate guards of "Loop prevention", and a room in which agents woke each other 20 times with no human or non-mention post in between is muted for wakes ("Mentions paused in #<room>") until a human posts. Mentioning a human (`@user`, or a paired device's name) raises `attention: "question"` on the root and a single `agent.question` notification (`notifications.Notification event catalogue`). [JAD JD-MA-017] [NEW]

#### Scenario: Mention wakes one agent
- **WHEN** an agent posts "@reviewer please check scene 3" in a run room with a member whose handle is `reviewer`
- **THEN** the reviewer receives one `room_mention` prompt, `wokenAgentIds` contains its id, and the author is not woken

#### Scenario: Everyone above the cap
- **WHEN** `@everyone` is used in a room where 26 agents have posted
- **THEN** the post fails with `ROOM_MENTION_LIMIT` and nothing is posted

#### Scenario: Ineligible targets are skipped
- **WHEN** a message mentions one archived agent and one idle agent
- **THEN** only the idle agent is woken and the result's `wokenAgentIds` has one id

### Requirement: Human participation in rooms
Humans SHALL read and post in any room of a project they can read (post needs scope `jagentchill.agent.use`), from the Rooms section of the Agents tab: a room list (name, purpose, unread count, last activity) and a message pane with author avatar and role, body, reply threading (one level, "Replying to <author>"), emoji reactions (a fixed set of 12 reactions; no sticker messages), mention autocomplete after typing `@` (members first, then other agents of the tree), and a composer limited to 8,000 characters. A human post in a run room wakes the Lead always and every agent it mentions; other members are not woken. The author shown is the device's display name. Humans can create a room (name, purpose, scope, retention; `jagentchill.agent.room.create`), rename it and change purpose or retention (`.agent.room.update`), archive it (`.agent.room.delete`) and restore it within 30 days (`.agent.room.restore`), and remove a single message (`.agent.room.message.remove`; the message is replaced by "Removed by <device name>"; the removal is audited). Rooms of a tree are visible to a device only when it can read that tree ("Device access to agent sessions"). Unread state is per device. Rooms are also reachable from a room chip in any timeline item that references one. [JAD JD-MA-016, JD-MA-021, JD-MA-023] [NEW]

#### Scenario: Human posts in a run room
- **WHEN** a user posts "Make the intro shorter @editor" in the `team` room
- **THEN** the Lead and the Editor agent each receive one wake prompt and no other member does

#### Scenario: Viewer in a room
- **WHEN** a `viewer` device opens a room
- **THEN** it can read and react is disabled and the composer is replaced by "View only"

#### Scenario: Empty state
- **WHEN** a tree has no rooms
- **THEN** the Rooms section shows "No rooms yet. Agents open rooms to coordinate; you can also create one." with a "New room" button for devices with scope `jagentchill.agent.use`

### Requirement: Team board scope
The product SHALL include a **team board** — the part of JAgentDesk's agent forum that serves coordinated creative production — attached one-to-one to a team run or an ad-hoc team started by Team mode: `Topic {id ("top_" + ULID), runId?, originAgentId?, projectId?, title (1–120 characters), prompt, stage: "discussion" | "planning" | "building" | "review" | "done", archived_ms?, participants [{id, kind: "agent" | "device", role}], pendingHumanQuestion?: {questionId, askedBy, text, created_ms}, created_ms, updated_ms}`. The board has four parts, each specified below: a **thread** (typed messages, votes, replies), **tasks** (assignment, claim, status, estimate, group, sub-tasks, comments), **reviews** (verdict with severity-graded findings) and **diagrams** (versioned workflow-document sketches, exportable to archify). The stage advances only forward in the listed order, one step at a time, and only by the topic's Lead or a human (`BOARD_STAGE_DENIED` otherwise); a human can also move it one step back. Participant roles are the Team's role ids plus `user` and `system`. Not included, by decision: sticker messages, the mermaid diagram format, and any board that is not attached to a team (free agents coordinate through rooms). Topic changes are pushed on `jagentchill.agent.board.updated`. Limits per topic: 2,000 thread messages, 200 tasks, 20 sub-tasks per task, 100 comments per task, 50 diagram versions. [JAD JD-MA-019, JD-MA-021] [NEW]

#### Scenario: Stage advanced by a non-lead
- **WHEN** a Peer calls `jc_board_set_stage {stage: "building"}`
- **THEN** the call fails with `BOARD_STAGE_DENIED`

#### Scenario: Skipping a stage
- **WHEN** the Lead sets the stage from `discussion` to `building`
- **THEN** the call fails with `INVALID_PARAMS`, `details.allowed: ["planning"]`

#### Scenario: Topic created with a run
- **WHEN** a team run starts
- **THEN** exactly one topic exists with `runId` set, stage `discussion`, and the run's members as participants

### Requirement: Board thread
The thread SHALL hold messages `{id, author, kind: "note" | "research" | "proposal" | "question" | "decision" | "review" | "status", body (1–8,000 characters), replyTo?, votes {up, down}, myVote?, created_ms, edited_ms?}`. Agents post with `jc_board_post {topicId?, kind, body, replyTo?}` and vote with `jc_board_vote {messageId, vote: "up" | "down" | "clear"}`; humans post and vote from the Thread tab (`jagentchill.agent.board.post`, `.agent.board.vote`; scope `jagentchill.agent.use`) and change the stage with `.agent.board.stage.set`. One vote per participant per message; changing a vote replaces it. A `decision` message can be posted only by the Lead or a human and is pinned at the top of the thread with the label "Decision"; a `proposal` with more down-votes than up-votes from participants shows the marker "Contested". Messages are ordered by time; replies are shown indented one level under their parent. A human post wakes the Lead always and any participant mentioned by handle. Authors can edit their own message within 10 minutes (the edit time is shown); nobody can delete a message except a human with scope `jagentchill.agent.use`, which leaves "Removed by <device name>". [JAD JD-MA-021, JD-MA-023]

#### Scenario: Vote replaces vote
- **WHEN** a participant who voted `up` votes `down` on the same message
- **THEN** the message shows one fewer up-vote and one more down-vote

#### Scenario: Peer posts a decision
- **WHEN** a Peer calls `jc_board_post {kind: "decision", …}`
- **THEN** the call fails with `TEAM_ROLE_DENIED`

### Requirement: Board tasks
Tasks SHALL be `{id, title (1–160 characters), description (0–8,000), status: "backlog" | "to_do" | "in_progress" | "review" | "blocked" | "done", estimate: "unknown" | "xs" | "s" | "m" | "l" | "xl", group? (1–40 characters; the board's grouping label), parentTaskId?, assigneeId?, assignmentId? (the team assignment that works on it), createdBy, blockedReason?, comments[], created_ms, updated_ms}`. Tools: `jc_board_task_create {title, description?, group?, parentTaskId?, estimate?, assigneeId?}`; `jc_board_task_update {taskId, action: "assign" | "claim" | "status" | "estimate" | "comment" | "edit", …}` where `assign {assigneeId}` is Lead- or human-only, `claim` sets the caller as assignee only when the task has none (`CONFLICT` otherwise), `status {status, blockedReason?}` is allowed for the assignee, the Lead or a human, and `blocked` requires `blockedReason` (1–500 characters); a human uses `jagentchill.agent.board.task.create` and `.agent.board.task.update` with the same fields. Allowed status moves: any → `blocked`; `backlog → to_do → in_progress → review → done`; `review → in_progress`; `blocked →` its previous status; a human can set any status. A task moves to `done` only when it has no open review with verdict `request_changes` and no sub-task that is not `done`. When a Lead creates a Peer assignment with `taskId`, the task's `assigneeId` and `assignmentId` are set and its status becomes `in_progress`; when that assignment is accepted the task becomes `review` (the Team has `reviewRoles`) or `done` (it has none). [JAD JD-MA-019]

#### Scenario: Claim an unassigned task
- **WHEN** a Peer claims a task with no assignee
- **THEN** the task's `assigneeId` is that Peer

#### Scenario: Claim an assigned task
- **WHEN** another Peer claims the same task
- **THEN** the call fails with `CONFLICT` and the assignee is unchanged

#### Scenario: Done with an open change request
- **WHEN** the assignee sets `done` while a review with verdict `request_changes` is open
- **THEN** the call fails with `CONFLICT`, `details.reason: "open_review"`

### Requirement: Board task reviews
A task in status `review` SHALL collect reviews `{id, taskId, reviewerId, reviewerRole, verdict: "approve" | "request_changes", summary (1–2,000 characters), findings [{category: "story" | "pacing" | "continuity" | "visual" | "audio" | "captions" | "brand" | "rights" | "safety" | "technical" | "other", severity: "critical" | "high" | "medium" | "low", text (1–1,000), ref? {kind: "timecode" | "element" | "scene" | "shot" | "file", value}}] (0–50), round, created_ms}` posted with `jc_board_task_review` or from the task detail by a human (`jagentchill.agent.board.review.post`). The Team defines which reviewer roles a task needs (`reviewRoles`, 0–5 role ids; the shipped video and film teams use `reviewer-story`, `reviewer-technical`, `reviewer-compliance` in place of JAgentDesk's BA / Tester / Pentester). A reviewer cannot review a task it is assigned to. A task passes review when every required role has a latest review with verdict `approve` and no finding of severity `critical` or `high` is unaddressed; a `request_changes` verdict moves the task back to `in_progress` and wakes the assignee with the findings. Board task reviews are agent reviews by the `reviewRoles`; they use only the numeric fields of the Team's `resultApproval` (`maxRounds`, `blockOnSeverity`) and never raise a human card of their own: review rounds per task are capped by `resultApproval.maxRounds`, and only at the cap is the task escalated to a person as one sign-off of subject kind `task` (see "Agent reviewer and escalation"). A task review is not a sign-off of the run: the run's single sign-off is the result ("Accepting the result and relaying up"). Findings with a `timecode`, `element`, `scene` or `shot` reference open that location in the editor when pressed. [JAD JD-MA-020] [NEW]

#### Scenario: All required roles approve
- **WHEN** the three required reviewer roles each post `approve` with no critical or high finding
- **THEN** the task passes review and can be set to `done`

#### Scenario: Change request
- **WHEN** one reviewer posts `request_changes` with a `high` finding at timecode 00:00:12:10
- **THEN** the task returns to `in_progress`, the assignee is woken with the finding, and pressing the finding moves the playhead to that timecode

#### Scenario: Self-review
- **WHEN** the task's assignee posts a review on it
- **THEN** the call fails with `TEAM_ROLE_DENIED`

### Requirement: Board diagrams
Agents SHALL publish diagrams to a topic with `jc_board_set_diagram {topicId?, title (1–80), document}` where `document` is a workflow document of `agent-workflows.Workflow document` used as a plan sketch: it MUST pass the schema and the structural checks that `agent-workflows.Graph operations` applies to a batch (ids, ports, type compatibility, geometry ranges, `agent-workflows.Size limits`), while the graph-level rules of `agent-workflows.Validation rules` (trigger, reachability, required inputs) are not required of a sketch; an invalid document fails with `INVALID_PARAMS` and the first 10 errors. Nodes without a `position` receive one from `agent-workflows.Deterministic auto-layout`. Each publish creates a new version `{version (1…), title, authorId, created_ms}`; the latest is shown by default and humans browse earlier versions with a version selector (`jagentchill.agent.board.diagram.get {topicId, version}`) and "Compare with previous" (added, removed and changed nodes highlighted). Diagrams are shown by the canvas in its read-only `view` mode (`workflow-diagram.Canvas modes`) and exported through `workflow-diagram.Archify HTML export on the host` and `workflow-diagram.Image export, copy and print`. A board diagram is never executable: the executable graph of a workflow-backed run remains the stored workflow of `agent-workflows.Workflow document`, and "Open as workflow" (scope `jagentchill.projects.write`) copies a board diagram into a new draft workflow. [JAD JD-MA-022]

#### Scenario: New version
- **WHEN** the Lead publishes a second diagram on a topic
- **THEN** the Diagram tab shows version 2 and the selector lists versions 1 and 2

#### Scenario: Invalid document
- **WHEN** the document has an edge whose target node id does not exist
- **THEN** the call fails with `INVALID_PARAMS` and no version is created

#### Scenario: Sketch without a trigger
- **WHEN** the Lead publishes a document with four connected `agent` nodes and no `trigger` node
- **THEN** version 1 is created and shown read-only, and no run can be started from it

### Requirement: Ask-human state on the board
When a participant of a topic asks the human a question with `jc_session_ask` (indexed in `agent-editing-tools.Tool naming and families`), the server SHALL set the topic's `pendingHumanQuestion`, tag the originating thread message or task "Needs your answer", show a banner at the top of every board tab ("<asker> is waiting for your answer") with the question and an answer field, set the root's `attention` to `question`, and raise one `agent.question` notification. Answering from the banner, from the chat question card of `chat-agent.Agent questions` or from the notification resolves all three surfaces within 1 s and clears `pendingHumanQuestion`. Only one question per topic is pending at a time; a second `jc_session_ask` while one is pending is queued (at most 5; further ones fail with `RATE_LIMITED`) and shown after the first is answered. While a question is pending the run's state is `waiting_human` and assignments not blocked by the question keep running. [JAD JD-MA-023]

#### Scenario: Answer from the board
- **WHEN** the user answers in the banner
- **THEN** the chat question card and the notification show as resolved within 1 s and the asker's turn continues with the answer

#### Scenario: Second question queued
- **WHEN** another participant asks while one question is pending
- **THEN** the banner still shows the first question and the second appears after the first is answered

### Requirement: Board screen
The board SHALL be shown in the "Team" view of the Agents tab with five sub-tabs: **Thread**, **Board**, **Rooms**, **Activity**, **Diagram**. A stage stepper above them shows Discussion / Planning / Building / Review / Done with the current stage filled and completed stages checked. **Board** has six columns Backlog / To do / In progress / Review / Blocked / Done with a count each; cards show title, assignee avatar, estimate, group chip, sub-task progress "2/5" and a review marker; a human drags cards between columns (desktop/web) or uses "Move to…" (touch and keyboard); an overview strip above shows two charts drawn with the categorical tokens of `design-system.Colour tokens` — "Tasks by status" (single stacked bar) and "Tasks by group" (horizontal bars, top 8 groups then "Other"). Task detail opens as a side sheet (desktop/web) or full-height bottom sheet (compact) with description, sub-tasks, comments and reviews. **Activity** replaces JAgentDesk's animated office: one tile per participant (avatar, role label, state word and one line of current activity) whose state is the real agent state mapped to six presentation states — working, reviewing, waiting, talking (posted in a room or thread in the last 10 s), done, idle — with a 2 s looping emphasis on the avatar ring for `working` and `talking` using `design-system.Motion tokens`, replaced by a static ring when the OS "reduce motion" setting is on. Tiles are ordered supervisor, lead, then peers by role label. Empty board: "No tasks yet. The lead adds tasks in the planning stage." [JAD JD-MA-025, JD-MA-026, JD-MA-019] [NEW]

#### Scenario: Drag a card as a human
- **WHEN** a user drags a card from "To do" to "In progress"
- **THEN** the task's status becomes `in_progress` and every connected device shows the move within 1 s

#### Scenario: Activity tile reflects state
- **WHEN** a Peer starts a turn
- **THEN** its tile shows "Working" with the looping ring within 1 s; with reduce-motion on the ring is static

#### Scenario: Viewer on the board
- **WHEN** a `viewer` device opens the Board tab
- **THEN** cards cannot be moved and task detail shows no edit controls

### Requirement: Team model
A Team SHALL be a stored definition `{id (`^[a-z][a-z0-9-]{1,39}$`), name (1–60), description (0–280), templateId?, enabled, roles: TeamRole[] (2–24), routes: {<category>: TeamRoute}, limits {maxConcurrentPeersPerLead (1–12, default 3), maxAssignmentsPerBrief (1–100, default 12), maxRunMinutes (5–1,440, default 240), maxRunCostUsd? (0.01–10,000)}, resultApproval: ApprovalPolicy, proposalApproval?: ApprovalPolicy, writerPolicy: "lead_assigns" | "queue" (default `lead_assigns`), peerMessaging: "via_lead" | "direct" (default `via_lead`), reviewRoles [roleId] (0–5), autoPrepareBrief?, askWhenAmbiguous? (both default to the ORC settings of `orc-model-routing.Task brief preparation`), supervisorScope: "project" | "workspace" | "session" (default `project`), created_ms, updated_ms, rev}` kept in the server host store and read through `jagentchill.orc.team.list|get`. Saving (`jagentchill.orc.team.save`, scope `jagentchill.config.write`) validates the whole object, bumps `rev`, and rejects stale writes with `CONFLICT` when `rev` does not match. The Team has three separate approval settings for three subject kinds, each producing its own approval record and never standing in for another: `resultApproval` — the single sign-off of a run under "Common approval policy" (subject kind `team_result`), raised once when the Lead accepts the result; `proposalApproval` — who accepts a member's proposal on a project (subject kind `proposal`; absent means the home session's mode decides, see "Proposals from team members"); and `reviewRoles` — agent reviews of board tasks (subject kind `task`), which use the numeric fields of `resultApproval` and reach a person only by escalation ("Board task reviews"). Order within a run: proposals are decided as they are submitted, task reviews as tasks reach `review`, and the result sign-off last; an approved result is never re-opened by a proposal decision, because the result cannot be accepted while a proposal it lists is undecided ("Accepting the result and relaying up"). A Team is valid only when it has exactly one enabled role of tier `supervisor` (except `supervisorScope: "session"` ad-hoc teams, which have none), exactly one enabled role of tier `lead`, at least one enabled role of tier `peer`, and every route's targets name enabled peer roles with existing ORC profiles. A host holds at most 50 Teams. Deleting a Team referenced by a workflow node, an automation or a non-terminal run is refused with `CONFLICT` listing the references. Running runs keep the snapshot of the Team taken at start. [NEW] [JAD JD-ORC-019]

#### Scenario: Team without a lead
- **WHEN** a Team is saved with no enabled role of tier `lead`
- **THEN** the save fails with `INVALID_PARAMS`, `details.field: "roles"`, message "A team needs exactly one lead role"

#### Scenario: Stale save
- **WHEN** two admin devices edit the same Team and the second saves with the older `rev`
- **THEN** the second save fails with `CONFLICT` and the first device's changes are intact

#### Scenario: Edit during a run
- **WHEN** a Team's `maxConcurrentPeersPerLead` is changed from 3 to 5 while a run of it is `running`
- **THEN** that run keeps the limit 3 and the next run uses 5

#### Scenario: One sign-off per subject
- **WHEN** a run of a Team with `resultApproval {mode: "human"}`, no `proposalApproval` and three `reviewRoles` runs in a home session in `edit` mode, and a writer Peer submits one proposal on one board task
- **THEN** the person sees one proposal card and, after the Lead accepts the result, one result sign-off card; the task's reviews are decided by the reviewer agents and raise no card unless they escalate

### Requirement: Team roles and tiers
A `TeamRole` SHALL be `{roleId (`^[a-z][a-z0-9-]{1,39}$`, unique in the Team), tier: "supervisor" | "lead" | "peer", label (1–40), orcRole (an ORC role id of `orc-model-routing.Role catalogue`: the coordination roles `supervisor`, `lead`, `peer`; the creative roles `director`, `screenwriter`, `storyboard`, `editor`, `reviewer`; or a custom role per `orc-model-routing.Custom roles`), profileId? (default the ORC role's default profile), personaId? (default the persona bound to `orcRole`; a team-role persona is generated when none exists), agentClass: "creative" | "workspace" (default `creative`), contract: {responsibility (1–1,000 characters), ownershipBoundary (1–1,000), expectedHandback (1–1,000), canWrite: boolean, tools?: [toolName] (subset of the persona's allow-list)}, instructions? (0–4,000; appended after the ORC role instructions of `orc-model-routing.Per-role instructions`), enabled}`. Tier decides the role-scoped tools and the shape rules; `orcRole` decides provider, model, thinking and fallbacks. Any number of peer roles, including custom ones, is allowed, and every surface that lists Peers (plan card, roster, limits) treats every `tier: "peer"` role alike — JAgentDesk's plan card filters on the literal role `peer` and drops custom-role workers; that defect is not reproduced. A role with `agentClass: "workspace"` can be staffed only in runs started by a device permitted by "Agent classes and creation privileges"; otherwise staffing it fails with `AGENT_CLASS_DENIED` and the run panel explains why. [JAD JD-ORC-007, JD-ORC-019] [NEW]

#### Scenario: Custom peer role appears everywhere
- **WHEN** a Team has a custom peer role `colorist` and the Lead creates an assignment for it
- **THEN** the plan card lists the assignment as "Colorist · edit" and it counts toward the peer limits

#### Scenario: Workspace role in an editor-started run
- **WHEN** an `editor` device on a host without "Allow workspace agents for editors" starts a run whose route resolves to a `workspace` role
- **THEN** `jc_team_create_peer` for that route fails with `AGENT_CLASS_DENIED` and the Lead is told to keep the work or choose another route

### Requirement: Shipped team templates
The server SHALL ship these Teams, created at first start when absent, never overwriting user edits, each restorable with "Reset to template" (`jagentchill.orc.team.reset`) and duplicable:

| Template id | Name | Supervisor | Lead | Peer roles (roleId → orcRole) | Route → primary peer (fallback) |
|---|---|---|---|---|---|
| `video-production` | Video production team | `supervisor` → `director` | `producer` → `lead` | `screenwriter` → `screenwriter`; `storyboard` → `storyboard`; `editor` → `editor`; `researcher` → `peer`; `reviewer` → `reviewer` | `script` → screenwriter; `ui` → storyboard; `edit` → editor (reviewer never); `search` → researcher; `research` → researcher; `audit` → reviewer; `planning` → kept by the Lead |
| `film-studio` | Film studio team | `supervisor` → `director` | `showrunner` → `lead` | `screenwriter`; `storyboard`; `casting` → custom role `casting` (characters, locations, props); `voice-director` → custom role `voice-director`; `editor`; `reviewer-story` → `reviewer`; `reviewer-technical` → `reviewer`; `reviewer-compliance` → `reviewer` | `script` → screenwriter; `ui` → storyboard (casting); `edit` → editor; `research` → casting; `search` → casting; `audit` → reviewer-story (reviewer-technical, reviewer-compliance); `planning` → Lead |
| `review-board` | Review board | `supervisor` → `director` | `chair` → `lead` | `reviewer-story`, `reviewer-technical`, `reviewer-compliance` (all → `reviewer`, `canWrite: false`) | `audit` → reviewer-story (reviewer-technical, reviewer-compliance); every other category → kept by the Lead |
| `shorts-factory` | Short-form repurposing team | `supervisor` → `director` | `producer` → `lead` | `clip-scout` → `editor` (`canWrite: false`); `editor` → `editor`; `caption-writer` → `screenwriter`; `reviewer` → `reviewer` | `search` → clip-scout; `edit` → editor; `script` → caption-writer; `audit` → reviewer; `planning`, `research`, `ui` → Lead |
| `ad-hoc` | Ad-hoc team (used by Team mode) | none (`supervisorScope: "session"`; the human supervises) | the session's current agent | `screenwriter`, `storyboard`, `editor`, `researcher` → `peer`, `reviewer` | as `video-production` |

Defaults for all: limits 3 concurrent Peers per Lead, 12 assignments per brief, 240 minutes; `writerPolicy: "lead_assigns"`; `peerMessaging: "via_lead"`; `resultApproval {mode: "human"}`; no `proposalApproval`; `reviewRoles` = the template's reviewer roles. `review-board` sets `reviewRoles: []` and limits 3 / 6 / 60 minutes because its output is findings, not edits. Template names, role labels and contract texts are locale resources (en, vi, ja). No default model id is stored: profiles resolve from the enabled catalogue (`orc-model-routing.Default profiles from the enabled catalogue`). [NEW] [JAD JD-ORC-019]

#### Scenario: First start
- **WHEN** the server starts on a host with no Teams
- **THEN** `jagentchill.orc.team.list` returns the five templates, all enabled

#### Scenario: Reset to template
- **WHEN** an `admin` device presses "Reset to template" on an edited `video-production` Team and confirms
- **THEN** its roles, routes and limits equal the shipped definition and `rev` increased by 1

#### Scenario: Planning route kept by the Lead
- **WHEN** a Lead of `video-production` calls `jc_team_create_peer {route: "planning"}`
- **THEN** the call fails with `TEAM_NO_PEER_ROUTE`

### Requirement: Shipped role contracts
Each shipped role SHALL carry this contract (responsibility; ownership boundary; expected hand-back; write permission):

| Role | Responsibility | Ownership boundary | Expected hand-back | Writes to project |
|---|---|---|---|---|
| supervisor | Single contact for the human; decides whether to delegate; relays the accepted result unchanged | The conversation with the human; never the technical decision | A report to the human in chat | no |
| producer / showrunner / chair (lead) | Turns the brief into bounded assignments, assigns the writer, resolves dissent, accepts the result | The plan, the assignment list, the final decision | `jc_team_accept_result` with summary, evidence, remaining uncertainty | no (assigns the writer) |
| screenwriter / caption-writer | Script, narration, dialogue, hooks, caption copy | Script documents (`script-studio.Script document`); never the timeline | Script version id, diff summary, word count and estimated duration | scripts only |
| storyboard | Shot lists, panel prompts, reference images, title and layout design | Storyboard and reference assets; never committed timeline edits | Shot list id, generated asset ids, open visual choices | assets only |
| casting | Character, location and prop sheets with variants | Film assets of capability `film-production` | Asset ids with chosen variants and rejected alternatives | film assets only |
| voice-director | Voice selection or design, line readings, lip-sync requests | Voice lines and speakers | Voice line ids, voice ids, lines needing a retake | voice lines only |
| editor | Timeline assembly and edits, captions, audio, colour, export | The timeline of the bound project while holding the agent writer token | Proposal id(s), before/after frame references, duration and cut count | yes, through proposals |
| clip-scout | Finds candidate ranges in long footage | Markers and range lists; no edits | Ranked range list with timecodes and reasons | no (markers through proposals of the editor) |
| researcher | Facts, references, stock and library search | Notes and source lists | Sources with licence notes and confidence | no |
| reviewer, reviewer-story | Read-only review of story, pacing and continuity | Findings only | Verdict and severity-graded findings with timecodes | no |
| reviewer-technical | Audio levels, caption timing, cuts, export conformance | Findings only | Verdict, measured values against targets | no |
| reviewer-compliance | Brand rules, rights and licences, content safety | Findings only | Verdict, items needing a human decision | no |

A role with "no" in the last column has `contract.canWrite: false`: its write tools are removed from its catalogue for the run and a write attempt through any path is refused with `TEAM_ROLE_DENIED`. [NEW]

#### Scenario: Reviewer attempts an edit
- **WHEN** a `reviewer-technical` Peer calls `jc_clip_trim`
- **THEN** the call is refused with `TEAM_ROLE_DENIED` and no proposal is staged

#### Scenario: Screenwriter writes a script
- **WHEN** the `screenwriter` Peer saves a script version
- **THEN** the save succeeds and the timeline is unchanged

### Requirement: Teams settings page
Settings → Agents → Teams SHALL be available on every platform (edit needs scope `jagentchill.config.write`; others see it read-only with "Managed by the host admin"). It contains: (1) a card "Orchestration" with switches "Enable teams" (`orc.teams.enabled`, default on), "Prepare a task brief automatically" and "Ask when a decision is missing" (the ORC switches of `orc-model-routing.Task brief preparation`, which here have real effect), and two steppers "Peers working at once per lead" (1–12) and "Assignments per brief" (1–100) that set the defaults for new Teams; (2) a list of Teams (name, role count, enabled switch, "Template" badge when unmodified) with "New team", "Duplicate", "Reset to template", "Delete"; (3) a Team editor, addressable at `/settings/host/[hostId]/teams/[teamId]` (the list is `/settings/host/[hostId]/teams`; an unknown `teamId` shows "This team no longer exists" with a link to the list), with sections **Roles** — one block per role with enable switch, tier, label, ORC role picker, profile list of that ORC role with the default marked "· default" and a set-default action, "Add profile"/"Edit profile" opening `orc-model-routing.Profile modal` (provider, model picker with free-text entry "Enter a model id" when the host reports no model list and "Detecting available models on this host…" while loading, thinking option, mode), agent class, contract fields, a multi-line "Instructions" field with the helper "Added to this role's agents when they are created", and "Remove role" for non-required roles; "Add role" (role id, label, tier, ORC role); **Routing** — one row per route category with "Primary", an ordered "Fallbacks" list (0–5, drag to reorder), "Only providers starting with" (the guard), "Thinking override" and "Route instructions" (0–4,000 characters; helper "Extra guidance for how the lead interprets this route"); **Limits**; **Approval** (two editors of "Common approval policy", each limited by the host minimum: "Result sign-off" for `resultApproval` and "Proposals" for `proposalApproval` with the first option "Follow the session's mode", plus the "Task reviewers" role list for `reviewRoles`); **Writer policy**; **Peer messaging**. JAgentDesk has no editor for fallbacks and the guard; both are editable here. Validation errors are shown inline on the field and block saving. When teams are unavailable the page shows "Teams are unavailable on this host." [JAD JD-ORC-019, JD-ORC-020] [NEW]

#### Scenario: Model list unavailable
- **WHEN** the profile modal opens for a provider whose model list failed to load
- **THEN** the model field is a free-text input with the placeholder "Enter a model id"

#### Scenario: Removing a required role
- **WHEN** the user opens the menu of the only lead role
- **THEN** "Remove role" is disabled with the tooltip "A team needs exactly one lead role"

#### Scenario: Compact layout
- **WHEN** the page is opened at the compact form factor of `design-system.Breakpoints and layout constants`
- **THEN** the Team list and the editor are separate screens with a back button and the fallback list reorders with "Move up"/"Move down" actions instead of drag

### Requirement: Board tools
In addition to the tools named in the board requirements, agents SHALL have `jc_board_get {topicId?, include? ["thread", "tasks", "reviews", "diagram"], sinceCursor?, limit? (1–100, default 30)}` (read-only; returns the topic header, `stage`, `pendingHumanQuestion`, and the requested parts, thread newest-last) and `jc_board_set_stage {topicId?, stage, note? (0–500 characters)}` (Lead only; posts a `status` thread message "Stage: <from> → <to>"). `topicId` defaults to the topic of the caller's team run. All `jc_board_*` tools are offered only to participants of a topic and return `BOARD_NOT_FOUND` for any other topic id. Board tools never start agents; staffing is done only with `jc_team_create_peer`, in ad-hoc teams too. [JAD JD-MA-019] [NEW]

#### Scenario: Agent outside the topic
- **WHEN** an agent that is not a participant calls `jc_board_get` with a valid topic id of another run
- **THEN** the result is `BOARD_NOT_FOUND`

#### Scenario: Stage change is announced
- **WHEN** the Lead calls `jc_board_set_stage {stage: "planning", note: "Script direction agreed"}`
- **THEN** the topic's stage is `planning` and the thread has a `status` message "Stage: Discussion → Planning" with the note

### Requirement: Starting a team run
A team run SHALL be started through one function reachable from: the slash commands of "Team slash commands", the request box of the team run panel ("What do you want the team to do?", helper "Enter to send · Shift+Enter for a new line"), `jagentchill.orc.run.start {teamId, request (1–32,000 characters), projectId?, workspaceId?, sessionId?, attachments?, orcOverrides?, approval?, limits?}` and the `team` node (`agent-workflows.Team node`). Guards, in order, each stopping the start with its message: empty request → "Enter what you want the team to do."; teams disabled, the Team disabled, or its supervisor role disabled → "Teams or the supervisor role are turned off in Settings → Agents → Teams." (`TEAM_DISABLED`); no connected host → "Connect to the host before starting a team."; the device lacks `jagentchill.agent.use` → `SCOPE_DENIED`; a project-editing Team with no bound project → "Open or choose a project for the team to work on." (`NO_PROJECT_BOUND`). Attachments are accepted and become part of the brief's `context` (JAgentDesk silently ignores client commands with attachments; that defect is not reproduced). After the guards the function creates the run record first, with `status: "briefing"`, and then prepares the brief; `jagentchill.orc.run.start` returns `{runId, status, brief?, homeSessionId?}` with `ok: true` in every case that passed the guards — `status: "needs_clarification"` together with the brief when a person has to answer first, otherwise `running`. A person answers with `jagentchill.orc.run.answerBrief {runId, answers[] | brief}` (the edited brief of "Edit brief"), which returns the run to `briefing`; a run left in `needs_clarification` is cancelled by `jagentchill.orc.run.cancel` or by its parked timeout ("Team limits"). `BRIEF_NEEDS_CLARIFICATION` is kept only as the failure code of a `team` node in an unattended workflow run ("Workflows invoking teams"). When the brief is `ready` the function creates the topic and the `team` room, and starts or reuses the Supervisor. **Home session.** The run's home session is the Supervisor's session (`homeSessionId` on the run record); `sessionId` on `orc.run.start` and on the run record is the originating session and is used only for de-duplication, for the session's default Team and for one timeline item "Team run started — Open" in the originating session; after a start from `/team` or `/orc` the client navigates to the home session. Wherever this capability says "root session" for a team run it means the home session, the root of the requesting agents' tree: approval, proposal, sign-off, plan and question cards, the roster and the badge counts live there. A new Supervisor is created in the product mode of the originating session, capped by its profile's mode, owned by the starting device and `private` like every new session; a reused Supervisor keeps its own record. In an ad-hoc team ("Team mode in the composer") and in a run with no originating session the home session and the originating session are the same. Double starts are de-duplicated: an identical `(sessionId, teamId, request)` within 30 s joins the in-flight start and returns the same `runId`. [JAD JD-ORC-001, JD-ORC-002, JD-MA-024] [NEW]

#### Scenario: Empty request
- **WHEN** `/team` is sent with no text
- **THEN** nothing starts and the composer shows "Enter what you want the team to do."

#### Scenario: Teams disabled
- **WHEN** `orc.teams.enabled` is false
- **THEN** `jagentchill.orc.run.start` fails with `TEAM_DISABLED` and the UI shows the settings hint with a link to Settings → Agents → Teams for devices with scope `jagentchill.config.write`

#### Scenario: Double send
- **WHEN** the same request is submitted twice within 30 s from the same session
- **THEN** one run exists and both calls return its `runId`

#### Scenario: Run record exists while the brief is prepared
- **WHEN** `/team` is sent with a request and the brief model call takes 6 s
- **THEN** `jagentchill.orc.run.get` returns the run with `status: "briefing"` during those 6 s and the Team run panel shows it

#### Scenario: Start from a chat session
- **WHEN** the user sends `/team make a 30 s teaser` in session S and a Supervisor session is created
- **THEN** S shows one item "Team run started — Open", the app shows the Supervisor's session, and every subsequent card of the run appears in the Supervisor's session, not in S

### Requirement: Task brief
A task brief SHALL be `{id ("brf_" + ULID), runId?, rawRequest, objective (≥ 3 characters), context?, constraints [string], acceptedDecisions [string], requestedOutcome, acceptanceCriteria [string] (≥ 1), validationPlan [string] (≥ 1), openQuestions [string], deliverables [{kind: "project" | "script" | "export" | "review" | "assets" | "other", description}], routeCategory, selectedRoute {roleId, profileId, thinking?}, estimate? {usd?, minutes?}, normalizedPrompt, authoredBy: "model" | "parser", status: "ready" | "needs_clarification", created_ms}`; the shape extends `orc-model-routing.Task brief preparation`, whose RPC `jagentchill.orc.brief.prepare {rawRequest, teamId?, projectId?, routeCategory?}` returns a brief without starting work. Route categories are `planning`, `script`, `edit`, `search`, `research`, `audit`, `ui` (visual design: storyboard, layout, titles) plus any category a Team adds to its `routes` (`^[a-z][a-z0-9_]{1,23}$`, at most 12 per Team). When absent, `acceptanceCriteria` defaults to "The requested result exists in the project and was reviewed against the request." and `validationPlan` to "Render the affected range, check it against each acceptance criterion, and list what was not verified." `normalizedPrompt` is the text given to the Supervisor: objective, context, constraints, accepted decisions, requested outcome, acceptance criteria, validation plan, route category, selected profile. Briefs are stored with the run and shown as the brief card. [JAD JD-ORC-003, JD-ORC-004] [NEW]

#### Scenario: Defaults applied
- **WHEN** a request states only an objective
- **THEN** the brief has the default acceptance criterion and validation plan and `status: "ready"`

#### Scenario: Objective too short
- **WHEN** the objective resolves to 2 characters
- **THEN** the brief is `needs_clarification` with the open question "What does the team need to produce?"

### Requirement: Brief authoring and clarification
The brief SHALL be authored in one of two ways, selected by `autoPrepareBrief` (Team value, else the ORC setting). **On:** a model call on the Team supervisor role's `quick` route produces the brief fields from the request, the bound project's summary (name, duration, canvas, track counts, script titles) and attachments, with structured output validated against the brief schema; an invalid or failed model result falls back to the parser and sets `authoredBy: "parser"`. **Off:** a deterministic parser buckets lines of the form `Label: text` by label — objective/goal, context, constraints, accepted decisions/decisions, requested outcome/outcome, deliverables, acceptance criteria/acceptance, validation/validation plan, route/category — with unlabelled text going to the objective and list markers stripped; labels and inference keywords are matched in English, Vietnamese and Japanese from locale resources. Route category is the explicit `route:` label, else the caller's `routeCategory`, else keyword inference in this order: review/audit/check → `audit`; storyboard/layout/title design/look → `ui`; find/search/locate → `search` (or `research` when compare/research words also appear); script/narration/dialogue/caption copy → `script`; cut/trim/edit/assemble/timeline/export → `edit`; plan/outline/approach → `planning`; default `edit`. `askWhenAmbiguous` on: a non-empty `openQuestions` makes the brief and the run `needs_clarification`, no member is created, one `agent.question` notification is raised, and the questions are shown in the brief card under "Needs your decision" in the Team run panel; answering (`jagentchill.orc.run.answerBrief`) returns the run to `briefing` and re-prepares the brief with the answers appended to `acceptedDecisions`, at most 3 clarification rounds, after which remaining questions become stated assumptions. `askWhenAmbiguous` off: open questions are converted to assumptions listed in `acceptedDecisions` prefixed "Assumed: " and the brief is `ready`. Independently of both switches an empty request or an objective shorter than 3 characters is always `needs_clarification`. [JAD JD-ORC-003, JD-ORC-004] [NEW]

#### Scenario: Parser with labels
- **WHEN** `autoPrepareBrief` is off and the request is "Goal: 30 s teaser\nConstraints: keep the logo sting\nRoute: script"
- **THEN** the brief has that objective, one constraint, `routeCategory: "script"` and `authoredBy: "parser"`

#### Scenario: Ask when ambiguous
- **WHEN** both switches are on and the model returns two open questions
- **THEN** `jagentchill.orc.run.start` returns `ok: true` with `{runId, status: "needs_clarification", brief}`, no Supervisor turn starts, and the brief card of that run lists the two questions under "Needs your decision"
- **AND** after `jagentchill.orc.run.answerBrief` with two answers the run is `briefing` and then `running`, and the answers are in `acceptedDecisions`

#### Scenario: Do not ask
- **WHEN** `askWhenAmbiguous` is off and the model returns two open questions
- **THEN** the brief is `ready`, `openQuestions` is empty and `acceptedDecisions` contains two entries starting with "Assumed: "

#### Scenario: Model output invalid
- **WHEN** the model's structured output fails schema validation
- **THEN** the parser result is used, `authoredBy` is `"parser"`, and the brief card shows the note "Prepared without a model"

### Requirement: Supervisor reuse and creation
A Team with `supervisorScope: "project"` (default) SHALL have at most one Supervisor agent per `(teamId, projectId)`; `workspace` scope keys on `(teamId, workspaceId)`. When a non-archived, non-closed agent with `jc.team.tier=supervisor` exists for the key and the starting device can act on its session ("Device access to agent sessions"; otherwise a new Supervisor is created for that device), a new brief reuses it: its `jc.team.brief` and `jc.team.run` labels are updated and the brief's prompt is sent to it as a follow-up. **Fresh sub-tree per run:** a reused Supervisor never reuses members of an earlier run — the Lead, Peers and reviewers of a finished run were disposed of when it ended ("Team run state machine"), every run creates its own Lead and Peers, and the agent count of "Tree limits" starts at zero for the run. Otherwise a Supervisor is created from the supervisor role's default profile (provider, model, thinking **and mode** — JAgentDesk drops the profile's mode at creation; that defect is not reproduced), titled with the first line of the request cut to 60 characters, as a root agent owned by the starting device and listed in the sidebar with a "Team" badge. A reused Supervisor that still has a non-terminal run is not given a second one: the start returns `CONFLICT` with `details.runId` and the UI offers "Open the running team" and "Queue after it" (queued starts run in order, at most 5 per Supervisor). [JAD JD-ORC-005]

#### Scenario: Second brief on the same project
- **WHEN** a run finished and the user starts another on the same project with the same Team
- **THEN** no new Supervisor is created, the existing one receives the new brief, and the Lead it bootstraps is a new agent whose `jc.team.run` is the new run

#### Scenario: Supervisor busy
- **WHEN** a start is requested while that Supervisor's run is `running`
- **THEN** the start returns `CONFLICT` with the running `runId`, and choosing "Queue after it" starts the second run when the first reaches a terminal state

#### Scenario: Title from the request
- **WHEN** the request's first line has 90 characters
- **THEN** the created Supervisor's title is its first 60 characters

### Requirement: Supervisor runtime contract
The Supervisor's prompt SHALL be the brief's `normalizedPrompt`, the supervisor role's ORC and Team instructions (JAgentDesk omits the configured instructions; they are included here), and a runtime contract stating: it is the single contact for the human; it does simple work itself and delegates only when the work needs parallel workstreams or a specialist role; when delegating it calls `jc_team_bootstrap_lead` exactly once per brief; it never uses generic agent creation or messaging to bypass the topology; the requested route and preferred profile; the Team's limits (concurrent Peers per Lead and assignments per brief); and that it reports the accepted result to the human without changing the decision. The contract's rules are enforced at the server's tool endpoint and by Gateway tool policy (see "Team shape enforcement at the tool endpoint"), not by the prompt alone. A Supervisor that completes the brief itself ends the run by calling `jc_team_accept_result {summary, evidence, remainingUncertainty}` — the same tool the Lead uses, accepted from the Supervisor only while the run has no Lead — after which its report to the human ends the run as `completed` with `delegated: false`, subject to the Team's `resultApproval`. A Supervisor turn that ends without `jc_team_bootstrap_lead`, `jc_team_accept_result` or a question asked with `jc_session_ask` (which makes the run `waiting_human`) is not completion, even when its text asks something: it is handled by the stall rule of "Team run state machine". [JAD JD-ORC-006]

#### Scenario: Simple request
- **WHEN** the brief is "Rename the project to Spring teaser" and the Supervisor does it itself and calls `jc_team_accept_result`
- **THEN** no Lead is created and the run ends `completed` with `delegated: false`

#### Scenario: Supervisor only asks a question
- **WHEN** the Supervisor's first turn ends with a text question to the human and no tool call that changes the run
- **THEN** the run is not `completed`; it stays `running` in stage `supervisor` and the stall rule applies

#### Scenario: Second bootstrap in one brief
- **WHEN** the Supervisor calls `jc_team_bootstrap_lead` twice for the same brief
- **THEN** the second call returns the existing Lead with `reused: true` and creates nothing

### Requirement: Role-scoped team tools
Inside a run the tool catalogue SHALL be decided from the caller's tier label and the run record:

| Tier | Team tools | Other multi-agent tools |
|---|---|---|
| supervisor | `jc_team_bootstrap_lead`, `jc_team_accept_result` (only while the run has no Lead) | `jc_agent_status`, `jc_agent_activity`, `jc_agent_list`, `jc_agent_send` (to the Lead only), `jc_agent_wait`, rooms, board read |
| lead | `jc_team_create_peer`, `jc_team_resolve_dissent`, `jc_team_accept_result` | `jc_agent_status|activity|list|wait`, `jc_agent_cancel` (own Peers), `jc_agent_handoff` (scope `lead`), `jc_agent_permission_list|respond`, rooms, all board tools, `jc_board_set_stage` |
| peer (any peer role) | `jc_agent_handback` | `jc_agent_status` (self), `jc_agent_send` (to Peers of the same run; only when the Team's `peerMessaging` is `direct`; `wait: "none"` only), rooms, board read, `jc_board_post`, `jc_board_task_update` (claim, status, comment on own tasks), `jc_board_task_review` (reviewer roles), `jc_session_ask` |

Tools not listed for a tier are absent from that agent's catalogue for the duration of the run, and calling one through any path returns `TEAM_ROLE_DENIED` naming the tool to use instead. An agent is "in a run" when it has the `jc.team.run`, `jc.team.tier` and `jc.team.brief` labels and the run is not terminal. When the run ends its Lead, Peers and reviewers are disposed of ("Team run state machine") and never run again outside it; the Supervisor, and the session agent that led an ad-hoc team, keep their labels for history and receive their normal catalogue again at their next turn. [JAD JD-ORC-007]

#### Scenario: Peer catalogue
- **WHEN** a Peer's turn starts
- **THEN** `tools.effective` for its session lists `jc_agent_handback` and none of `jc_agent_create`, `jc_team_create_peer`, and no `jc_agent_send` under `via_lead`; under `direct` it lists `jc_agent_send`

#### Scenario: Lead tries a supervisor tool
- **WHEN** the Lead calls `jc_team_bootstrap_lead`
- **THEN** the result is `TEAM_ROLE_DENIED`

### Requirement: Tool jc_team_bootstrap_lead
`jc_team_bootstrap_lead {relay (1–12,000 characters: what the human wants, in the Supervisor's words), title? (1–60)}` SHALL be callable only by the run's Supervisor and SHALL, in order: (1) when the run already has a Lead that is alive (not archived, not `closed`, session present) return it with `reused: true`; when that Lead is not alive fail with `TEAM_LEAD_UNHEALTHY` and the message "This run's lead is not available. A person must replace it from the team panel."; (2) otherwise verify that no other non-archived agent carries `jc.team.tier=lead` for this run (`TEAM_TOPOLOGY_VIOLATION` naming them); Leads of earlier runs are never reused — a Lead of a terminal run that was not yet disposed of is closed and archived first; (3) create a Lead: the lead role must be enabled; candidates are the role's default profile first, then its other enabled profiles in list order; each is tried in turn, and when all fail the call fails with `NO_ROUTE` and `details.attempts [{profileId, error}]`. The Lead is created in the background with the Supervisor as parent and owner and completion notification armed. Its prompt contains: role and ownership statement, project and workspace, the brief, the text under "Human relay:", the Team's limits, the list of routes with their peer roles, and the lead role's instructions (a built-in default text when none is configured). Result `data`: `{leadAgentId, reused, profileId, model}`. The run moves to stage `lead`. [JAD JD-ORC-009, JD-ORC-010, JD-ORC-024]

#### Scenario: Default profile fails, second succeeds
- **WHEN** the lead role's default profile fails session creation and its second enabled profile succeeds
- **THEN** the Lead runs on the second profile and `profileId` in the result names it

#### Scenario: Unhealthy Lead
- **WHEN** the run's Lead session no longer exists and the Supervisor calls the tool again
- **THEN** the call fails with `TEAM_LEAD_UNHEALTHY` and the run panel shows "Replace lead" to devices with scope `jagentchill.agent.use`

#### Scenario: Two Leads labelled for one run
- **WHEN** two non-archived agents carry `jc.team.tier=lead` for the same run
- **THEN** the call fails with `TEAM_TOPOLOGY_VIOLATION` and the message names both agents

#### Scenario: Lead of an earlier run
- **WHEN** the Supervisor bootstraps a Lead for its second run 20 s after the first run completed
- **THEN** the first run's Lead is closed and archived and a new Lead is created for the second run

### Requirement: Tool jc_team_create_peer
`jc_team_create_peer {route (a route category of the Team), assignment (1–12,000 characters), ownershipBoundary (1–2,000), expectedHandback (1–2,000), title? (1–60), taskId?, grantsWrite? (boolean, default false), budgetUsd?}` SHALL be callable only by the run's registered Lead and SHALL create one Peer for one bounded assignment. After the limit checks of "Team limits" and route resolution of "Team route selection", the Peer is created in the background with the Lead as parent and owner and completion notification armed, with the labels of "Agent labels". Its prompt contains: role label and tier, route, execution profile, ORC role instructions, Team role instructions and contract, route instructions, the assignment, the ownership boundary, the expected hand-back, whether it holds the agent writer token, and the hand-back field list with the rule that work is returned only with `jc_agent_handback`. The run record gains an assignment `{id ("asg_" + ULID), agentId, parentAgentId, roleId, routeCategory, profileId, fallbackUsed, taskId?, grantsWrite, status: "active", moreEvidenceUsed: false, created_ms}`. `grantsWrite: true` is accepted only for a role with `contract.canWrite` and only when no other active assignment on the same project holds it (`WRITER_HELD` otherwise). Result `data`: `{assignmentId, agentId, roleId, profileId, model, fallbackUsed}`. [JAD JD-ORC-011, JD-ORC-024]

#### Scenario: Bounded assignment
- **WHEN** the Lead calls the tool with route `script`, an assignment, an ownership boundary and an expected hand-back
- **THEN** a screenwriter Peer starts, the run has one `active` assignment, and the plan card lists it

#### Scenario: Missing ownership boundary
- **WHEN** `ownershipBoundary` is omitted
- **THEN** the call fails with `INVALID_PARAMS`, `details.field: "ownershipBoundary"`

#### Scenario: Second writer
- **WHEN** an Editor Peer holds `grantsWrite` and the Lead creates another assignment with `grantsWrite: true` on the same project
- **THEN** the call fails with `WRITER_HELD` with `details.holderAgentId`

### Requirement: Team route selection
For a route category the coordinator SHALL build candidates from the Team's `TeamRoute {primary: {roleId, profileId?, thinking?}, fallbacks: [same] (0–5), guardProviderPrefix?, instructions?}` in order primary then fallbacks, and drop a candidate when: its role is missing or disabled; its role's tier is not `peer` (a route that targets the Lead, such as `planning` in shipped Teams, cannot staff a Peer); its profile is missing or disabled; the profile's provider does not start with `guardProviderPrefix`; the profile fails `orc-model-routing.Capability matching`; its runtime is not eligible per "Runtime eligibility for team roles"; or its agent class is not permitted for the run. No candidate left → `TEAM_NO_PEER_ROUTE` with the message "Route <category> does not resolve to a peer role; keep this work with the lead or choose another route". Remaining candidates are tried in order: a candidate whose session creation or first-turn start fails with a class in the ORC `fallbackOn` set moves on to the next; when all fail the call fails with `NO_ROUTE` and `details.attempts[]`. Thinking is the route target's override, else the profile's. Retries inside one candidate, their delays and the wait before the next candidate are the single policy of `generation-providers.Retry policy`, applied in the order of `orc-model-routing.Route resolution and fallback`; the coordinator adds no retry loop of its own, and this requirement adds only the tier filter, the provider-prefix guard, the runtime-eligibility filter and the class filter. A used fallback is disclosed on the assignment row ("fallback") and in the run's event log. [JAD JD-ORC-012]

#### Scenario: Guard drops the primary
- **WHEN** route `edit` has `guardProviderPrefix: "openai"` and the primary profile's provider is `anthropic`
- **THEN** the primary is skipped and the first fallback whose provider starts with `openai` is used with `fallbackUsed: true`

#### Scenario: Disabled role
- **WHEN** the primary's role is disabled and there is no fallback
- **THEN** the call fails with `TEAM_NO_PEER_ROUTE`

#### Scenario: Per-route thinking override
- **WHEN** route `search` sets `thinking: "low"` on its primary
- **THEN** the Peer runs with thinking `low` although its profile says `high`

### Requirement: Team limits
Two limits SHALL apply to every `jc_team_create_peer`, both configurable per Team and both checked against the run snapshot: **`maxConcurrentPeersPerLead`** (default 3, range 1–12) — the number of this Lead's assignments in status `active` or `dissent_open` whose agent is `creating`, `running` or `waiting` must be below the limit, else `TEAM_LIMIT_CONCURRENT_PEERS` ("3 peers are already working. Wait for a hand-back or cancel one."); **`maxAssignmentsPerBrief`** (default 12, range 1–100) — the number of assignments ever created for this brief, in any status including `failed` and `cancelled`, must be below the limit, else `TEAM_LIMIT_ASSIGNMENTS`. JAgentDesk's single `maxPeersPerLead` counts handed-back and accepted assignments, which makes it a total per brief and blocks legitimate sequential work; the two limits here separate the cases. In addition: `maxRunMinutes` (default 240) and `maxRunCostUsd` end the run as `failed` with `endReason` `time_limit` or `budget_limit` after aborting running members; the tree limits of "Tree limits" and the ceilings of "Loop prevention" apply as well and the stricter value wins. **What the clock counts:** `maxRunMinutes` counts time in status `running` only (`runningMs` on the run record); time in `briefing` counts, and time in `needs_clarification`, `waiting_human` or `paused` — waiting for a person — never counts, so a parked sign-off is never ended by the run's time limit. A run that has been continuously in `needs_clarification`, `waiting_human` or `paused` for the host setting `orc.parkedTimeoutHours` (default 72, range 1–720) ends `cancelled` with `endReason: "parked_timeout"`; its subject keeps its versions and records and can still be approved afterwards outside the run. A human with scope `jagentchill.agent.use` and act access to the run's home session can raise `maxAssignmentsPerBrief` for one run by 12 at a time (to at most 100) from the limit banner in the run panel (`jagentchill.orc.run.raiseLimit`); raising `maxConcurrentPeersPerLead` for a run needs scope `jagentchill.config.write`. [JAD JD-ORC-013] [NEW]

#### Scenario: Concurrent limit frees up after a hand-back
- **WHEN** three Peers are active with a limit of 3, one hands back and becomes idle, and the Lead creates another Peer
- **THEN** the call succeeds

#### Scenario: Total limit
- **WHEN** 12 assignments were created for the brief (9 accepted, 3 active) and the Lead creates a 13th
- **THEN** the call fails with `TEAM_LIMIT_ASSIGNMENTS`, `details: {limit: 12, created: 12}`, and the run panel shows "Allow 12 more assignments"

#### Scenario: Time limit
- **WHEN** a run has spent `maxRunMinutes` in status `running`
- **THEN** running members are aborted, the run is `failed` with `endReason: "time_limit"`, and one `agent.failed` notification is raised

#### Scenario: Waiting for a person does not consume the limit
- **WHEN** a run with `maxRunMinutes` 240 ran 30 minutes and then waited 6 hours in `waiting_human` for a result sign-off
- **THEN** the run is still `waiting_human`, `runningMs` is 30 minutes, and approving the result lets it continue

#### Scenario: Parked timeout
- **WHEN** a run has been `waiting_human` for 72 hours with the default `orc.parkedTimeoutHours`
- **THEN** it ends `cancelled` with `endReason: "parked_timeout"` and its pending subject is still readable

### Requirement: Team hand-back
Inside a run, `jc_agent_handback` SHALL additionally require that the caller is a Peer whose owner is the run's current Lead and whose assignment is `active`; the hand-back record is stored in the run, the assignment becomes `handed_back`, the Peer becomes `idle`, the agent writer token it held is released, and the Lead receives a structured hand-back message carrying the assignment id, the role, the four required fields and any optional fields. A hand-back from a Peer whose assignment is not `active` (already handed back, accepted or cancelled) fails with `CONFLICT`. A Peer that ends its turn without a hand-back is prompted once ("Return your work with jc_agent_handback"); when it ends a second turn without one, the assignment becomes `failed` with reason `no_handback` and the Lead is notified — JAgentDesk has no path that marks an assignment failed. An assignment also becomes `failed` when its agent's turn fails 3 consecutive times, and `cancelled` when the Lead or a human cancels the Peer. [JAD JD-ORC-014] [NEW]

#### Scenario: Hand-back updates the run
- **WHEN** an active Peer hands back
- **THEN** its assignment is `handed_back`, the run has one more hand-back record, and the Lead's timeline shows the hand-back card

#### Scenario: No hand-back twice
- **WHEN** a Peer ends two consecutive turns without calling `jc_agent_handback`
- **THEN** its assignment is `failed` with reason `no_handback` and the Lead receives a notification with `outcome: "failed"`

### Requirement: Dissent resolution
A hand-back with `outcome: "disagree"`, a non-empty `requestedResolution`, or a Lead decision to challenge it SHALL open a dissent `{id, assignmentId, peerAgentId, claim?, requestedResolution?, status: "open" | "resolved", outcome?, rationale?, nextAction?, verificationRound (0 | 1), created_ms, resolved_ms?}` and set the assignment to `dissent_open`. The Lead closes it with `jc_team_resolve_dissent {assignmentId, outcome, rationale (1–4,000 characters), nextAction? (0–2,000)}` where `outcome` is one of exactly three values: **`RESOLVED_BY_LEAD`** — the Lead decides; the assignment returns to `handed_back` and the Peer receives the resolution ending with "The lead has closed this dissent. Do not reopen it."; **`NEEDS_MORE_EVIDENCE`** — allowed at most once per assignment (`TEAM_DISSENT_ROUND_USED` on a second attempt); the assignment returns to `active` with `moreEvidenceUsed: true` and `verificationRound: 1`, the Peer receives `nextAction` as a bounded request and must hand back again; **`ESCALATED_TO_HUMAN`** — the run moves to `waiting_human`, the dissent is shown in the run panel with both positions side by side and the actions "Side with lead", "Side with <peer role>", "Give other direction" (free text, 1–4,000 characters), one `agent.dissent_escalated` notification is raised (`notifications.Notification event catalogue`), and the human's decision (`jagentchill.orc.run.resolveEscalation`, scope `jagentchill.agent.use`) is delivered to the Lead as binding. JAgentDesk records the escalation with no notification to the human; that gap is closed. The target must be a Peer of this brief whose owner is this Lead. An escalated dissent is a sign-off by a person: in an unattended run it parks under "Unattended behaviour of approvals" and is never decided by a timer. [JAD JD-ORC-015] [NEW]

#### Scenario: One more-evidence round
- **WHEN** the Lead answers `NEEDS_MORE_EVIDENCE`, the Peer hands back again, and the Lead answers `NEEDS_MORE_EVIDENCE` a second time
- **THEN** the second call fails with `TEAM_DISSENT_ROUND_USED` and the message lists the two remaining outcomes

#### Scenario: Escalation reaches the human
- **WHEN** the Lead answers `ESCALATED_TO_HUMAN`
- **THEN** the run is `waiting_human`, the run panel shows the dissent with three actions, and exactly one `agent.dissent_escalated` notification exists for it

#### Scenario: Human decides
- **WHEN** the user presses "Side with editor"
- **THEN** the dissent is `resolved` with `outcome: "ESCALATED_TO_HUMAN"` and the decision recorded, the Lead receives the decision, and the run returns to `running`

### Requirement: Accepting the result and relaying up
`jc_team_accept_result {summary (1–12,000 characters), evidence (1–12,000), remainingUncertainty (1–12,000), artefacts? [{kind, id, title}] (0–50), acceptedAssignmentIds? (default all `handed_back`)}` SHALL be callable only by the run's Lead (or by the Supervisor of a run that has no Lead, per "Supervisor runtime contract") and only when no dissent is `open` (`CONFLICT`, `details.openDissents`) and no proposal listed in the artefacts of an assignment being accepted is still pending or was rejected (`CONFLICT`, `details.pendingProposals` / `details.rejectedProposals`; the Lead waits for the decision, or reassigns the work). The call stores the candidate result and raises the run's **single result sign-off** — one approval record of subject kind `team_result` under the effective `resultApproval` ("Common approval policy"): `auto` approves at once, `agent` runs the reviewer rounds of "Agent reviewer and escalation", `human` puts the run in `waiting_human` until a person decides with `jagentchill.orc.signoff.resolve`; "Request changes" returns the note to the Lead and the tool can be called again. On approval it stores `acceptedResult {summary, evidence, remainingUncertainty, artefacts, acceptedBy, accepted_ms, approvalId}`, turns the named `handed_back` assignments into `accepted`, moves the run to stage `relay`, and sends the Supervisor a structured message ending with "Report this to the user without changing the decision." The Supervisor's report to the human ends the run as `completed`; a Supervisor that is gone makes the tool fail with `AGENT_NOT_FOUND` and the run panel offers "Show result here" (`jagentchill.orc.run.showResult`), which presents the accepted result card directly to the human and completes the run. In an ad-hoc team (no Supervisor) the accepted result is posted by the Lead in the session's chat. Assignments still `active` at acceptance are listed in the result card as "Not included" and stay running until the Lead or a human cancels them or the run ends, at which point they are cancelled. [JAD JD-ORC-016]

#### Scenario: Accept and relay
- **WHEN** the Lead accepts with two `handed_back` assignments
- **THEN** both become `accepted`, the Supervisor receives the relay message, and after its report the run is `completed`

#### Scenario: Open dissent blocks acceptance
- **WHEN** a dissent is `open` and the Lead calls the tool
- **THEN** the call fails with `CONFLICT`, `details.openDissents` listing its id

#### Scenario: Supervisor gone
- **WHEN** the Supervisor was archived before acceptance
- **THEN** the tool fails with `AGENT_NOT_FOUND` and "Show result here" completes the run with the result card shown to the human

#### Scenario: Pending proposal blocks acceptance
- **WHEN** an assignment's hand-back lists a proposal that the person has not decided and the Lead calls the tool for that assignment
- **THEN** the call fails with `CONFLICT`, `details.pendingProposals` lists the proposal id, and no result sign-off is raised

### Requirement: Team run state machine
A run SHALL have `status`: `briefing`, `needs_clarification`, `running`, `waiting_human`, `paused`, `completed`, `failed`, `cancelled`, and while `running` a `stage`: `supervisor` (Supervisor working), `lead` (Lead bootstrapped, planning), `assignments` (at least one assignment created), `acceptance` (all created assignments are `handed_back`, `accepted`, `failed` or `cancelled`), `relay` (result accepted, Supervisor reporting). The run record exists from the moment the start passed its guards ("Starting a team run"), so `briefing` and `needs_clarification` are statuses of a real run with a `runId`. Transitions: `briefing → needs_clarification | running`; `needs_clarification → briefing` (answers given) `| cancelled`; `running ⇄ waiting_human`, where a `waiting_human` run carries `waitingReason`: `question`, `escalation` (a dissent), `signoff` (a result or an escalated review), `limit` (a limit banner) or `stalled` (stall rule below); `running | waiting_human → paused` (human pause, restart recovery, or a blocked resource) `→ running` (resume); a `paused` run carries `pauseReason` with the values and meanings of `agent-workflows.Run state machine` — `user`, `host_shutdown`, `budget_exceeded` (a hard-stop budget), `no_route` (a member's role resolved to `NO_ROUTE`) and `provider_account` — where the last three apply to attended runs only and an unattended run fails the member's step instead; missing provider data consent is not a pause reason: it is a wait of the member that needs it (its consent card under "Child approvals surface once"), other members continue, and the run becomes `waiting_human` only when nothing else can progress; any non-terminal `→ cancelled` (human, or parked timeout) `| failed` (time, budget, unrecoverable topology); `running/relay → completed`. **Stall rule (watchdog):** when the member that must act next — the Supervisor in stages `supervisor` and `relay`, the Lead otherwise — is `idle` or `failed`, no member is `running` or `creating`, and nothing is pending for a person, the coordinator at once sends that member one prompt stating the run state (open assignments, unanswered hand-backs, open dissents) and the tools available to it; when the member ends that turn without a run-changing tool call, or the condition has held for 10 minutes in total, the run becomes `waiting_human` with `waitingReason: "stalled"` and `stalled {role, since_ms}`, one `agent.question` notification is raised ("<Team name> is stalled: <role> stopped responding"), and the run panel offers "Message <role>", "Replace lead", "Show result here" (when a result was accepted) and "Cancel run"; any run-changing tool call or one of those actions returns the run to `running`. A stalled run is waiting for a person: it does not consume `maxRunMinutes`, and in an unattended run it is parked under "Unattended behaviour of approvals". **Disposal of members:** 60 s after a run reaches a terminal status (`completed`, `failed`, `cancelled`), its Lead, Peers and policy reviewers are closed and archived (running turns aborted first, the agent writer token released, armed notifications cancelled); their records, transcripts and `jc.team.*` labels stay for history and for the run panel, they are restorable read-only for 30 days, and they are never "in a run" again. The Supervisor is kept `idle` for the next brief; the session agent that led an ad-hoc team is kept as an ordinary session agent. Assignment status: `active → handed_back → accepted`; `handed_back → dissent_open → handed_back | active`; `active → failed | cancelled`; `handed_back → cancelled`. Every transition is stored with `{from, to, cause, actor, time_ms}` in the run's event log (kept with the run, at most 5,000 entries, oldest trimmed) and emitted on `jagentchill.orc.run.updated`. Invalid transitions requested by a tool or RPC return `CONFLICT` with `details {status, stage}`. [NEW] [JAD JD-ORC-017]

#### Scenario: Stage follows the work
- **WHEN** the Lead creates its first Peer
- **THEN** the run's stage changes from `lead` to `assignments` and an event with `cause: "create_peer"` is logged

#### Scenario: Resume a completed run
- **WHEN** `jagentchill.orc.run.resume` is called on a `completed` run
- **THEN** it fails with `CONFLICT`, `details.status: "completed"`

#### Scenario: Attended run without a route
- **WHEN** a Peer's generation call in an attended run resolves to `NO_ROUTE`
- **THEN** the run is `paused` with `pauseReason: "no_route"`, the run panel offers "Open model routing" and "Resume", and after a route is configured "Resume" continues the assignment

#### Scenario: Attended run without consent
- **WHEN** a member's job reaches a provider without data consent on its last candidate in an attended run while another Peer is still working
- **THEN** that member is `waiting` with the consent card of `generation-providers.Data leaving the machine` in the home session, the other Peer continues, and the run is not `paused`

#### Scenario: Lead stops without acting
- **WHEN** every assignment is `handed_back`, the Lead ends its turn without `jc_team_accept_result`, `jc_team_resolve_dissent` or a new assignment, and ends the turn started by the coordinator's prompt the same way
- **THEN** the run is `waiting_human` with `waitingReason: "stalled"`, exactly one `agent.question` notification exists for it, and the run panel shows "Message lead", "Replace lead" and "Cancel run"

#### Scenario: Members are disposed of at run end
- **WHEN** a run with a Lead and three Peers completes
- **THEN** 60 s afterwards the Lead and the three Peers are `closed` with `archived_ms` set, the Supervisor is `idle` and not archived, and a room mention of a former Peer wakes nobody

### Requirement: Durable run record
The run record SHALL be stored in the server host store: `{id ("run_" + ULID), teamId, teamSnapshot, briefId, brief, projectId?, workspaceId?, sessionId? (the originating session), homeSessionId? (set once the Supervisor exists), startedBy {kind: "device" | "workflow" | "automation", id}, supervisorAgentId?, leadAgentId?, topicId?, roomId?, status, stage?, waitingReason?, pauseReason?, stalled?, delegated, assignments[], handbacks[], dissents[], acceptedResult?, approvals[], limits (effective), counters {assignmentsCreated, agentsCreated, peakConcurrentPeers, shapeViolations}, runningMs, waitingSince_ms?, usage {inputTokens, outputTokens, costUsd, costKnown}, events[], created_ms, updated_ms, ended_ms?, endReason?}`. All mutations of one run are serialised and written atomically; a tool call that changes a run returns only after its change is durable. `jagentchill.orc.run.get {runId}` returns the record (events paged, 200 per page) and `jagentchill.orc.run.list {projectId?, sessionId?, homeSessionId?, status?, limit?, cursor?}` lists runs newest first — JAgentDesk has no RPC that returns the run record and derives the UI from labels; here the UI reads the record. Terminal runs are kept 90 days (host setting 7–730) and then deleted with their topic and room; a run referenced by a named project version or a workflow run is kept as long as that reference. [JAD JD-ORC-017, JD-ORC-018] [NEW]

#### Scenario: Read the record
- **WHEN** a device with scope `jagentchill.projects.read` calls `jagentchill.orc.run.get`
- **THEN** it receives assignments, hand-backs, dissents and the accepted result of that run

#### Scenario: Durable before return
- **WHEN** the process is killed immediately after `jc_team_create_peer` returned `ok: true`
- **THEN** after restart the run record contains that assignment

### Requirement: Run recovery after Gateway restart
At server start every run in `briefing`, `running` or `waiting_human` SHALL be recovered within 30 s: (1) the run is set to `paused` with cause `host_restart`; (2) members are reconciled per "Agent store durability and restart recovery"; (3) an assignment whose agent's turn was interrupted keeps status `active` and is marked `interrupted: true`; (4) records the server owns — sign-offs under the common approval policy, escalated dissents, pending hand-off and hand-back decisions, brief clarifications and board questions — survive and are re-published to connected devices unchanged, with their original ids; permission, cost and consent prompts of interrupted turns were pending tool calls of a turn that no longer exists, so each is closed as `expired` on every device (`server-api.Approval and question resolution`: a restart never allows a pending request) and is raised again, with a new id, only if the resumed member repeats the call; (5) armed completion notifications and the queued deliveries of "Completion notification" are kept. A run in `needs_clarification` stays as it is. Resumption: a run started by an automation or whose home session is in `auto` mode resumes automatically 10 s after reconciliation; every other run stays `paused` with the banner "The host restarted. Resume the team run?" and the actions "Resume" and "Cancel run" (scope `jagentchill.agent.use`). On resume the coordinator sends one recovery message to the current Lead (or to the Supervisor when no Lead exists) containing the run's state — assignments with status and `interrupted` flags, hand-backs not yet answered, open dissents — and the instruction to continue; interrupted Peers receive "Your previous turn was interrupted by a host restart. Continue your assignment and hand back." No assignment is created twice and no limit counter is reset by recovery. A run whose Supervisor and Lead sessions are both missing after reconciliation becomes `failed` with reason `members_lost`. **Gateway outage with the server up.** When the gateway link drops or is not ready while the server keeps running (`server-api.Gateway supervision and lifecycle`), every team run in `briefing`, `running` or `waiting_human` whose next step is an agent turn, every running loop and every autonomous run SHALL be parked: the run is `paused` with `pauseReason: "waiting_gateway"` (a value used only by this capability, beside those of `agent-workflows.Run state machine`), turns that were in flight are marked `interrupted: true` exactly as in step (3), server-owned records are kept as in step (4), the time limits `maxRunMinutes` and the activity ceilings do not run, and the run panel shows "Waiting for the agent engine". A heartbeat that falls due and a queued delivery of "Completion notification" are held in the same way. A run that is waiting only for a person stays `waiting_human`; that person's answer is recorded and its delivery to the agent is held. Within 5 s of the link being ready the coordinator resumes every run it parked this way without asking a person — whatever the mode of the home session — by sending the recovery messages of the resumption rule above. A run parked for 600 000 ms becomes `failed` with `endReason: "gateway_unavailable"` and error code `GATEWAY_UNAVAILABLE`, a loop ends `failed` with reason `gateway_unavailable`, and a held heartbeat turn is recorded as a failed run of that heartbeat; one notification of the kind the failure already uses is raised. Rooms, the board, records and device actions that need no agent turn keep working during the outage. [NEW] [JAD JD-ORC-017]

#### Scenario: Attended run after restart
- **WHEN** the Gateway restarts during a run started from an interactive session in `edit` mode
- **THEN** the run is `paused` with cause `host_restart`, the banner is shown, and nothing runs until "Resume" is pressed

#### Scenario: Unattended run after restart
- **WHEN** the run was started by an automation
- **THEN** it returns to `running` within 40 s of server start and the Lead receives exactly one recovery message

#### Scenario: Counters survive
- **WHEN** 5 assignments existed before the restart
- **THEN** `counters.assignmentsCreated` is still 5 after recovery

#### Scenario: Prompts of interrupted turns
- **WHEN** the host restarts while a Peer waits on a cost approval and the run waits on a result sign-off
- **THEN** after recovery the cost card shows "Cancelled — the host restarted" on every device, the result sign-off card is pending with its original id, and a new cost card appears only when the resumed Peer repeats the call

#### Scenario: Gateway child restarts during a team run
- **WHEN** the supervised Gateway restarts while the server stays up, a Peer was mid-turn, and the link is ready again after 45 s
- **THEN** the run is `paused` with `pauseReason: "waiting_gateway"` during the outage, no banner asks for "Resume", and within 5 s of the link being ready the run is `running` and the Peer receives the interrupted-turn message once

#### Scenario: Gateway down for ten minutes
- **WHEN** a team run has been parked with `pauseReason: "waiting_gateway"` for 600 000 ms
- **THEN** the run is `failed` with `endReason: "gateway_unavailable"` and its members are disposed of under "Team run state machine"

### Requirement: Team shape enforcement at the tool endpoint
The server SHALL enforce team shape for every agent in a non-terminal run by mechanisms outside the model, so that a prompt instruction is never the only barrier. There is no hook inside the Gateway, so two mechanisms cover the two kinds of tool. **(1) `jc_*` tools — at the server's tool endpoint.** Team members reach each other only through `jc_agent_*`, `jc_team_*`, `jc_room_*` and `jc_board_*`; each call arrives at the endpoint, where the server binds it to the calling session from the Gateway-reported tool call and resolves that session's run, tier and contract, checks the team shape, and only then calls the Gateway; a refused call returns the tool envelope with `error.code` and `error.message` = `<CODE>: <message>` and makes no Gateway call. **(2) Native OpenClaw tools — by Gateway tool policy the server writes.** Before a member's first turn the server writes, for the member's agent entry and session (`agents.entries.<agentId>.tools.deny` and the per-session tool overrides of `sessions.patch`), a deny list containing `sessions_spawn`, `sessions_send`, `sessions_yield`, `subagents`, `terminal`, `exec` with a PTY and — for creative-class members — every tool outside the persona allow-list (`group:runtime`, `group:fs` writes, browser, web fetch, node invocation); the Gateway then refuses those calls itself and no session, message or process is created. The server confirms the policy is in force with `tools.effective` for the session before it starts the turn and does not start a member whose effective tools still contain a denied tool (`TEAM_START_FAILED`, reason `tool-policy-not-applied`). A denied native attempt the server observes as a tool item of the Gateway's `agent` events is attributed the code of the table below. The deny list is removed from a session only when its run reaches a terminal state and the session leaves the team. The following are refused:

| Attempt | Code | Message tells the agent to |
|---|---|---|
| Any member calls `jc_agent_create`, native `sessions_spawn` or `subagents` spawn | `TEAM_ROLE_DENIED` | use `jc_team_bootstrap_lead` (Supervisor), `jc_team_create_peer` (Lead) or `jc_agent_handback` (Peer) |
| A Peer calls `jc_agent_send` or native `sessions_send` to anyone (with `peerMessaging: "via_lead"`) | `TEAM_SHAPE_VIOLATION` | post in the run room or hand back to the Lead |
| A Peer messages another Peer with `peerMessaging: "direct"` outside the same run | `TEAM_SHAPE_VIOLATION` | message only members of this run |
| A Lead or the Supervisor calls `jc_agent_send`/`sessions_send` to a Peer of its own brief | `TEAM_SHAPE_VIOLATION` | use `jc_team_resolve_dissent` or create a new bounded assignment (the Supervisor is permitted to message the Lead only) |
| A member calls a team tool of another tier | `TEAM_ROLE_DENIED` | use its own tier's tool |
| A member with `contract.canWrite: false`, or a writer-capable Peer without the agent writer token, calls a non-read-only editing tool | `TEAM_ROLE_DENIED` / `WRITER_HELD` | hand back findings, or wait for the writer token |
| A creative-class member calls any tool outside its persona allow-list (exec, process, browser, web fetch, node invocation, terminal) | `TEAM_ROLE_DENIED` | — |
| Any member calls `jc_agent_set_model`, `jc_agent_set_mode` on another member, or `jc_agent_archive`/`jc_agent_cancel` on a member it does not own | `TEAM_SHAPE_VIOLATION` / `AGENT_NOT_OWNED` | ask the Lead or the human |
| Any member calls `jc_agent_set_model` with a runtime that would change an agent's class, or `jc_agent_handoff` creating a receiver of a higher class | `AGENT_CLASS_DENIED` | keep the work on the current runtime |
| Any member calls the native OpenClaw tools `terminal` or `exec {pty: true}` | `TEAM_ROLE_DENIED` (creative) / `SCOPE_DENIED` (workspace; `workspaces-terminal.Agent terminal tools`) | use `jc_terminal_*` where its catalogue has them |
| A call that would exceed a team or tree limit | the limit's code | wait or ask the human |

The Lead cancelling its own Peer (`jc_agent_cancel`) and any member using rooms, board tools within its tier and `jc_session_ask` are allowed. Every refusal — at the tool endpoint or observed from the Gateway — is audited with outcome `denied`, counted on the run (`counters.shapeViolations`) and shown in the member's timeline as an error item with the message. Five refusals of one member within 10 minutes set that member's `attention` to `error` and post "<role> keeps trying actions outside its role" in the run panel. Which runtimes can be held to these rules is defined once in "Runtime eligibility for team roles". [JAD JD-ORC-008] [NEW]

#### Scenario: Peer tries to spawn natively
- **WHEN** a Peer on the built-in runtime calls native `sessions_spawn`
- **THEN** the Gateway refuses the call because `sessions_spawn` is denied by the tool policy the server wrote for that member, no session is created, and the audit log has a `denied` record with code `TEAM_ROLE_DENIED`

#### Scenario: Lead prompts a Peer directly
- **WHEN** the Lead calls `jc_agent_send` to a Peer of its brief
- **THEN** the call returns `TEAM_SHAPE_VIOLATION` and the message names `jc_team_resolve_dissent` and `jc_team_create_peer`

#### Scenario: Supervisor messages the Lead
- **WHEN** the Supervisor calls `jc_agent_send` to the run's Lead
- **THEN** the message is delivered

#### Scenario: Runtime without native tool coverage
- **WHEN** a route's profile uses a runtime with `nativeToolCoverage: false`
- **THEN** that candidate is dropped at route selection with reason `runtime/unsupported-capability` and the next fallback is tried

### Requirement: Runtime eligibility for team roles
A team role (Supervisor, Lead or any Peer), the Lead of an ad-hoc team, and the member agents of a workflow `team` node SHALL be staffed only on a runtime whose published flags (`agent-runtimes.Capability flags per runtime`, values in `agent-runtimes.Published capability matrix`) are both `jcTools` `native` or `bridge` (the role-scoped `jc_team_*`, `jc_agent_*`, `jc_board_*` and `jc_room_*` tools must be callable) and `nativeToolCoverage: true` (every native tool request of the runtime is subject to the Gateway tool policy the server writes and is reported to the server as a Gateway tool event, so that the native-tool half of "Team shape enforcement at the tool endpoint" holds). Consequently: the built-in runtime is always eligible; a CLI runtime is eligible when its matrix cells for both flags hold on this host; **ACP runtimes are not eligible**, because an ACP agent executes its native tools itself, outside Gateway tool policy — an ACP runtime can still run a free agent or a workspace session, and can be the target of a hand-off outside a team. This requirement is the single statement of the restriction: `agent-workflows.Team node`, `agent-runtimes.Behaviour when a runtime lacks a capability` and the Teams settings page reference it. Enforcement points: saving a Team or an ORC profile for a team role with an ineligible runtime shows the inline error "This runtime cannot be used for team roles — its own tools cannot be supervised"; `jc_team_bootstrap_lead`, `jc_team_create_peer` and `jagentchill.orc.run.replaceLead` drop ineligible candidates during route selection ("Team route selection"), and when none remains fail with `NO_ROUTE` whose `details.attempts[]` carry `runtime/unsupported-capability` and `details.capability: "nativeToolCoverage"` or `"jcTools"`; arming Team mode on a session whose runtime is ineligible is disabled with the reason "This runtime cannot lead a team". `nativeToolCoverage` for CLI runtimes is established by spikes S8 and S14; when a spike fails for a runtime, its flag is published `false` and the runtime becomes ineligible with no other change. [NEW] [JAD JD-ORC-008]

#### Scenario: ACP profile on a peer route
- **WHEN** route `edit` names a primary profile on `acp-opencode` and a fallback on the built-in runtime
- **THEN** the primary is dropped with `runtime/unsupported-capability`, the Peer is created on the fallback with `fallbackUsed: true`, and the assignment row shows "fallback"

#### Scenario: Only ineligible candidates
- **WHEN** every candidate of a route uses an ACP runtime
- **THEN** `jc_team_create_peer` fails with `NO_ROUTE` and each entry of `details.attempts` has `error: "runtime/unsupported-capability"`

#### Scenario: Team mode on an ACP session
- **WHEN** the session runs on an ACP runtime
- **THEN** the Team control is disabled with "This runtime cannot lead a team" and the Autonomous control stays available when `jcTools` is `bridge`

#### Scenario: Spike fails for a CLI runtime
- **WHEN** spike S8 records that native tool calls of `gemini-cli` are neither refused by Gateway tool policy nor reported as Gateway tool events
- **THEN** the published matrix has `nativeToolCoverage: false` for it and Teams whose profiles use it show the inline error on their next edit

### Requirement: Team slash commands
The composer SHALL add these client-executed commands to `chat-agent.Slash commands` (shown only when the Gateway advertises `multi-agent`; never sent to the model as text): `/team <request>` — start a run with the session's default Team (the last Team used in this session, else `video-production`) and navigate to the run's home session ("Starting a team run"); `/team <teamId>: <request>` — start with a named Team; `/team` with no text opens the Team picker; `/orc <request>` with the alias `/orchestrate` — same as `/team` with the default Team, argument hint "<what the team is to do>", description "Start a team run (Supervisor → Lead → Peer)"; `/agents` — open the Agents tab; `/handoff @<agent> [note]` — open the hand-off dialog pre-filled for a human-initiated hand-off; `/room <name> [message]` — open or post to a room; `/loop` — open the loop dialog; `/autonomous on|off` — toggle Autonomous for the session agent; `/heartbeats` — list this agent's heartbeats. The commands work in the session composer and the home composer (where `/team` and `/orc` create the session first), accept attachments, and require scope `jagentchill.agent.use`; a `viewer` sees them greyed with "View only". An unknown Team id shows "No team named <id>" with the list of enabled Teams. [JAD JD-ORC-001] [NEW]

#### Scenario: /orc alias
- **WHEN** the user sends `/orchestrate cut a 30 s teaser from scene 2`
- **THEN** a run starts with the default Team and the text is not sent to the model as a chat message

#### Scenario: Named Team
- **WHEN** the user sends `/team review-board: check the final cut against the brand guide`
- **THEN** a run starts with the `review-board` Team

#### Scenario: Unknown Team
- **WHEN** the user sends `/team marketing: …` and no Team has that id
- **THEN** nothing starts and the composer shows "No team named marketing" with the enabled Teams as chips

### Requirement: Run control and lead replacement
A human with scope `jagentchill.agent.use` SHALL be able to: **pause** a run (`jagentchill.orc.run.pause`: no new assignment is accepted, running turns finish their current tool call and are then held; members show Paused), **resume** it, **cancel** it (`jagentchill.orc.run.cancel {reason?}`: every running member is aborted, `active` assignments become `cancelled`, the agent writer token is released, staged-but-unsubmitted proposals are discarded and submitted ones stay for the human, the run is `cancelled`), and **replace the Lead** (`jagentchill.orc.run.replaceLead {runId, profileId?}`: allowed when the Lead is unhealthy or on request; creates a new Lead with the same candidate order as `jc_team_bootstrap_lead`, transfers ownership of all Peers and the run's lead pointer in one transaction, sends the new Lead the brief, the relay text and the run state, archives the old Lead when it is unhealthy and otherwise demotes it to an idle agent outside the run). A run has exactly one Lead at every instant. Cancel shows the confirmation "Stop the team? <n> agents are still working. Work that was handed back is kept." Each action is audited with the device id. [JAD JD-ORC-010] [NEW]

#### Scenario: Replace an unhealthy Lead
- **WHEN** the Lead's session is missing and the user presses "Replace lead"
- **THEN** a new Lead exists, every Peer's `ownerAgentId` is the new Lead, the run returns to `running`, and exactly one agent has `jc.team.tier=lead` for the run

#### Scenario: Cancel keeps handed-back work
- **WHEN** a run with one `handed_back` and two `active` assignments is cancelled
- **THEN** the two become `cancelled`, the hand-back record and its submitted proposal remain available, and the run is `cancelled`

### Requirement: Team mode in the composer
The composer SHALL have a Team control (users icon; position per `chat-agent.Composer layout and controls` and design D9) shown when the Gateway advertises `multi-agent` and the session's runtime is eligible per "Runtime eligibility for team roles". Pressing it arms Team mode for that session on that device; the control shows a filled state and the tooltip "Next message starts a team with this agent as lead". The arm is one-shot and held in memory only: it is cleared after the next send, on reload and on session switch. A long press (touch) or the caret (desktop/web) opens a picker of enabled Teams whose peer roles the ad-hoc run will use (default `ad-hoc`). When armed, the next send does not start a normal turn: it creates an ad-hoc team run in which **the session's current agent becomes the Lead** (tier label `lead`, no Supervisor, the human acts as supervisor), creates the topic and the `team` room, and delivers a lead bootstrap prompt containing the user's message as the brief request, the Team's peer roles and routes, the limits, the five board stages and the rule to staff Peers with `jc_team_create_peer`. The brief is prepared per "Brief authoring and clarification" before the bootstrap. The draft is cleared and the control disarms. Duplicate sends within 30 s join the in-flight creation. When the session's agent is already in a non-terminal run the control is disabled with "This agent is already leading a team". Drafts on the home composer show the control; sending creates the session first. JAgentDesk's control has hard-coded English tooltips; all strings here are locale resources. [JAD JD-MA-024, JD-CMP-012] [NEW]

#### Scenario: Armed send
- **WHEN** Team mode is armed and the user sends "Make three 15 s cut-downs"
- **THEN** an ad-hoc run exists whose `leadAgentId` is the session's agent, the control is disarmed, the draft is empty, and no ordinary turn was started with that text

#### Scenario: Reload disarms
- **WHEN** the user arms Team mode and reloads the app
- **THEN** the control is not armed

#### Scenario: Agent already leading
- **WHEN** the session's agent leads a `running` run
- **THEN** the Team control is disabled with the tooltip "This agent is already leading a team"

### Requirement: Autonomous control
The composer SHALL have an Autonomous control (infinity icon) shown when the Gateway advertises `multi-agent`, the host setting `agents.autonomous.enabled` is on (default off; scope `jagentchill.config.write`) and the session's runtime has `jcTools` other than `none` (`agent-runtimes.Capability flags per runtime`). Pressing it starts or stops an autonomous run for that agent (`jagentchill.agent.autonomous.start|stop`, scope `jagentchill.agent.use`): the server re-prompts the **same agent** turn after turn toward its last human request, each prompt carrying a compact list of the items already done (the last 50). Each turn must end by calling `jc_autonomous_report {done: boolean, nothingNew: boolean, note (0–500 characters), doneItems [string] (0–20, each ≤ 200)}`; a turn that ends without the report counts as a failure. Only `done: true` ends the run by itself (`stopReason: "done"`). `nothingNew: true` means "wait": the next turn is delayed 30 s, doubling each consecutive time to a maximum of 300 s, and reset by a turn with new done-items. While a human message is being processed in that session the loop waits and re-checks every 400 ms instead of competing. Safety caps, each a host setting with the stated default and range, end the run with a `stopReason`: `max_turns` 2,000 (1–10,000), `max_time` 12 h (5 min–72 h), `max_cost` 50.00 USD accumulated (0.10–10,000), `no_progress` 5 consecutive turns without a new done-item (2–50), `failures` 3 consecutive failed turns (1–10). These caps are per-run ceilings that an admin can lower; they never raise a budget. Their order against the other spending rules is the single reconciliation of `generation-providers.Approval thresholds and spending caps`: hard-stop budgets of `generation-providers.Budgets with hard stop` first (through "Cost and budget inheritance"; no bypass, raised only by an admin device), then the Auto-mode session budget (default 5.00 USD), which ends approval-free spending long before `max_cost` unless a person raised it, then these ceilings. **Start dialog**: pressing the control opens "Start autonomous run" before the first turn, showing the goal (the last human request), the caps as read-only rows with their host values, every hard-stop budget in scope with its remaining amount, and the field "Session budget" prefilled with the current Auto-mode session budget, which the user can raise up to the smaller of `max_cost` and `budgets.maxSelfServiceUsd` (scope `jagentchill.generation.run`); the sentence "The agent asks for approval after <budget> of spending in this session" follows the field, and "Start" applies the value and starts the run. State `{agentId, status: "running" | "waiting" | "stopped" | "done" | "interrupted", iteration, started_ms, updated_ms, lastActivity_ms, doneItems, lastNote, spendUsd, stopReason?, stopDetail?}` is durable and streamed on `jagentchill.agent.updated`; the control's tooltip shows "<n> turns · <m> done" while running. After a Gateway restart the run is `interrupted` (never auto-resumed) and the session shows "Autonomous stopped when the host restarted" with "Resume". Autonomous turns run in the session's mode; entering Autonomous does not change the mode, and in `ask` or `plan` the control is disabled with "Autonomous needs Edit or Auto mode". [JAD JD-MA-030, JD-CMP-013] [NEW]

#### Scenario: Done ends the run
- **WHEN** a turn reports `done: true`
- **THEN** the run's status is `done`, no further prompt is sent and the control returns to its off state

#### Scenario: Idle back-off
- **WHEN** three consecutive turns report `nothingNew: true`
- **THEN** the delays before the next turns were 30 s, 60 s and 120 s

#### Scenario: No-progress cap
- **WHEN** five consecutive turns add no done-item
- **THEN** the run stops with `stopReason: "no_progress"` and the session shows "Autonomous stopped: no progress in 5 turns"

#### Scenario: Host setting off
- **WHEN** `agents.autonomous.enabled` is false
- **THEN** the control is not rendered

#### Scenario: Start dialog shows and raises the session budget
- **WHEN** the user presses the Autonomous control in an `auto` session with the default budgets
- **THEN** the dialog shows "Session budget 5.00 USD", the cost ceiling 50.00 USD and the hard-stop budgets in scope, and after the user sets 20.00 USD and presses "Start" the run spends up to 20.00 USD without an approval card

### Requirement: Worker and verifier loops
A loop SHALL repeat: start a **worker** agent with the worker prompt → run verification → stop on success or on a limit. Start through `jagentchill.agent.loop.start`, the loop dialog (`/loop`, or "Run as loop" in the composer's overflow) or the tool `jc_loop_start`, with `{name? (1–60), workerPrompt (1–32,000), worker? {persona | role + route, runtime?, model?}, verifierPrompt? (1–8,000; a second agent that must answer through `jc_loop_verdict {done: boolean, reason (1–2,000)}`), verifier? {persona (default `reviewer`), runtime?, model?}, checks? [Check] (0–10), sleep_ms? (0–3,600,000, default 0), maxIterations? (1–100, default 5), maxTime_ms? (60,000–86,400,000, default 3,600,000), archive? (default true: worker and verifier agents are archived when the loop ends), projectId?}`. At least one of `verifierPrompt` or `checks` is required ("A loop needs a verifier prompt or at least one check" → `INVALID_PARAMS`). `Check` is `{kind: "project", id, params?}` from the closed list — `timeline.no_gaps`, `timeline.duration_between {min_ms, max_ms}`, `captions.present`, `captions.no_overlap`, `audio.loudness_between {minLufs, maxLufs}`, `media.none_missing`, `script.approved`, `export.succeeds {preset}`, `proposal.none_pending` — or `{kind: "command", argv, cwd?, timeout_ms? (default 120,000), expectExit? (default 0)}`, the latter only for workspace-class loops started by a device that is permitted to create workspace agents and holds scope `jagentchill.host.exec`. An iteration passes when every check passes and, when a verifier is configured, its verdict is `done: true`; each next worker prompt carries the failed checks and the verifier's reason. End states: `succeeded`, `failed` (reason `max_iterations`, `max_time`, `agent_limit`, `activity_limit` when a ceiling of "Loop prevention" stops the tree, `gateway_unavailable` under "Run recovery after Gateway restart", or a worker that failed 3 consecutive turns), `stopped` (`jagentchill.agent.loop.stop` or `jc_loop_stop`, by the starter or a human). Each iteration is recorded `{n, workerAgentId, workerOutcome, checks [{id, pass, detail}], verifier? {agentId, done, reason}, started_ms, ended_ms, costUsd}` with log lines tagged `loop | worker | verifier | check`, readable through `jagentchill.agent.loop.list`, `jagentchill.agent.loop.get {loopId}` and `jc_loop_status`. Workers and verifiers are children of the starting agent (or roots when a device started the loop), carry the label `jc.loop`, obey the depth and concurrency limits of "Tree limits"; the worker and verifier of the running iteration count toward `maxAgentsPerTree` and those of finished iterations do not, so a loop of up to 100 iterations is not ended by the total count, and any limit refusal while starting an iteration ends the loop `failed` with reason `agent_limit`; they spend against the budgets of `generation-providers.Budgets with hard stop` through "Cost and budget inheritance"; `maxIterations` and `maxTime_ms` are per-run ceilings below which the `auto`-mode session budget (default 5.00 USD) applies first. A host runs at most 4 loops at once; a loop interrupted by a Gateway restart ends `failed` with reason `host_restart`. The Agents tab lists loops with iteration count, state and "Stop"; JAgentDesk offers loops only on its command line. [JAD JD-MA-027] [NEW]

#### Scenario: Succeeds on the second iteration
- **WHEN** a loop with check `captions.present` fails iteration 1 and passes iteration 2
- **THEN** the loop ends `succeeded` with two iteration records, the first listing the failed check

#### Scenario: No verification configured
- **WHEN** a loop is started with neither `verifierPrompt` nor `checks`
- **THEN** the start fails with `INVALID_PARAMS` and the message "A loop needs a verifier prompt or at least one check"

#### Scenario: Max iterations
- **WHEN** `maxIterations` is 3 and the third iteration fails verification
- **THEN** the loop ends `failed` with reason `max_iterations`

#### Scenario: Long loop is not stopped by the agent total
- **WHEN** a loop with `maxIterations` 20 and a verifier runs in a tree with `maxAgentsPerTree` 24
- **THEN** iteration 13 starts without `AGENT_LIMIT_TOTAL`, because only the running iteration's two agents are counted

#### Scenario: Command check by an editor device
- **WHEN** an `editor` device on a host without "Allow workspace agents for editors" starts a loop with a `command` check
- **THEN** the start fails with `SCOPE_DENIED` naming `jagentchill.host.exec`

### Requirement: Heartbeats
A heartbeat SHALL be a scheduled prompt delivered back into an existing agent. The tool `jc_heartbeat_create {prompt (1–8,000 characters), schedule (an RRULE string or a 5-field cron expression), timezone? (IANA name; default the host time zone), name? (1–60; default "heartbeat"), maxRuns? (1–10,000), expiresIn_ms? (60,000–31,536,000,000)}` is available only inside an agent session and always targets the calling agent itself; when both `maxRuns` and `expiresIn_ms` are absent the heartbeat gets `maxRuns: 100` and `expiresIn_ms: 86,400,000` (24 hours), so that a heartbeat created in an attended session does not keep firing indefinitely after the person has left; creating one with the same name and target replaces the previous one. `jc_heartbeat_list {}` lists the caller's heartbeats; `jc_heartbeat_delete {id}` deletes only the caller's own (`HEARTBEAT_NOT_OWNED` otherwise). There is no update tool: delete and recreate. Scheduling, time zones, missed-run handling and the timer are those of `automations.Schedule trigger with RRULE` and `automations.Schedule timing, time zones and missed runs`; a heartbeat is stored as an automation record of kind `heartbeat` owned by `automations.Automation record and storage`, listed on the Automations index with a "Heartbeat" badge and on the Agents tab under the agent, where the row shows the schedule, the remaining runs ("<n> of <maxRuns> left") and the expiry time, and where a human with scope `jagentchill.projects.write` and act access to the agent's session can pause and resume it (`jagentchill.automation.setEnabled {automationId, enabled}`), run it once (`jagentchill.automation.run {automationId}`) or delete it (`jagentchill.agent.heartbeat.delete`) — the same scope `automations.Enable and disable` requires. Constraints: minimum interval 60 s; at most 5 heartbeats per agent and 50 per host; a fire while the agent is `running` is delivered as a follow-up, and a fire while a previous heartbeat prompt of the same heartbeat is still queued is skipped and counted as missed. A heartbeat becomes `completed` when `expiresIn_ms` passes or delivered runs reach `maxRuns`, and is deleted when its agent is archived or closed. A heartbeat created by an agent whose tree root has `origin: "automation"` (or that runs unattended inside a workflow run started by an automation) is created **disabled**: it is stored with `enabled: false`, shown with the badge "Proposed by <agent title>" on the Automations index and the Agents tab, never fires, and starts firing only after a device with scope `jagentchill.projects.write` enables it (`automations.Agents cannot enable triggers`); the tool result states `enabled: false` and `reason: "needs_human_enable"`. In sessions started by a person the heartbeat is enabled at creation. Heartbeat turns run in the agent's current mode, never raise it, never change its class, are attributed to the tree ("Device access to agent sessions"; a heartbeat of a workspace-class session whose owner can no longer act in it is skipped and disabled with "Needs an admin device"), are delivered by the rule of "Completion notification", and obey `automations.Unattended run safety`. [JAD JD-MA-028]

#### Scenario: Replace by name
- **WHEN** an agent creates heartbeat "status" twice with different schedules
- **THEN** one heartbeat named "status" exists with the second schedule

#### Scenario: Delete another agent's heartbeat
- **WHEN** an agent calls `jc_heartbeat_delete` with the id of a sibling's heartbeat
- **THEN** the call fails with `HEARTBEAT_NOT_OWNED`

#### Scenario: Max runs reached
- **WHEN** a heartbeat with `maxRuns: 3` has delivered its third prompt
- **THEN** its state is `completed` and no fourth prompt is delivered

#### Scenario: Interval too short
- **WHEN** the schedule fires every 10 s
- **THEN** creation fails with `INVALID_PARAMS`, `details.minInterval_ms: 60000`

#### Scenario: Defaults bound an unattended heartbeat
- **WHEN** an agent creates a heartbeat every 10 minutes with neither `maxRuns` nor `expiresIn_ms`
- **THEN** the record has `maxRuns: 100` and expires 24 hours after creation, and the Agents tab row shows "100 of 100 left"

#### Scenario: Heartbeat created inside an automation run
- **WHEN** an agent of an automation-started session calls `jc_heartbeat_create`
- **THEN** the heartbeat is stored disabled with the badge "Proposed by <agent title>", it does not fire, and the tool result carries `enabled: false`

### Requirement: Scheduled new-agent runs
A schedule that starts a **new agent** on each run SHALL be an automation with the instruction of `automations.Start-session instruction` (new session each run), created by a human on the Automations screen or by an agent with `jc_agent_schedule {prompt, schedule, timezone?, name?, persona?, role?, route?, model?, teamId?, projectId?, maxRuns?, expiresIn_ms?, archiveOnFinish? (default true)}`, which creates the automation disabled-until-approved in every session, whatever its origin (`automations.Agents cannot enable triggers`): it appears on the Automations index with the badge "Proposed by <agent title>" and starts firing only after a device with scope `jagentchill.projects.write` enables it; no agent tool enables, resumes or re-enables an automation, a heartbeat or a trigger. `teamId` makes each run a team run (`automations.Run-workflow instruction` when the Team is wrapped by a workflow, otherwise a direct `jagentchill.orc.run.start`). Pause, resume, update, run-once, logs and history are those of `automations.Enable and disable`, `automations.Trigger now` and `automations.Automation detail and run history`; a run-once on an automation that is already running is refused there. A schedule proposed by an agent starts creative-class sessions only: `jc_agent_schedule` has no runtime or workspace parameter, and a workspace-class instruction needs the `workspaceGrant` of `automations.Start-session instruction`, which only a save from a permitted device writes. Agents created by a schedule are root agents with `origin: "automation"` and the label `jc.automation`, and are archived when their first turn ends unless `archiveOnFinish` is false. [JAD JD-MA-029] [NEW]

#### Scenario: Agent proposes a schedule
- **WHEN** an agent calls `jc_agent_schedule` with a daily schedule
- **THEN** an automation exists in the disabled state with the badge "Proposed by <agent title>" and nothing fires

#### Scenario: Human enables it
- **WHEN** a device with scope `jagentchill.projects.write` enables the automation
- **THEN** the next occurrence starts a new root agent with `origin: "automation"`

### Requirement: Common approval policy
One `ApprovalPolicy` object SHALL be used wherever the output of an agent or of a pipeline needs sign-off — in this capability team results (a Team's `resultApproval`), member proposals (its `proposalApproval`) and escalated board task reviews, each with its own approval record ("Team model"); scripts (`script-studio.Approval policy and precedence`), `approval` and `script` nodes (`agent-workflows.Approval node`, `agent-workflows.Script node`) and runs started by automations — and those capabilities reference this requirement instead of defining their own object, thresholds, round rules, host settings or approval record:

```
ApprovalPolicy {
  mode: "human" | "agent" | "auto",
  reviewer?: { role (ORC role id, default "reviewer"), profileId?, persona? },             // used by mode "agent"
  criteria?: [{ id (^[a-z][a-z0-9_]{0,31}$), label (1–120), description? (0–500), weight (1–100) }],   // 1–12 entries; weights are normalised to sum 100
  threshold?: 50–95 (default 75),            // weighted total (0–100) a review needs to pass
  criterionFloor?: 0–90 (default 50),        // every criterion score must reach it
  maxRounds?: 0–5 (default 2),               // revision rounds after the first review; a subject is reviewed at most maxRounds + 1 times
  blockOnSeverity?: "critical" | "high" | "medium" | "none" (default "high"),
  remindAfter_ms?: 60 000–86 400 000 (default 1 800 000),
  notify?: boolean (default true)
}
```

`human`: the subject waits for a person ("Human approval"). `agent`: a reviewer agent decides and escalates to a person per "Agent reviewer and escalation". `auto`: the subject is accepted without review and its record states "Auto-approved by policy". Strength is ordered `human` > `agent` > `auto`. **Precedence:** the effective policy of one sign-off is the most specific level that is set, in this order — the workflow run override (`settings.approvalOverride`, for overridable nodes only) → the workflow node's policy → the subject's own policy (a script) → the Team's policy for that subject kind (`resultApproval` for `team_result` and `task`, `proposalApproval` for `proposal`) → the **host default** (`orc.approval.default`, initial value `{mode: "human"}`); its `mode` is then raised to the **host minimum** (`orc.approval.minimum`: `auto`, `agent` or `human`; initial value `auto`, which imposes no floor) when it is weaker. Both host values are read with `jagentchill.orc.approval.get`, changed only by a device with scope `jagentchill.config.write` through `jagentchill.orc.approval.set {default?, minimum?}` on Settings → Agents → "Approval policy", and are the only host-level approval settings in the product. No agent tool sets or weakens a policy at any level. Regardless of `mode`, these always require a human whose device role, scope and session access are checked by the server when it resolves the item ("Approvals resolved by the server") and are never satisfied by a reviewer agent or by `auto`: host command execution, terminal keys and workspace script starts, skill creation and updates by an agent (`skills.Agent tools to create and update skills`), costs above thresholds or beyond budgets (`agent-editing-tools.Cost guard`, `generation-providers.Budgets with hard stop`), out-of-project effects (`agent-editing-tools.Approval for out-of-project effects`), provider data consent (`generation-providers.Data leaving the machine`), publishing and share links (scope `jagentchill.export.run`), entering an unattended mode (`agent-runtimes.Unattended modes and their warning`), and conversation hand-offs. When `mode` is `agent` and `criteria` is absent, the default criteria are "Meets the brief" (weight 40), "Correctness and continuity" (30), "Quality of execution" (20) and "Rights and safety" (10); a capability that fixes its own criteria for its subject states them in its own requirement and uses the scoring rule of "Agent reviewer and escalation" unchanged. Every decision produces one **approval record** `{id, subject {kind: "team_result" | "task" | "script" | "workflow_node" | "proposal", id}, policy (the effective snapshot), source: "run_override" | "workflow_node" | "subject" | "team" | "host_default", raisedByHostMinimum: boolean, rounds [ReviewRound], outcome: "approved" | "changes_requested" | "rejected" | "escalated" | "auto_approved" | "cancelled", decidedBy {kind: "device" | "agent" | "policy", id, deviceRole?}, decided_ms}` stored with the subject and appended to the audit log (`server-api.Audit log`, class `agent`; changes of the two host values are class `security`). Behaviour with nobody present is defined in "Unattended behaviour of approvals". [NEW]

#### Scenario: Precedence
- **WHEN** a Team has `{mode: "agent"}` and the workflow `team` node that invokes it has `{mode: "human"}`
- **THEN** the result of that run waits for a person and the approval record has `source: "workflow_node"`

#### Scenario: Host minimum raises a weaker policy
- **WHEN** `orc.approval.minimum` is `human` and a script's own policy is `{mode: "auto"}`
- **THEN** the effective mode is `human` and the approval record has `raisedByHostMinimum: true`

#### Scenario: Always-human item under auto
- **WHEN** the policy is `{mode: "auto"}` and a member requests a share link
- **THEN** a human approval card is shown and the link is not created until a device with scope `jagentchill.export.run` approves

#### Scenario: Invalid policy
- **WHEN** a policy is saved with `threshold: 96`
- **THEN** the save fails with `INVALID_PARAMS`, `details.field: "threshold"`

#### Scenario: Editor opens the host values
- **WHEN** an `editor` device calls `jagentchill.orc.approval.set {minimum: "auto"}`
- **THEN** the call fails with `SCOPE_DENIED` and both host values are unchanged

### Requirement: Approvals resolved by the server
Every approval, permission prompt, consent prompt, plan sign-off, question and sign-off raised in an agent tree SHALL be held and resolved by the server as `server-api.Approval and question resolution` defines (record, the pending path `APPROVAL_PENDING:<requestId>` for requests raised by `jc_*` tools at the tool endpoint, answers over the gateway link to requests the Gateway or a runtime raises, resolver identity, `ALREADY_RESOLVED` on a second answer); no device calls a Gateway approval method — the server is the only holder of `operator.approvals` and therefore the only party that can answer. This capability adds only which kind its items are and who answers them; the server checks the answering device's current role, the scope of the kind and its act access to the session ("Device access to agent sessions") at resolution time and stores the resolver on the record and in the audit log.

| Item of this capability | Kind and who can answer |
|---|---|
| Tool permission of a member in a creative tree, plan approval, agent question, brief clarification | `plan` / `question` / `out-of-project`: a device that can act in the home session with the scope of the kind |
| Cost above a threshold or budget card of any member | `cost`: act access plus `jagentchill.generation.run`; raising a hard-stop budget needs `jagentchill.config.write` |
| Publishing and share links requested by a member | `publish`: act access plus `jagentchill.export.run` |
| Command, process, terminal keys, workspace script start or stop, file write outside the working directory, and every native approval of a member of a workspace-class tree | `host-exec`: role `admin` holding `jagentchill.host.exec` only — never an `editor`, including the editor that owns the session |
| Skill create or update by a member; entering an unattended mode | `skill-write` / `unattended`: role `admin` (`jagentchill.config.write`) only |
| Provider data consent | as `generation-providers.Data leaving the machine` states |
| Result sign-off, escalated task review, escalated dissent, stalled run, hand-back decision by a person, hand-off decision by a person | objects of this capability, answered through `jagentchill.orc.signoff.resolve`, `jagentchill.orc.run.resolveEscalation`, `jagentchill.agent.handback.resolve` and `jagentchill.agent.handoff.resolve` by a device with `jagentchill.agent.use` that can act in the home session |
| Script and workflow-node sign-offs | as the table of "Human approval" states |

A device that can read the tree and fails the rule sees the card without actions and with "Waiting for <who can answer>"; its direct answer returns `SCOPE_DENIED` and leaves the item pending. An agent ("Agents answering descendants' permission requests") or a policy never resolves a kind marked admin-only. "Always allow" and "Allow for this session" decisions are stored with the deciding device and never widen who can answer: a remembered decision is applied to a subsequent request only when that request's kind is one the deciding device is still permitted to answer at that moment. [NEW]

#### Scenario: Resolver identity is recorded
- **WHEN** an `admin` device allows a command approval of a workspace-class session
- **THEN** the request record has `resolver {kind: "device", deviceId}` and the audit record `approval.resolved` names that device

#### Scenario: Editor answers an admin-only approval
- **WHEN** an `editor` device sends "allow" for an agent's skill-update approval or for a command approval of the workspace session it owns
- **THEN** the answer is refused with `SCOPE_DENIED`, the request stays `pending`, and the card on that device reads "Waiting for an admin device"

#### Scenario: Role changed while the card is open
- **WHEN** a device is changed from `admin` to `editor` and then answers a terminal approval that was already displayed
- **THEN** the answer is refused with `SCOPE_DENIED` because the role is checked at resolution time

### Requirement: Human approval
With `mode: "human"` the subject SHALL be presented as one approval card on the surface of its subject kind (table below; for subjects of this capability the home session's chat and the Agents tab's "Needs you" list), with: what is being approved (title, summary, artefact chips, diff or preview where the subject has one), who produced it, the acceptance criteria of the brief as a checklist the person can tick (ticks are recorded, not required), and the actions "Approve", "Request changes" (note required, 1–4,000 characters; delivered to the author as a return per "Hand-back acceptance and return") and "Reject" (ends the subject as `rejected`; in a team run the Lead is told and decides the next step). The decision is sent with the method of the subject kind and checked by "Approvals resolved by the server"; `viewer` devices and devices without act access see the card without actions. `Decision.notes` is 0–4,000 characters and is required (at least 1 character) for `changes_requested`. Scope, notification kind, surface and method by subject kind:

| Subject kind | Scope and who | Notification kind (the only one raised, also for escalations) | Surface | Resolved through |
|---|---|---|---|---|
| `team_result`, `task`, `proposal` | `jagentchill.agent.use` with act access to the home session | `agent.approval_required` (`agent.proposal_ready` for a proposal) | home session chat and "Needs you" | `jagentchill.orc.signoff.resolve` (a proposal: the proposal methods of `agent-editing-tools.Proposal acceptance and rejection`) |
| `workflow_node` | `jagentchill.generation.run` and the node's `assignee` filter | `workflow.approval_required` | the workflow run view's "Needs you", plus the card in the origin session when the run has `originRef.sessionKey` | `jagentchill.workflow.node.resolve` (`agent-workflows.Approval node`) |
| `script` | `jagentchill.projects.write` | `script.review_required` | the script review screen (`script-studio.Human approval`) | `jagentchill.script.review.resolve`; a waiting workflow node observes the review record and resumes |

Resolution on one device clears the card on all others per `chat-agent.Permission resolution across devices` and `notifications.Action resolution fan-out`. One notification of the stated kind is raised per subject, not per member; `agent.approval_required` is never raised for a `script` or `workflow_node` subject. A human sign-off never expires: no timer approves, rejects or withdraws it; after `remindAfter_ms` one reminder notification is raised and the card stays. [NEW]

#### Scenario: Request changes
- **WHEN** the user presses "Request changes" with a note on a team result
- **THEN** the Lead receives the note as a returned result, the run returns to stage `assignments` or `acceptance`, and the approval record gains a round with `verdict: "request_changes"` and `decidedBy.kind: "device"`

#### Scenario: Reminder, no expiry
- **WHEN** a team result has waited for a person for 2 hours with the default `remindAfter_ms`
- **THEN** the card is still pending, exactly one reminder notification was raised 30 minutes after the request, and the subject has no decision

#### Scenario: Resolved elsewhere
- **WHEN** the result is approved on the phone
- **THEN** the desktop's card shows "Approved on <device name>" within 1 s and its buttons are gone

#### Scenario: Script subject raises one notification
- **WHEN** an agent review of a script escalates to a person inside a workflow run
- **THEN** exactly one `script.review_required` notification exists, no `agent.approval_required` and no `workflow.approval_required` notification is raised for it, and deciding it in the script review screen resumes the waiting node

### Requirement: Agent reviewer and escalation
With `mode: "agent"` the server SHALL start a reviewer agent (role, profile and persona from the policy; read-only tools; created as a child of the run's Lead, or of the authoring agent outside a team; for a `workflow_node` or workflow-started `script` subject it is the root of its own tree under the workflow run's principal, and one reviewer agent and one approval record — keyed by `(runId, nodeId, enclosing fan-out item)` — serve every loop iteration of that node, with `round` continuing across iterations per `agent-workflows.Approval node`) with the subject, the brief and the criteria, and require it to answer with `jc_review_submit {scores {<criterionId>: 0–100}, verdict: "approve" | "request_changes", summary (1–2,000), findings [Finding] (0–50)}`. A `ReviewRound` is `{round (1…), reviewerAgentId, model, scores, total (weighted, rounded to 2 decimals), verdict, findings, started_ms, ended_ms, costUsd}`. The round **passes** when `total ≥ threshold`, every criterion score is at least `criterionFloor`, the verdict is `approve`, and no finding has severity at or above `blockOnSeverity`; a reviewer verdict of `approve` with `total < threshold` is recorded as not passed with the note "Below threshold", and one with a criterion under the floor with the note "Criterion below floor: <label>". A failed round returns the findings to the author as a revision request; the revised subject is reviewed again by the same reviewer agent, for at most `maxRounds` revision rounds (`maxRounds + 1` reviews in total). The reviewer MUST be a different agent from the author and MUST NOT be the agent holding the writer token; when the reviewer profile resolves to the same provider and model as the author the record carries the warning "Reviewer uses the same model as the author". **Escalation to a human** happens when: the review after the last allowed revision round still fails; the reviewer fails or times out 2 consecutive times (role timeout of `orc-model-routing.Role limits`); a finding has category `rights` or `safety` at severity `high` or `critical` (for `script` subjects this trigger is replaced by the script-specific rule of `script-studio.Escalation to a human`, which is the merged list for scripts); or the reviewer's scores are missing a criterion. On escalation the subject becomes a human approval card ("Human approval") that shows every round with scores per criterion and findings, the outcome is recorded as `escalated` then the person's decision, and one notification of the subject kind's own kind is raised (table of "Human approval"). A passing review records `outcome: "approved"`, `decidedBy.kind: "agent"`, and the subject shows "Approved by <reviewer persona> (agent) · <total>/100 · round <n>". [NEW]

#### Scenario: Pass on round two
- **WHEN** threshold is 75, round 1 totals 72 with `request_changes`, and round 2 totals 86 with `approve`, every criterion at 50 or more and no blocking finding
- **THEN** the subject is `approved` with two rounds recorded and no human card was shown

#### Scenario: Max rounds reached
- **WHEN** `maxRounds` is 2 and the first review and the reviews after both revision rounds fail
- **THEN** the subject is escalated: a human approval card lists the three rounds with scores and findings

#### Scenario: Safety finding escalates at once
- **WHEN** round 1 has a finding `{category: "safety", severity: "high"}` and total 91
- **THEN** the subject is escalated to a human without a second round

#### Scenario: Approve below threshold
- **WHEN** the reviewer submits `verdict: "approve"` with total 64 and threshold 75
- **THEN** the round does not pass and its note reads "Below threshold"

#### Scenario: Criterion under the floor
- **WHEN** the total is 82 with threshold 75 and the criterion "Rights and safety" scores 40 with `criterionFloor` 50
- **THEN** the round does not pass and its note reads "Criterion below floor: Rights and safety"

### Requirement: Child approvals surface once
A permission request, cost approval, question, plan approval, consent prompt, hand-off decision or escalation raised by any agent of a tree SHALL reach the human exactly once per request id: as one card in the **root session's** chat (labelled with the requesting agent, "Editor (peer) asks:"), one row in the Agents tab's "Needs you" list, one badge count increment on the session, and one notification of the matching kind of `notifications.Notification event catalogue`. The same request is also rendered, as the same card bound to the same id, inside the requesting agent's own timeline when that pane is open; answering in either place resolves both. The server observes every member's approvals over its gateway link (it alone answers them, see "Approvals resolved by the server") and de-duplicates by request id; a request seen through more than one event path produces one card. The card is delivered only to devices that can read the tree, and its actions are offered only to devices that the approval's kind and the session access permit; other devices see it with "Waiting for <who can answer>". For a team run the root session is the run's home session. Identical requests from different agents (same tool, same normalised parameters, same project) pending at the same time are grouped into one card "3 agents ask for the same permission" with one decision applied to all and each listed. An approval answered by an ancestor agent ("Agents answering descendants' permission requests") is removed from the human's list within 1 s and stays in the timeline as resolved. "Always allow" decisions made by a human apply to the tree for the scope stated on the card and are listed in the session's remembered decisions (`chat-agent.Remembered permission decisions`). [NEW]

#### Scenario: One card for one request
- **WHEN** a grandchild raises a cost approval
- **THEN** the root session's chat shows exactly one card for it, the "Needs you" list has one row, and one `agent.approval_required` notification exists

#### Scenario: Answered in the child's pane
- **WHEN** the user approves the request inside the grandchild's timeline pane
- **THEN** the root session's card shows as resolved within 1 s

#### Scenario: Card on a device that cannot answer
- **WHEN** a Peer of a workspace-class tree owned by an `admin` device raises a command approval while an `editor` device is connected
- **THEN** the `editor` device is not sent the card at all, because it cannot read that session

#### Scenario: Grouped identical requests
- **WHEN** three Peers request consent to send project media to the same provider at the same time
- **THEN** one grouped card is shown and "Allow once" resolves all three

### Requirement: Unattended behaviour of approvals
In an unattended run — the single definition is `agent-workflows.Unattended runs` (the run's origin is an automation, or it runs in `auto` mode from a session created by an automation); a session whose devices merely disconnected stays attended — the server SHALL distinguish two kinds of waiting. **Sign-offs** (an effective `mode: "human"` on a result, task, script or node; an agent review escalated to a person; a dissent escalated to a person; a brief that needs clarification; a stalled run; a human-input form; a hand-off to a person; and, in a session whose mode is `edit` or `plan`, a proposal waiting for acceptance and a plan waiting for approval — notification kinds `agent.proposal_ready` and `agent.plan_ready`): `agent` and `auto` policies proceed with no person exactly as in attended runs; a sign-off that needs a person **parks** — the requesting agent or node stays `waiting`, unrelated members and paths continue, nothing downstream consumes the unapproved subject, exactly one notification is raised (and, with push enabled, delivered per `notifications.Mobile push delivery`), and the item stays answerable from any device with the needed scope (design D24). A parked sign-off is never approved, rejected or downgraded to a weaker policy by a timer and is never answered by the unattended agent; it ends only when a person decides or when the parked timeout cancels the run. Parking is exempt from every run time limit: a Team's `maxRunMinutes` counts `running` time only ("Team limits") and an automation's `timeoutMinutes` does not count time parked on a sign-off (`automations.Run execution and concurrency`); the only clock on a parked item is the parked timeout — `orc.parkedTimeoutHours` for a team run and `advanced.parkedTimeoutHours` for an automation run, both default 72 hours, range 1–720 — after which the run ends `cancelled` with reason `parked_timeout`, the subject keeps its versions and records and can be approved afterwards. The host minimum of "Common approval policy" applies to unattended runs like any other. **Prompts** (cost approvals, provider data consent, tool-permission requests of a runtime — command, file, terminal and skill approvals — and out-of-project effects) are not sign-offs: they follow `automations.Unattended run safety` and rule 5 of `generation-providers.Approval thresholds and spending caps` — a prompt unanswered for 30 minutes fails that step (`APPROVAL_TIMEOUT`; `PERMISSION_DENIED` for consent), consent is never granted implicitly and always-human items are never auto-approved; in an interactive run the same prompt expires after the same 30 minutes without failing the run and can be asked again. This is the whole rule: sign-offs park, prompts fail the step after 30 minutes, and no third behaviour exists — in particular an escalated dissent is not resolved in the lead's favour by a timer. An unattended tree never enters a more permissive mode on its own. [NEW]

#### Scenario: Automation run reaches a human sign-off
- **WHEN** an automation-started team run reaches a result whose effective policy is `{mode: "human"}` at 02:00 and nobody is connected
- **THEN** the run is `waiting_human`, one `agent.approval_required` notification exists, no timer decides it, the six hours of waiting consume neither `maxRunMinutes` nor the automation's `timeoutMinutes`, and approving it at 08:00 lets the run continue

#### Scenario: Automation run reaches a cost approval
- **WHEN** a Peer of an automation-started team run requests a cost approval above the per-call threshold and nobody answers within 30 minutes
- **THEN** the Peer's call fails with `APPROVAL_TIMEOUT`, the team run continues, and its assignment fails only by the rules of "Team hand-back"

#### Scenario: Interactive run keeps waiting
- **WHEN** an interactive run waits for a human sign-off for 2 hours
- **THEN** the card is still pending, the requester is still `waiting`, and exactly one reminder notification was raised

#### Scenario: Escalated dissent in an unattended run
- **WHEN** a Lead escalates a dissent at 03:00 in an automation-started run and nobody is connected
- **THEN** the run is `waiting_human` with one `agent.dissent_escalated` notification, other assignments continue, and the dissent is still open at 09:00 until a person decides

#### Scenario: Proposal in an edit-mode automation session
- **WHEN** an automation-started session in `edit` mode submits a proposal at 01:00 and nobody is connected
- **THEN** the proposal waits as a parked sign-off with one `agent.proposal_ready` notification, it is not failed after 30 minutes, and accepting it at 09:00 lets the turn continue

#### Scenario: Parked timeout
- **WHEN** a parked result sign-off of an automation-started team run is not decided for 72 hours with the default settings
- **THEN** the run ends `cancelled` with reason `parked_timeout` and the candidate result is still readable in the run record

#### Scenario: Tool-permission prompt in an unattended run
- **WHEN** a workspace agent of an unattended run asks for a command permission and nobody answers for 30 minutes
- **THEN** that step fails with `APPROVAL_TIMEOUT` and the permission is not granted

### Requirement: Agents tab and roster
The session workspace SHALL have an **Agents** tab (design D9; it replaces and extends the "Sub-agents" panel of `chat-agent.Sub-agents track`) with three views selected by a segmented control: "Roster", "Team" (shown when the session has a run or topic) and "Activity log". The roster is a tree list (`design-system.Tree`) of the session's agent tree. When a run exists the list is grouped and ordered by tier — Supervisor, Lead, Peers (ordered by assignment creation) — under the header "Session agents" with the sub-line "You → Supervisor → Lead → Peers"; otherwise it is ordered by tree position. Each row (44 px; 56 px on touch) shows: avatar with persona glyph, title, role line ("Peer · edit" / persona name), status pill, runtime and model label, elapsed time of the current turn, cost, and attention markers (approval, question, hand-off, error, writer token "Editing", unattended). Pressing a row opens that agent's timeline pane; the row menu offers the intervene actions permitted to the viewer. A "Needs you" section at the top lists pending approvals, questions, hand-off decisions and escalations across the tree. At the wide form factor of `design-system.Breakpoints and layout constants` the roster can be docked as a 264 px column between chat and workspace ("Dock roster"), offered in any session — a chat session or a workspace screen — that has at least one agent besides the root; it docks only when the content width is at least 944 px (the rule of `app-shell-navigation.Session split view`), below which "Dock roster" is disabled with a tooltip and a docked roster returns to the Agents tab; the dock state is stored per session per device. Docking is identical in the desktop app on macOS, Windows and Linux and in a wide browser window or tablet. For a team run the roster is that of the run's home session. Empty state: "This session has one agent. Use Team mode or ask the agent to delegate to see more here." Loading shows three skeleton rows; a failed load shows "Unable to load agents" with "Retry". [JAD JD-ORC-021] [NEW]

#### Scenario: Roster order in a run
- **WHEN** a run has a Supervisor, a Lead and three Peers
- **THEN** the rows appear in the order Supervisor, Lead, Peer 1, Peer 2, Peer 3, each with its status pill and model label

#### Scenario: Open a thread
- **WHEN** the user presses a Peer row
- **THEN** that Peer's timeline pane opens and the row is marked selected

#### Scenario: No delegation yet
- **WHEN** the session has only its root agent
- **THEN** the roster shows the empty-state text and the dock option is unavailable

### Requirement: Host-wide Agents screen
This capability SHALL own the content of the host-wide Agents screen at `/h/[hostId]/agents`, whose frame, tab bar and routes are `app-shell-navigation.Agents screen`; the screen is available on every platform while the Gateway advertises `multi-agent` and is read through `jagentchill.agent.list {scope: "host", states?, projectId?, cursor?, limit?}`, `jagentchill.orc.run.list {status?, teamId?, projectId?, from_ms?, to_ms?, cursor?, limit?}` and `jagentchill.orc.team.list` (scope `jagentchill.projects.read`; a device sees only the agents and runs of sessions it can read under "Device access to agent sessions": its own, those shared with the host, and — for `admin` devices — all). It has three tabs.

**Roster** (default) lists every session of the host that currently has at least one agent besides its root, as collapsible groups ordered by "needs you" first and then by last activity; a group header shows the session title, project name, owner device, agent count, running count, total cost and the session's mode badge (with the unattended warning badge when it applies), and the group body is the tree of that session with exactly the rows of "Agents tab and roster" (status pill, runtime and model, elapsed, cost, attention markers). Above the groups a host-wide **"Needs you"** section lists every pending approval, question, hand-off decision (`agent.handoff_pending`), escalated dissent (`agent.dissent_escalated`) and parked sign-off of all listed sessions, oldest first, each with its inline actions when the device holds the scope to act and "Open" otherwise. Filters: project, status (running, waiting, failed, idle), agent class (creative, workspace), origin (user, automation, workflow) and a text search over agent titles and session titles; a toggle "Show single-agent sessions" adds sessions that have only a root agent that is `running` or `waiting`. Activating an agent row opens `/h/[hostId]/sessions/[sessionId]?tab=agents&agent=<agentId>`; the row menu offers the actions of "Intervene actions" under the same ownership, class and role checks as inside the session, and a group menu offers "Open session" and "Stop all agents in this session" (confirmation required; scope `jagentchill.agent.use`).

**Team runs** lists the team runs of the host, newest first, with the columns Team, session, project, status pill, stage, started, elapsed, members (active/total), cost and started-by (person, agent, workflow, automation); filters by status, Team and project and a date range (default last 30 days); each row opens `/h/[hostId]/agents/runs/[runId]`, which renders the panel of "Team run panel" at full width from `jagentchill.orc.run.get` with a link to its session, also for runs whose session is archived (read-only, with the banner "This run's session is archived"). Rows of non-terminal runs offer Pause or Resume and Cancel (`jagentchill.orc.run.pause|resume|cancel`).

**Teams** lists the Teams of the host (name, role count, enabled state, "Template" badge, runs in the last 30 days, last run status) with "Start a run" (opens the Team picker of "Starting a team run" in a new session) and, on admin devices, "Edit" opening `/settings/host/[hostId]/teams/[teamId]`; other devices see "Managed by the host admin".

The screen updates from `jagentchill.agent.updated` and `jagentchill.orc.run.updated` (subscriptions limited to the visible groups and rows, at most 50 streams at once; further rows refresh by polling `list` every 10 s) so that a status change appears within 2 s on a visible row. Lists page 50 items at a time. States: loading shows skeleton groups; "No agent teams are running" with "Start a session" when the Roster is empty; "No team runs yet" and "No teams — create one in Settings" for the other tabs; a failed load shows "Unable to load agents" with "Retry"; with the Gateway unreachable the last loaded content is shown read-only under "Reconnect to see live agent status"; when the Gateway does not advertise `multi-agent` the screen shows "Agent teams are unavailable on this host". Devices with role `viewer` see every tab read-only without action buttons. On phones (iOS and Android) and at the compact breakpoint the tabs are a top segmented control, groups are full-width cards, rows are 56 px, filters open in a bottom sheet, and a run opens as a pushed screen, per "Mobile presentation". [NEW]

#### Scenario: Roster across sessions
- **WHEN** two sessions of the host each have a lead and two peers and one peer waits for a cost approval
- **THEN** the Roster tab shows two groups of three rows, the group with the waiting peer is listed first, and "Needs you" holds that approval with "Allow" and "Deny"

#### Scenario: Acting from the host-wide list
- **WHEN** an editor device that did not create a session presses "Stop" on one of that session's agents
- **THEN** the action is evaluated by the same ownership and role checks as in the session and is refused with the same message when the session's rules refuse it

#### Scenario: Team run of an archived session
- **WHEN** the user opens a completed run whose session was archived
- **THEN** `/h/[hostId]/agents/runs/[runId]` shows the brief, members, assignments and result read-only with "This run's session is archived"

#### Scenario: Escalated dissent in Needs you
- **WHEN** a Lead escalates a dissent in any session of the host
- **THEN** the host-wide "Needs you" section shows it with "Side with lead", "Side with <peer role>" and "Give other direction" within 2 s

#### Scenario: Viewer device
- **WHEN** a `viewer` device opens the screen
- **THEN** the Roster and Team runs tabs list only sessions shared with the host, the Teams tab is readable, and no action button is shown

#### Scenario: Multi-agent unavailable
- **WHEN** the Gateway does not advertise `multi-agent`
- **THEN** the screen shows "Agent teams are unavailable on this host" and makes no list request

### Requirement: Sub-agents track above the composer
A collapsible lane directly above the session composer SHALL list the non-archived agents whose `ownerAgentId` (or, for native and runtime sub-agents, `parentId`) is the agent shown in the chat pane. Header: "Sub-agents · <running> running" with a collapse chevron and the action "Archive finished"; collapsed state shows only the header and is stored per session per device. Rows are 32 px (44 px on touch), at most 5 visible before the lane scrolls, each with avatar, title, status pill, elapsed time, cost and, on expansion, the agent's last three activity lines. Pressing a row opens the agent as a workspace pane. Row actions: "Open", "Message", "Stop", "Detach" (managed agents only), "Archive" (confirmation "Archive <title>? Its sub-agents are archived too."). A sub-agent in the same workspace is not opened automatically; a sub-agent placed in another workspace is opened in its own workspace and still listed in the parent's track with a workspace chip. Native and runtime sub-agents carry their badge and omit unavailable actions. The lane is absent when the list is empty. This requirement supersedes the limits stated in `chat-agent.Sub-agents track` (4 concurrent, depth 1) with those of "Tree limits". [JAD JD-MA-011, JD-MA-014, JD-MA-015] [NEW]

#### Scenario: Archive finished
- **WHEN** the lane has two idle and one running sub-agent and the user presses "Archive finished"
- **THEN** the two idle agents are archived and leave the lane, and the running one stays

#### Scenario: Cross-workspace child
- **WHEN** a child is created in another workspace
- **THEN** that workspace opens with the child's pane, and the parent's lane still lists the child with a workspace chip

#### Scenario: Detach absent for runtime rows
- **WHEN** the user opens the row menu of a runtime sub-agent
- **THEN** it contains only "Open"

### Requirement: Per-agent timeline panel
Opening an agent SHALL show a pane with: a header (avatar, title, role line, status pill, runtime · model · thinking, mode pill, cost, elapsed, breadcrumb of ancestors each pressable, and an overflow menu of intervene actions); the agent's full timeline rendered with the item types of capability `chat-agent` (messages, reasoning, tool calls, proposals, errors, permission cards) plus the multi-agent items — hand-off card, hand-back card, completion notification, room mention, assignment card, dissent card, review round, limit banner; and, for managed agents the viewer can act on, a compact composer ("Message <title>…") that sends through `jagentchill.agent.send` with the session's default delivery (steer, follow-up or interrupt per `chat-agent.Steer, queue and interrupt while running`). Messages sent by a human to a team member are labelled "You → <role>" in that timeline and logged on the run. The pane streams through the server relay on channel P with the ordering, gap recovery and reconnect rules of `chat-agent.Stream ordering and duplicate handling` and `chat-agent.Stream gap recovery`; history pages 50 items at a time. Panes of runtime sub-agents, of agents on projects the device cannot write, and of agents of a session the device can read but not act in ("Device access to agent sessions") are read-only. At most 6 agent panes are open per session; opening a seventh replaces the least recently viewed one. [NEW]

#### Scenario: Message a Peer directly
- **WHEN** the user types in a Peer's pane composer and sends
- **THEN** the Peer receives the message with the session's default delivery, its timeline shows "You → Editor", and the run's event log records a human message to that assignment

#### Scenario: Breadcrumb navigation
- **WHEN** the user presses the Lead in a Peer pane's breadcrumb
- **THEN** the Lead's pane opens

### Requirement: Team run panel
The "Team" view SHALL present the run record: (1) **Brief card** — "Objective", "Route" (category and selected role/profile), "Deliverables", "Needs your decision" (open questions with answer fields, shown only when present), "Acceptance" and "Validation", a note "Prepared by <model label>" or "Prepared without a model", and "Edit brief" while the run is `needs_clarification` (both sent with `jagentchill.orc.run.answerBrief`); (2) **Run header** — Team name, status pill, stage stepper (Supervisor → Lead → Assignments → Acceptance → Relay), elapsed, cost, counters "Peers <active>/<maxConcurrent>" and "Assignments <created>/<maxAssignments>", and the controls Pause/Resume, Cancel, Replace lead, plus the stalled banner with its actions when `waitingReason` is `stalled`; (3) **Members** — role agents with "Open thread"; (4) **Plan card** (below); (5) **Assignments** — one row per assignment with role, route, title, status, fallback marker, writer marker, elapsed and cost, expandable to its assignment text, ownership boundary, expected hand-back and its hand-back card; (6) **Dissents** — open ones first with both positions, the Lead's rationale and, when escalated, the human actions; (7) **Result** — the accepted result card (summary, evidence, remaining uncertainty, artefact chips, "Not included" assignments, approval record) once present; (8) **Request box** to start another brief with the same Team ("What do you want the team to do?"); (9) "Event log" disclosure listing run events newest first. A session with several runs shows a run switcher (newest first). Empty state for a session with no run: the Team picker with each Team's name, description and role chips, and the request box. [JAD JD-ORC-022] [NEW]

#### Scenario: Brief needs a decision
- **WHEN** a brief is `needs_clarification` with two questions
- **THEN** the brief card shows "Needs your decision" with two answer fields and the run header shows no stage stepper

#### Scenario: Counters
- **WHEN** 2 of 3 concurrent Peers are active and 5 of 12 assignments were created
- **THEN** the header shows "Peers 2/3" and "Assignments 5/12"

### Requirement: Lead plan card
A plan card SHALL be rendered in the Lead's timeline, at the top of the Team view and as a collapsible card in the root session's chat as soon as the run has one assignment. Collapsed header: "Lead plan · <n> bounded assignments" (singular "1 bounded assignment"). Expanded: one line per assignment — role label, route, title, status pill, and a writer marker — in creation order, including assignments of every peer role (custom roles included), followed by the Lead's latest `decision` thread message when one exists. Pressing a line opens that assignment in the Team view. The card updates in place within 1 s of any assignment change and never duplicates in the chat. [JAD JD-ORC-023]

#### Scenario: Card appears with the first assignment
- **WHEN** the Lead creates its first Peer
- **THEN** the root chat shows one card "Lead plan · 1 bounded assignment"

#### Scenario: Custom role listed
- **WHEN** the second assignment goes to the custom role `colorist`
- **THEN** the card reads "Lead plan · 2 bounded assignments" and lists "Colorist · edit"

### Requirement: Intervene actions
A human SHALL be able to intervene on any managed agent of a tree their device can act on under "Device access to agent sessions" (role, scope, session ownership and class; a workspace-class tree owned by another device is neither visible to nor actionable from an `editor` device), from the roster row menu, the pane header and the run panel. Actions and required scope: **Message** (follow-up), **Steer** (inject into the running turn; falls back to follow-up with a toast when the runtime cannot steer), **Interrupt and send** — `jagentchill.agent.use`; **Stop** (abort the turn; pending state "Stopping…" until acknowledged), **Stop all** (abort every running member of the tree or run) — `jagentchill.agent.use`; **Close**, **Archive**, **Restore**, **Detach** — `jagentchill.agent.use`; **Change mode** — `jagentchill.agent.use`, and `admin` role for unattended modes; **Change model / runtime / thinking** — `jagentchill.agent.use` for creative agents, and the workspace-agent privilege of "Agent classes and creation privileges" when the target is workspace-class or the target runtime would make it so; **Reassign** — `jagentchill.agent.use`; **Approve / Deny / Answer** — the role, scope and ownership of the approval's kind in "Approvals resolved by the server", checked by the server at resolution time; **Pause / Resume / Cancel run**, **Replace lead**, **Raise limit** — as stated in their requirements; **Take the writer token** (human edits take priority; see "Agent writer token") — `jagentchill.projects.write`. Every action is confirmed by a toast naming the agent, appears in the agent's timeline as an item "You <action>" with the device name, and is audited. Human interventions are never blocked by team shape rules. Actions unavailable to the viewer are absent; actions unavailable for the agent's state or runtime are disabled with the reason. [NEW]

#### Scenario: Steer falls back
- **WHEN** the user steers a Peer running on a runtime without steer support
- **THEN** the message is queued as a follow-up and a toast reads "This runtime cannot be steered mid-turn. Your message was queued."

#### Scenario: Stop all
- **WHEN** the user presses "Stop all" on a run with four running members
- **THEN** all four are aborted, each shows Cancelled after its acknowledgement, and the run stays `running` in stage `assignments` with a banner "Stopped by you. Send a message or resume."

#### Scenario: Editor intervenes in a tree it cannot act on
- **WHEN** an `editor` whose workspace-agent permission was turned off opens the row menu of an agent in the workspace-class tree it owns
- **THEN** the menu contains only "Open" and every intervene method called directly returns `SCOPE_DENIED`

#### Scenario: Editor changes a model to a workspace runtime
- **WHEN** an `editor` device without the workspace privilege selects a CLI runtime for a creative Peer
- **THEN** the option is disabled with "Only an admin device can start workspace agents on this host"

### Requirement: Reassignment by a human
"Reassign" on an assignment SHALL let a human move bounded work without the Lead: choose a target role of the Team (or an existing idle member), optionally a profile, and a note; `jagentchill.agent.reassign {assignmentId, to {roleId | agentId}, profileId?, note?, carryContext (default true)}` then, in one transaction, cancels the current holder's turn, marks the old assignment `cancelled` with reason `reassigned`, creates a new assignment that keeps the original assignment text, ownership boundary and expected hand-back, and — with `carryContext` — delivers a hand-off package to the new holder built from the old holder's activity summary (≤ 12,288 characters), its artefacts and its open questions. The writer token moves with the assignment when the old holder held it. A reassignment counts as one created assignment against `maxAssignmentsPerBrief` and is announced to the Lead as a structured message "The user reassigned <title> from <old role> to <new role>". Outside a team, "Reassign" on a free child performs a human-initiated `task` hand-off from that child to the chosen agent, pre-accepted. [NEW]

#### Scenario: Reassign to another role
- **WHEN** the user reassigns an `editor` assignment to the `colorist` role with `carryContext` on
- **THEN** the old assignment is `cancelled` with reason `reassigned`, a new `active` assignment exists for `colorist` with the same assignment text, the new Peer's first message is a hand-off card, and the Lead is informed

#### Scenario: Limit reached
- **WHEN** `maxAssignmentsPerBrief` is already reached
- **THEN** the reassignment is refused with `TEAM_LIMIT_ASSIGNMENTS` and the dialog offers "Allow 12 more assignments"

### Requirement: Multi-agent notifications
This capability SHALL raise notifications only through the kinds of `notifications.Notification event catalogue`, one per underlying request or outcome and addressed by the root session: `agent.approval_required` (approvals and human approval-policy cards), `agent.question` (questions, clarification of a brief, a human mention in a room, a stalled run), `agent.proposal_ready` (a member's proposal waiting for a person), `agent.handoff_pending` (a hand-off between agents that waits for the user's decision — one per hand-off record, resolved when the record leaves `pending`), `agent.dissent_escalated` (a dissent closed as `ESCALATED_TO_HUMAN` — one per dissent, resolved by the person's decision), `agent.plan_ready` (a plan approval of any member), `agent.finished` (a team run, loop or autonomous run reached `completed`/`succeeded`/`done`; text "<Team name> finished: <first 80 characters of the summary>"), `agent.failed` (a run, loop or autonomous run ended `failed`, or delivery was paused by "Loop prevention"). A hand-off and an escalated dissent are never folded into `agent.question`. Individual members finishing, hand-backs, room posts, stage changes and board updates never notify. In-app, each kind also updates the session's badge count and the roster's "Needs you" section. Deep links open `/h/[hostId]/sessions/[sessionId]?tab=agents&agent=<agentId>` focused on the requesting agent, or `/h/[hostId]/agents/runs/[runId]` for a team run; `agent.handoff_pending` opens the hand-off card and `agent.dissent_escalated` the dissent in the Team view. Notification content follows `notifications.Privacy and content rules for notifications`; push carries only the event type and an opaque id. [NEW]

#### Scenario: One finish notification per run
- **WHEN** a run with five members completes
- **THEN** exactly one `agent.finished` notification is raised

#### Scenario: Dissent escalation
- **WHEN** a Lead escalates a dissent
- **THEN** one `agent.dissent_escalated` notification is raised, no `agent.question` notification is raised for it, and opening it shows the dissent in the Team view

#### Scenario: Pending hand-off
- **WHEN** a conversation hand-off needs the user's decision
- **THEN** one `agent.handoff_pending` notification with the actions "Accept" and "Reject" is raised, and it is marked resolved on every device when the hand-off is accepted, rejected, cancelled or expired

### Requirement: Mobile presentation
At the compact form factor of `design-system.Breakpoints and layout constants` and on phones — identically on iOS and Android, and in a compact browser or desktop window — the oversight UI SHALL be presented as follows: the Agents tab is a full-screen workspace segment reached from the session's segmented switch (`app-shell-navigation.Session split view`); Roster, Team and Activity log are a top segmented control; the roster is a single-column list with 56 px rows and swipe actions (leading: "Message"; trailing: "Stop" — a destructive action that needs a full swipe or a tap on the revealed button); the row menu and every dialog of this capability (hand-off, reassign, loop, Team picker, policy, task detail) open as bottom sheets (`design-system.Side sheet and bottom sheet`) with detents at 50 % and 92 % of the height; an agent's timeline opens as a pushed screen with a back button and its compact composer docked above the keyboard; the sub-agents track above the composer shows at most 3 rows before scrolling and collapses to a single chip "Sub-agents · <n>" when the keyboard is open; the docked roster column is not available; the board shows one column at a time with a horizontal column selector and "Move to…" in place of drag; the stage stepper shows the current stage with "<i> of 5"; the Team run panel stacks its sections in the order of "Team run panel" with Assignments collapsed to the first 5 and "Show all"; approval cards and the "Needs you" list are reachable from a persistent banner "<n> need you" above the composer. All actions have touch targets of at least 44 × 44 pt and the same scope rules as on desktop. At the medium form factor the layout is the desktop one without the docked roster. iPads and Android tablets whose window is at the wide form factor use the wide layout. The system back gesture and back button (Android) and the edge-swipe back gesture (iOS) close the top sheet or pushed screen first. [NEW]

#### Scenario: Swipe to stop
- **WHEN** the user fully swipes a running Peer's row to the trailing side on a phone
- **THEN** the Peer is stopped after the acknowledgement and a toast names it

#### Scenario: Keyboard open
- **WHEN** the session composer has focus on a phone and three sub-agents exist
- **THEN** the track is replaced by the chip "Sub-agents · 3" and tapping it opens the list as a bottom sheet

#### Scenario: Board on a phone
- **WHEN** the Board tab is opened on a phone at the compact form factor
- **THEN** one column is visible with the column selector above it and cards offer "Move to…"

### Requirement: Visual language, accessibility and localisation
All surfaces of this capability SHALL use the tokens and components of capability `design-system` in the visual language of design D14 — hairline-bordered cards with 12 px radius, the StatusPill vocabulary, Avatar sizes 20 px (rows) and 32 px (headers), the Tree, Tabs, Segmented control, Callouts and Toast components — and MUST NOT introduce literal colour values or third-party brand assets. Tier is shown by text and a glyph (crown for supervisor, flag for lead, dot for peer), never by colour alone; attention markers have text alternatives ("Needs approval", "Asked a question", "Hand-off pending", "Error", "Editing", "Unattended"). Every list is keyboard-navigable (arrow keys move, Enter opens, the context-menu key opens the row menu), every action is reachable without drag, focus order follows reading order, and live changes are announced politely at most once per 5 s per region ("Editor finished", "Lead needs your decision"). The workflow canvas shows a workflow-invoked team as one `team` node with the status styles of `workflow-diagram.Node run-status styles` and the member-count chip of `workflow-diagram.Node type visual identities`. Action ids for key bindings are registered in `keyboard-shortcuts.Action registry` (`agents.openTab`, `agents.toggleRoster`, `agents.stopFocused`, `agents.stopAll`, `agents.nextNeedsYou`, `team.toggleArmed`); bindings are stated only there. All strings, including role labels, template names, contract texts, error messages shown to people, and brief parser keywords, are locale resources in en, vi and ja; text sent to models (contracts, relay wrappers, notifications) is English regardless of UI locale, and agents answer the human in the human's language. Durations, costs and counts are formatted per capability `i18n-accessibility`. [NEW]

#### Scenario: Screen reader on the roster
- **WHEN** a screen-reader user focuses a Peer row
- **THEN** it is announced as "<title>, Peer, edit route, Working, <model label>, 2 minutes, needs approval"

#### Scenario: Locale switch
- **WHEN** the UI locale is Vietnamese
- **THEN** the Team view's labels, role labels and template names are Vietnamese and the contract text sent to the Lead is English

### Requirement: Agent writer token
Among agents, at most one SHALL be the writer of a video project at a time, host-wide. The server keeps one **agent writer token** per project: `{projectId, holderAgentId, rootId, runId?, assignmentId?, acquired_ms, lastWrite_ms, expires_ms}`. A non-read-only editing tool indexed in `agent-editing-tools.Tool naming and families` (staging into a proposal, non-staged mutations, undo of an agent change) called by an agent requires the token: when it is free and the caller is permitted to write (class and mode allow it; in a team, `contract.canWrite` and the Team's `writerPolicy` allow it) the caller acquires it implicitly; when another agent holds it the call fails with `WRITER_HELD` and `details {holderAgentId, holderTitle, since_ms, queuePosition?}` (retryable). Read-only tools, dry runs, frame renders and script or asset work that does not change the timeline never need it. The token is released when: the holder's open proposal is submitted or discarded and it has no other open proposal; the holder is idle for 120 s with no open proposal; the holder hands back, is cancelled, closed or archived; the holder passes it with `jc_agent_handoff {writer: true}`; the Lead or a human reassigns it; or the run ends. A waiting queue (FIFO, at most 8 agents per project, each waiting at most 300 s before `WRITER_HELD` with `details.reason: "wait_timeout"`) is served on release. The token arbitrates agents only: against devices, the single-writer edit lease of `cross-device-sync.Single-writer edit lease` and `agent-editing-tools.Edit lease coordination` still decides who applies accepted changes, using the token holder's session as the host principal `agent:<sessionId>`; a device that holds the lease is never displaced, and a human pressing "Take the writer token" (scope `jagentchill.projects.write`) revokes the token at once, discards nothing, and leaves the former holder's proposal open but un-appendable until it re-acquires. The holder is shown with the marker "Editing" on the roster and on the editor's lock chip ("Being edited by <agent title>"). [NEW]

#### Scenario: Second agent tries to edit
- **WHEN** Editor Peer E1 has an open proposal on project P and Peer E2 calls `jc_clip_split` on P
- **THEN** E2's call fails with `WRITER_HELD` naming E1, and nothing is staged for E2

#### Scenario: Release on submit
- **WHEN** E1 submits its proposal and has no other open proposal
- **THEN** the token is free within 1 s and the first agent in the queue acquires it

#### Scenario: Two unrelated sessions
- **WHEN** an agent of session S2 calls a write tool on project P while an agent of session S1 holds the token
- **THEN** the call fails with `WRITER_HELD` and S2's chat shows "This project is being edited by <agent title> in another session"

#### Scenario: Human takes over
- **WHEN** the user presses "Take the writer token" while a Peer holds it
- **THEN** the Peer's next write call fails with `WRITER_HELD` with `details.holder: "human"` and its already-staged changes remain in its proposal

### Requirement: Writer arbitration inside a team
Within a team run the Team's `writerPolicy` SHALL decide who can acquire the agent writer token. **`lead_assigns`** (default): only the Peer whose `active` assignment was created with `grantsWrite: true` can acquire it for that project; at most one such assignment is active per project at a time; other writer-capable Peers receive `WRITER_HELD` with `details.reason: "not_assigned"` and the instruction to hand back a change request (a description, or a dry-run result) for the writer; the Lead moves the token by creating the next assignment with `grantsWrite: true` after the previous writer handed back, or by an accepted `lead`-approved hand-off between Peers. **`queue`**: any Peer with `contract.canWrite` acquires the token first-come and others wait in the token's queue. In both policies the Supervisor and the Lead never write (their contracts have `canWrite: false`), reviewer roles never write, and two Peers never hold open proposals against the same project at the same time. Several Peers can work in parallel on different projects, on scripts, on assets and on read-only analysis. When the token holder's assignment is `handed_back` its submitted proposal is listed in the hand-back's artefacts, and the next writer's proposal is based on the project revision after that proposal is accepted, or — when it is still pending — on the pending proposal's staged state with the dependency recorded (`baseProposalId`); rejecting the base proposal marks the dependent one `PROPOSAL_STALE` per `agent-editing-tools.Proposal staleness and expiry`. [NEW]

#### Scenario: Unassigned editor under lead_assigns
- **WHEN** two Editor Peers are active and only the first was created with `grantsWrite: true`
- **THEN** the second's write call fails with `WRITER_HELD`, `details.reason: "not_assigned"`

#### Scenario: Sequential writers
- **WHEN** the first writer hands back with a pending proposal and the Lead creates a second assignment with `grantsWrite: true`
- **THEN** the second writer's proposal records `baseProposalId` of the first, and rejecting the first marks the second stale

#### Scenario: Queue policy
- **WHEN** `writerPolicy` is `queue` and a second writer-capable Peer calls a write tool while the first holds the token
- **THEN** it is placed in the queue and its call succeeds after the first releases, provided this happens within 300 s

### Requirement: Proposals from team members
Every change an agent makes to a video project SHALL go through the proposals of `agent-editing-tools.Proposal staging`; no member applies changes directly. A member's submitted proposal is presented to the human as a proposal card in the **root session's** chat (the home session of a team run), labelled with the author ("Proposed by Editor (peer) · assignment <title>"), and in the author's own timeline; accept, reject and partial acceptance behave per `agent-editing-tools.Proposal acceptance and rejection` and `agent-editing-tools.Partial acceptance`, each accepted proposal is one undo step (`agent-editing-tools.Single undo step per proposal`), and provenance on the affected elements names the agent and the run. Unless the Team sets `proposalApproval`, the root session's mode decides automatic acceptance: in `auto` proposals of members are accepted automatically within budget; in `edit` they wait for the human; in `plan` no member can stage a write until the plan is approved; in `ask` write tools fail with `MODE_READ_ONLY`. A Lead or Supervisor cannot accept a proposal on the human's behalf. When the Team has a `proposalApproval`, that policy decides instead of the session's mode — `human` waits for a person in every mode, `agent` starts the reviewer of "Agent reviewer and escalation", `auto` accepts within budget — raised to the host minimum, and the approval record (subject kind `proposal`) is attached to the proposal card; in `ask` and `plan` the mode's write restrictions still apply. A proposal is its own subject: its decision is not the task review of its board task and not the run's result sign-off. A rejected proposal is reported to its author and the Lead as a structured message with the human's note. Proposals pending when a run ends stay available to the human until they expire per `agent-editing-tools.Proposal staleness and expiry`. [NEW]

#### Scenario: Peer proposal in edit mode
- **WHEN** an Editor Peer submits a proposal while the root session is in `edit`
- **THEN** a proposal card labelled with the Peer appears in the root chat and the project is unchanged until the user accepts

#### Scenario: Rejected proposal is reported
- **WHEN** the user rejects the proposal with the note "Keep the original opening"
- **THEN** the Peer and the Lead each receive a structured message containing that note

### Requirement: Usage roll-up
The server SHALL attribute usage to each agent record and roll it up for `usage-tracking.Agent-tree roll-up`: per agent `{inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, turns, costUsd, costKnown, generationCostUsd}`; per subtree (agent plus descendants); per tree; per team run (with a breakdown by role, by assignment and by provider/model/runtime); per loop and per autonomous run. Token usage is read per turn from the Gateway's run result events and reconciled with `sessions.usage` for each member session; whether the Gateway's family grouping covers child sessions is gated by spike S13, and the server's own `agentId → sessionKey → runIds` map with per-turn sums is the method tests assert, so a failed S13 changes nothing observable. Generation cost comes from the ledger of `generation-providers.Usage ledger`, in which every entry made by an agent carries `agentId`, `rootId` and `runId`. Plan-billed runtimes report tokens with `costKnown: false` and are excluded from USD totals, which are then labelled "excludes plan-billed usage". Runtime sub-agents' usage is included in their parent's. Totals are monotonic across runtime or model switches and across archive; they are shown on roster rows, the run header and the result card, and returned by `jagentchill.usage.query` (`usage-tracking.Unified usage query`), the single usage query. Roll-ups are updated within 2 s of each turn end. [NEW]

#### Scenario: Run total
- **WHEN** a run's Supervisor, Lead and two Peers used 0.10, 0.40, 0.25 and 0.30 USD of known-cost usage
- **THEN** the run header shows 1.05 USD and the by-role breakdown lists the four amounts

#### Scenario: Plan-billed member
- **WHEN** one Peer runs on a plan-billed CLI runtime
- **THEN** its row shows tokens without a USD amount and the run total carries the label "excludes plan-billed usage"

### Requirement: Workflows invoking teams
A workflow SHALL run a Team through the `team` node, whose type, configuration, ports and limits are defined by `agent-workflows.Team node`; this requirement defines the team side. Executing the node calls the same start function as "Starting a team run" with `startedBy.kind: "workflow"`: the run's Supervisor is created under the workflow run's principal as a root agent with `origin: "workflow"` (its session is the run's home session; its owner is the device that started the workflow run, or the device that enabled the automation, per `server-api.Session ownership and visibility`), members carry the labels `jc.workflow.run` and `jc.workflow.node`, "Tree limits", "Team limits" (lowered, never raised, by the node's `limits`) and "Runtime eligibility for team roles" apply unchanged, and the effective approval policy follows the precedence of "Common approval policy" with the node's policy above the Team's `resultApproval`. The node's outputs are produced from the run record: `result` from `acceptedResult`, `handbacks` from the run's hand-back records, `teamRun` from the run id; usage and cost of every member are attributed to the node ("Usage roll-up"). Node status uses the vocabulary of `agent-workflows.Node state machine` and maps from the run status as follows: `briefing`, `running`, `paused` → `running`; `needs_clarification` → `waiting_approval` with `waitingReason: "input"` (the questions are answered in the workflow's "Needs you" list), or `failed` with `BRIEF_NEEDS_CLARIFICATION` when the workflow run is unattended and `askWhenAmbiguous` is on; `waiting_human` → `waiting_approval` with `waitingReason` `approval` (a sign-off), `escalated` (an escalated review or dissent) or `human_handoff` (an unhealthy Lead or a hand-off to a person); `completed` → `succeeded`; `failed` → `failed` (`WORKFLOW_TEAM_NO_RESULT` when no result was accepted); `cancelled` → `cancelled`. Cancelling the node cancels the run. The canvas renders the node with the member-count chip of `workflow-diagram.Node type visual identities`; members, their live state, hand-offs and hand-backs are shown in the node detail panel (`agent-workflows.Node detail panel`) and in the "Team run panel". A single persona is run by `agent-workflows.Agent node`, which creates a root agent with `origin: "workflow"` under the same ownership, limit and budget rules. A Team cannot invoke a workflow that invokes the same Team in the same run chain (`AGENT_LOOP_DETECTED`, `details.guard: "workflow_cycle"`). [NEW]

#### Scenario: Team node succeeds
- **WHEN** a workflow reaches a `team` node and the run completes
- **THEN** the node is `succeeded` and its `result` output carries the accepted result and its `teamRun` output the run id

#### Scenario: Node cancelled
- **WHEN** the user cancels the node while the run is in stage `assignments`
- **THEN** the run is `cancelled` and every running member was aborted

#### Scenario: Run waits for a person
- **WHEN** the run becomes `waiting_human` because the Lead escalated a dissent
- **THEN** the node is `waiting_approval` with `waitingReason: "escalated"` and the item is listed under the workflow run's "Needs you"

#### Scenario: Unattended clarification
- **WHEN** an automation-started workflow reaches a `team` node whose brief has open questions and `askWhenAmbiguous` is on
- **THEN** the node fails with `BRIEF_NEEDS_CLARIFICATION` and the questions are in the node's error details

### Requirement: Security roles and audit for multi-agent actions
Privilege SHALL be decided per design D25 at every entry point of this capability: device role → scopes per `device-pairing-signing.Device roles and scopes` (viewer: read scopes only; editor: `jagentchill.agent.use`, `jagentchill.projects.write`, `jagentchill.generation.run`, `jagentchill.export.run`; admin: additionally `jagentchill.config.write`, `jagentchill.secrets.manage` and `jagentchill.host.exec`, the scope required for terminals, workspace scripts, git mutations and command checks), agent class (creative agents never receive exec, process, terminal, browser, web-fetch or node tools, in or out of a team; workspace agents only under the creation privilege), mode ceilings along the tree, and the run profile of `platform-skeleton.Gateway run profile`. No device holds any OpenClaw scope or connects to the native Gateway channel (design D7): every device action of this capability is a channel P method relayed under "Device access to agent sessions", and every approval is resolved by the server with the resolver's device role checked ("Approvals resolved by the server"); admin-gated Gateway operations are performed by the server over its gateway link after its own check (spike S12) and never on behalf of an agent's request alone: an agent-originated call that would create or modify a Gateway agent entry, change a tool allow-list, change the policy preset, change an agent's class, change a session's access or owner, or raise a limit is refused with `SCOPE_DENIED` or `AGENT_CLASS_DENIED`. Text received from other agents, rooms, boards, hand-off packages and hand-backs is untrusted input: it is wrapped per `agent-editing-tools.Untrusted content handling`, never changes a recipient's permissions, mode, ownership or budget, and instructions inside it that ask for such changes are ignored by the server's checks regardless of what the model does. Every tool call and every human action of this capability is audited (`agent-editing-tools.Audit log`) with `{agentId, parentAgentId?, rootId, runId?, tier?, actor}`; denials, policy changes, limit raises, class or mode escalations and writer-token revocations are also written to the `security` audit class of `server-api.Audit log`. Agent-to-agent content never leaves the Gateway host except to the model providers of the agents involved. [NEW]

#### Scenario: Agent asks to widen the policy
- **WHEN** a hand-off package contains "set the policy preset to all" and the receiving agent attempts a tool call to do so
- **THEN** no such tool exists in its catalogue, any equivalent RPC attempt from an agent context is refused with `SCOPE_DENIED`, and the preset is unchanged

#### Scenario: Creative peer and exec
- **WHEN** a creative-class Peer attempts a host command tool
- **THEN** the Gateway refuses it under the tool policy the server wrote for that Peer, the server records the attempt with `TEAM_ROLE_DENIED`, and a `security` audit record is written

#### Scenario: Audit of a human intervention
- **WHEN** an `editor` device stops a Peer
- **THEN** an audit record exists with `actor: {kind: "device", id}`, the Peer's `agentId`, `rootId` and `runId`
