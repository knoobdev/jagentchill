## ADDED Requirements

### Requirement: Agent sessions run on Gateway sessions
A chat session SHALL be an OpenClaw session that only the server talks to. Channel P is the only channel a client opens (design D7 and D9): a client never connects to the native Gateway socket, holds no OpenClaw scope and no Gateway device token, and calls no Gateway method. Every operation of this capability — creating, patching, sending to, steering, aborting, reading the history of and subscribing to a session, answering approvals, plans and questions, and all session metadata — is a `jagentchill.session.*` or `jagentchill.chat.*` method or event on channel P (`chat-agent.Session and chat RPC surface`), relayed by the server under `server-api.Single client channel` and `server-api.Agent session relay`. For every call the server SHALL, in this order and before it calls the Gateway: (1) authenticate the device (`server-api.Device attestation gate and scope enforcement`); (2) check the JAgentChill scope the method names; (3) check session ownership and visibility (below); (4) check the runtime, model and mode policy of `agent-runtimes.Runtime policy enforcement on the host`. Only a call that passed all four reaches a Gateway method (`sessions.create`, `sessions.patch`, `chat.send`, `chat.abort`, `chat.history`), which the server calls over its gateway link; a refused call returns its error and changes nothing, so no policy is corrected after a Gateway call. Gateway events of a session (`agent`, `session.message`, `session.tool`, approval and question events) are consumed by the server over its gateway link and delivered to devices only as `jagentchill.chat.stream` (`chat-agent.Stream event envelope with seq and epoch`).

**Class.** A session belongs to one agent class of design D25: **creative** (a `jagentchill-*` persona with JAgentChill tools only — the default) or **workspace** (a CLI or ACP runtime, or the built-in runtime with file and command tools), with selection rights per `agent-runtimes.Who can configure and who can select`.

**Ownership and visibility.** The rules are owned by `server-api.Session ownership and visibility` and are not restated differently here: every session record carries `ownerDeviceId` (the device that created it; for a session created by an automation, a workflow or an agent, the owner of the origin), `ownerState` (`active` | `orphaned`), `agentClass` and `access` (`host` | `private`; `private` by default for every session — owner decision D1: only the owner's device and `admin` devices read it until the owner or an admin shares it with the host through `jagentchill.session.access.set` —, and always `private` for a workspace-class session: it cannot be set to `host`, so besides its owner only `admin` devices ever read it — sharing of workspace sessions is admin-only, decision E7). **Read** (get, list rows, timeline, subscribe, approvals list): the owner and every `admin` device read any session; an `editor` or `viewer` device that is not the owner reads only creative-class sessions with `access: "host"`; a workspace-class session is therefore read only by its owner and by `admin` devices, whatever the host setting "Allow workspace agents for editors" (`agents.allowWorkspaceAgentsForEditors`) says. A session a device cannot read is absent from its lists and a direct request for it fails with `NOT_FOUND`. **Act** (send, steer, queue, abort, change controls, switch runtime, fork, rewind, rename, archive, delete): the owner with scope `jagentchill.agent.use` — for a workspace-class session the owner must additionally be `admin`, or `editor` while that host setting is on (turning it off freezes an editor's own workspace sessions: read stays, act is refused); an `admin` that is not the owner; an `editor` that is not the owner only in creative-class sessions with `access: "host"`; a `viewer` never. A device that can read and cannot act gets `SCOPE_DENIED`. An `orphaned` session (its owner was revoked) is readable by `admin` devices only and accepts no turn until an admin assigns an owner with `jagentchill.session.access.set`. Answering an approval follows `chat-agent.Permission request cards`. The server evaluates these rules against the caller's current device record on every call and every stream delivery, and records for every turn its initiator (`server-api.Run initiator attribution and host-execution gating`). A Gateway session the server has no record for (for example one created on the host with the `openclaw` command) is not listed and not addressable on channel P.

Session keys have the form `agent:<agentId>:jc:<uuid>`. `jagentchill.session.get {sessionKey}` (scope `jagentchill.projects.read`, subject to the read rule) returns the record of `chat-agent.Session record and metadata` plus the snapshot of pending permission, plan, question and proposal cards. Calls over the gateway link from channel P handlers are covered by the server's gateway contract suite and, for methods the Gateway reserves for its administrator scope, by S12; the fidelity of the relayed stream (text deltas, tool events, usage, approvals) is gated per runtime by spike S21, and a runtime that fails S21 is not offered: it reports `status: "unavailable"` with `runtime/relay-unsupported` (`agent-runtimes.Error mapping`). Every chat feature requires the Gateway to be running and linked to the server. While it is not (starting, restarting, crash loop), the server stays up: every method of this capability that needs the Gateway answers `GATEWAY_UNAVAILABLE` without changing anything, reads served from the server's own store (session list, stored timeline rows, drafts, metadata) keep working, the composer shows "The agent engine is restarting on <host name>" with sending disabled, and the editor, sync, media and jobs that need no agent keep working (`server-api.Gateway supervision and lifecycle`). The `jc_*` tool calls of a session are bound to it by the server from the Gateway-reported tool calls, with no caller-identity parameter and nothing placed in the session's context for that purpose (`server-api.Agent tool endpoint and session binding`). [JAD] [NEW]

#### Scenario: One channel
- **WHEN** the app connects to a paired host and opens a session
- **THEN** exactly one connection (channel P) exists between the device and the host, and the turn's text, tool events and approval cards arrive on it as `jagentchill.chat.stream`

#### Scenario: Viewer cannot send
- **WHEN** a device with role `viewer` opens a creative-class session and a modified client sends `jagentchill.chat.send`
- **THEN** the timeline is readable, the composer is replaced by the caption "View only on this device", the call fails with `SCOPE_DENIED`, and the server made no Gateway call

#### Scenario: Editor cannot reach another owner's workspace session
- **WHEN** an `editor` device sends `jagentchill.chat.send` to a workspace-class session an admin created, while "Allow workspace agents for editors" is on
- **THEN** the call fails with `NOT_FOUND`, no turn starts, and the session is absent from that device's session list

#### Scenario: Setting turned off freezes an editor's own workspace session
- **WHEN** an `editor` owns a workspace-class session and an admin turns "Allow workspace agents for editors" off
- **THEN** the editor still reads the session and a send from it fails with `SCOPE_DENIED`

#### Scenario: Orphaned session
- **WHEN** the device that owns a session is revoked
- **THEN** the session has `ownerState: "orphaned"`, only `admin` devices list it, and a send fails until an admin assigns an owner

#### Scenario: Policy is checked before the Gateway is called
- **WHEN** an `editor` device calls `jagentchill.session.create` with a `ref` naming a workspace runtime it is not permitted to select
- **THEN** the call fails with `SCOPE_DENIED` and no Gateway session was created

#### Scenario: Session unknown to the server
- **WHEN** a session was created on the host with the `openclaw` command and a device calls `jagentchill.session.get` with its key
- **THEN** the call fails with `NOT_FOUND`

#### Scenario: No Gateway is paired
- **WHEN** a user opens the Sessions area on a device with no paired host
- **THEN** the area shows an empty state titled "Connect a host to use the agent" with a single primary button "Pair a host"
- **AND** the composer is not rendered
- **AND** the editor, projects and media library remain usable

#### Scenario: Runtime fails the relay spike
- **WHEN** the S21 result for a runtime is `fail` on the pinned Gateway
- **THEN** that runtime is listed `unavailable` with `runtime/relay-unsupported` and cannot be selected for a session

### Requirement: Session creation from the home composer
The app SHALL create a session when the user submits a composer whose target is `session` (`chat-agent.Composer targets`). Creation SHALL call, on channel P, `jagentchill.session.create {clientSessionId, agentId, mode, ref?: {runtimeId, providerId, modelId}, thinkingOptionId?, features?, skillIds?, projectId?, workspaceId?, worktree?, attachments[], orcOverride?, armTeam?: {teamId}}` (scope `jagentchill.agent.use`); after the checks of `chat-agent.Agent sessions run on Gateway sessions` the server creates the OpenClaw session over its gateway link with `sessions.create {model, agentRuntime, thinkingLevel, permissionMode, toolOverrides, cwd, projectId}` — `permissionMode` is always present: `read-only` for a creative-class session under every product mode, and for a workspace-class session the value `agent-runtimes.Runtime modes catalogue` maps from the draft's `mode` (Ask and Plan `read-only`, Edit `guarded`, Auto `workspace`), as `server-api.Agent session relay` requires — records the calling device as `ownerDeviceId`, and returns `{sessionId, sessionKey}`, after which the client sends the first message with `jagentchill.chat.send` (`chat-agent.Message send idempotency and optimistic echo`). `skillIds` is accepted only on a draft produced by `jagentchill.session.fork` (it carries the source session's attached skills); an ordinary draft has no Skills control (`chat-agent.Skills control`) and a request that sets it there fails with `INVALID_PARAMS`. `workspaceId` and `worktree` create a workspace-class session in that workspace under the rows of `workspaces-terminal.Role and permission matrix`; this method is the only way a workspace session is created. The app SHALL navigate to the session view within 150 ms of submission, before the response arrives, showing the user message as pending. `clientSessionId` is a client-generated UUID used as the idempotency key: a repeated request with the same value MUST return the existing session and MUST NOT create a second one. When `ref` is absent the runtime, model, thinking and mode come from `agent-runtimes.Per-role defaults through ORC`. A request naming a workspace-class runtime from a device not permitted to select it fails with `SCOPE_DENIED` and creates nothing. A session created without `projectId` is unbound until a project is attached. [JAD] [NEW]

#### Scenario: First message creates a session
- **WHEN** the user types "Cut the silences out of my interview" in the home composer and presses the send key
- **THEN** the session view opens within 150 ms with the message shown as pending
- **AND** a session row appears at the top of the "Recent" group in the sidebar with the meta line "Working"

#### Scenario: Create request is retried after a network drop
- **WHEN** the create request is sent twice with the same `clientSessionId` because the first response was lost
- **THEN** exactly one session exists on the Gateway
- **AND** the first user message appears exactly once in its timeline

#### Scenario: Creation fails
- **WHEN** the server rejects the create request
- **THEN** the pending message shows a danger-coloured "Not sent" label with "Retry" and "Edit" actions
- **AND** the typed text and attachments are preserved in the composer draft

#### Scenario: Editor picks a CLI runtime without permission
- **WHEN** an `editor` device submits a draft whose `ref` names a CLI runtime while "Allow workspace agents for editors" is off
- **THEN** the request fails with `SCOPE_DENIED`, no session exists, and the draft shows "Admin devices only"

#### Scenario: Permission mode is set at creation
- **WHEN** a creative session is created from the home composer with the mode control on "Auto"
- **THEN** the Gateway session is created with `permissionMode: "read-only"`, the product mode `auto` is stored on the session record, and no session exists on the Gateway without a permission mode

### Requirement: Composer targets
The composer SHALL have a target, chosen with a pill at the leading end of its bottom row on the home composer only: `session` (label "Chat", default), `video` (label "Video") and `film` (label "Film"). "Video" and "Film" are targets, never session modes, and the mode control of `chat-agent.Composer modes` is shown only for the `session` target. Sending with target `video` creates a draft run of the prompt-to-video template through `agent-workflows.Run setup form` (`jc_workflow_start` semantics of `agent-workflows.Workflow run tools`, status `draft`, no job queued) with the composer text as the prompt and attachments as source material, and navigates to that run. Sending with target `film` creates a film in `film-production` (title = the first 60 characters of the text, the full text as the source of episode 1) and navigates to its Story stage. The slash commands `/workflow <prompt>` and `/film <story>` do the same from a session composer. Both targets require the scope `jagentchill.generation.run`; without it the two pills are dimmed with "This device cannot start paid runs". The last used target is remembered per device. [NEW]

#### Scenario: Video target opens a draft run
- **WHEN** the user selects "Video", types "30 second teaser about our spring sale" and sends
- **THEN** a workflow run in status `draft` exists with that prompt, the run setup form is shown, and no generation job has been queued

#### Scenario: Film target creates a film
- **WHEN** the user selects "Film" and sends a 900-character story
- **THEN** a film whose title is the first 60 characters exists and its Story stage opens with the text as episode 1 source

#### Scenario: Targets are not modes
- **WHEN** the target is "Video"
- **THEN** the mode control is not rendered and the session mode preference is unchanged

#### Scenario: Device without the generation scope
- **WHEN** a device lacking `jagentchill.generation.run` opens the home composer
- **THEN** "Video" and "Film" are dimmed with the stated reason and only "Chat" can be selected

### Requirement: Session record and metadata
Each session SHALL expose the following record through `jagentchill.session.get` and in the rows of `jagentchill.session.list` (both scope `jagentchill.projects.read`, channel P, subject to the read rule of `chat-agent.Agent sessions run on Gateway sessions`): `id`, `key`, `agentId`, `agentClass` (`creative` | `workspace`), `ownerDeviceId`, `ownerState`, `access`, `revision`, `title`, `titleSource` (`auto` | `user`), `mode`, `status`, `runtime {ref {runtimeId, providerId, modelId}, modeId, thinkingOptionId, featureValues, unattended}`, `projectId?`, `workspaceId?`, `folderId?`, `tags[]` (0–10 tags, each 1–24 characters), `pinned`, `archived_ms?`, `created_ms`, `updated_ms`, `lastMessagePreview` (first 120 characters of the last assistant text), `unread`, `requiresAttention`, `attentionReason` (`finished` | `error` | `permission` | `question` | `plan` | `proposal`), `parentSessionId?`, `forkedFromSeq?`, `importedFrom? {runtimeId, nativeId}`, `rootAgentId?`, `origin` (`user` | `automation` | `agent` | `workflow`), `usage {inputTokens, outputTokens, costUsd}` (totals supplied by `usage-tracking.Session totals`), `queuedCount`, `pendingPermissionCount`, `pendingQuestionCount` and `pendingProposalCount`. The server SHALL persist this metadata in the host store of `server-api.Host data store` keyed by session key, and SHALL push every change as the targeted channel P event `jagentchill.session.updated`. `jagentchill.session.list {query?, filters?: {status?[], folderId?, tag?, projectId?, agentId?, runtimeId?, origin?, archived?: boolean, created?: {from_ms?, to_ms?}}, sort?: "updated" | "created" | "relevance", cursor?, limit? (1–100, default 50)}` returns `{items[], nextCursor?, total}` under `server-api.List pagination`; with `query` each item adds `match {field: "title" | "tag" | "message", fragment}` (`chat-agent.Session search and filters`). Metadata writes use `jagentchill.session.update {sessionKey, patch: {title?, tags?, folderId? (null removes), pinned?, archived?, agentId?, projectId? (null unbinds), read?}, expectedRevision?}` (scope `jagentchill.agent.use` and the act rule of `chat-agent.Agent sessions run on Gateway sessions`; `read: true` alone needs only the read rule): `title` is `chat-agent.Session rename and automatic title`, `tags` `chat-agent.Session tags`, `folderId` `chat-agent.Session folders`, `pinned` `chat-agent.Session pin`, `archived` `chat-agent.Session archive and restore`, `agentId` `chat-agent.Persona picker`, `projectId` `chat-agent.Session project binding`, and `read` clears `unread` for every device; a stale `expectedRevision` fails with `CONFLICT`. [JAD] [NEW]

#### Scenario: Metadata survives a Gateway restart
- **WHEN** a session has a user title, two tags, a folder and the pinned flag, and the Gateway restarts
- **THEN** `jagentchill.session.get` returns the same title, tags, folder and pinned flag

#### Scenario: Tag limit
- **WHEN** a client tries to add an eleventh tag to a session
- **THEN** the request fails with error code `TAG_LIMIT_EXCEEDED`
- **AND** the existing ten tags are unchanged

#### Scenario: Runtime state is part of the record
- **WHEN** the model of a session is changed on the desktop
- **THEN** `jagentchill.session.updated` reaches the phone within 1 s carrying the new `runtime.ref`

### Requirement: Session lifecycle states
A session SHALL be in exactly one of the states `initializing`, `idle`, `queued`, `running`, `waiting`, `error` or `closed`. `queued` means a sent message is waiting for a free turn slot (`chat-agent.Concurrent session limits`). `waiting` means a running turn is blocked on a permission request, a plan approval or a question that needs a person; a submitted proposal does not hold a turn (`agent-editing-tools.Proposal staging`): the turn ends, the session is `idle` and `pendingProposalCount` is 1. Transitions SHALL be exactly: `initializing → idle`; `idle → running` and `idle → queued` on message send; `queued → running` when a slot frees; `queued → idle` when the queued message is removed; `running → waiting` when a blocking request is raised; `waiting → running` when it is resolved; `waiting → idle` when the turn is stopped or the request expires and the turn ends; `waiting → error` when the turn fails while blocked; `running → idle` on turn completion or cancellation; `running → error` on turn failure; `error → running` and `error → queued` on the next message; any state → `closed` on archive or delete. Every transition MUST reach every subscribed device as `jagentchill.session.updated` within 500 ms. [JAD] [NEW]

#### Scenario: Blocking request moves the session to waiting
- **WHEN** a running turn raises a permission request
- **THEN** the session status becomes `waiting` on every connected client within 500 ms
- **AND** the sidebar row meta line reads "Needs approval" in the warning colour

#### Scenario: Submitted proposal leaves the session idle
- **WHEN** the agent submits a proposal and its turn ends
- **THEN** the session status is `idle`, `pendingProposalCount` is 1 and the row meta line reads "Proposal ready"

#### Scenario: Stop while waiting
- **WHEN** the user stops a turn that is waiting on a permission request
- **THEN** the request is resolved as cancelled and the session becomes `idle`

#### Scenario: Failed turn is recoverable
- **WHEN** a turn fails with a provider error
- **THEN** the status becomes `error` and an error item is appended to the timeline
- **AND** sending a new message moves the session to `running`

### Requirement: Session list in the sidebar
The sidebar SHALL list sessions under the captions "Pinned", one caption per folder, and "Recent", in that order. Rows SHALL show the title on one truncated line (13 px) and a meta line (12 px, secondary text colour) holding either a relative time or a status label ("Working", "Needs approval", "Has a question", "Proposal ready", "Failed"). A 6 px accent dot at the right marks an unread session. "Recent" SHALL be sorted by `updated_ms` descending and loaded 50 rows at a time when the list is scrolled to within 200 px of its end. The section header SHALL have search, "+" (new session) and "⋯" (show archived, sort by created or updated) buttons. An empty list SHALL show the text "No sessions". Archived sessions are hidden unless "Show archived" is on. [JAD] [NEW]

#### Scenario: Unread marker
- **WHEN** a session that is not open on this device receives a completed assistant turn
- **THEN** its row shows the 6 px accent dot
- **AND** opening the session removes the dot on all of the user's connected devices within 2 s

#### Scenario: Paging the recent list
- **WHEN** 120 unarchived sessions exist and the sidebar is opened
- **THEN** 50 rows are loaded
- **AND** scrolling to the end loads the next 50 without duplicating a row

#### Scenario: Mobile drawer
- **WHEN** the app runs on a viewport narrower than 720 px
- **THEN** the session list is presented in a left drawer opened by an edge swipe or the top-bar menu button
- **AND** rows are 44 px tall

### Requirement: Session resume
Opening an existing session SHALL attach to it without creating a turn: the app subscribes to the session's stream, fetches one tail page as defined in `chat-agent.Initial load and history paging`, restores the composer draft and the last active workspace tab, and renders pending permission, question and proposal cards from the session snapshot. If the last painted state for the session is in the local replica cache (bounded at 1 MiB per session), it SHALL be painted within 100 ms and replaced when the authoritative fetch arrives. A session whose agent turn was interrupted by a Gateway restart SHALL resume in state `idle` with a status line "Interrupted by a host restart" and a "Continue" button that sends the message "Continue". [JAD] [NEW]

#### Scenario: Resume on another device
- **WHEN** a session is running on the desktop and the user opens it on a phone
- **THEN** the phone shows the same timeline entries up to the current `seq`
- **AND** new stream entries appear on both devices

#### Scenario: Resume after Gateway restart
- **WHEN** the Gateway restarts while a turn is running and the user reopens the session
- **THEN** the session is `idle`, the partial assistant text produced before the restart is present, and the status line "Interrupted by a host restart" is shown with a "Continue" button

### Requirement: Session rename and automatic title
A new session SHALL get an automatic title of at most 60 characters generated from the first user message through the `quick` task route of the persona's ORC role (`orc-model-routing.Routes with primary and ordered fallbacks`), applied within 10 s of the first message; until then, and when that call fails, the title is the first 60 characters of the message. The user SHALL be able to rename a session from the session menu, by double-clicking the title in the top bar (desktop/web), or by long-pressing the row (mobile). A user title is 1–120 characters after trimming, sets `titleSource` to `user`, and MUST never be overwritten by automatic titling. [JAD] [NEW]

#### Scenario: Automatic title
- **WHEN** a session is created with the message "Make a 30 second vertical teaser from the three clips I uploaded and add upbeat music"
- **THEN** the title is replaced within 10 s by a generated title no longer than 60 characters

#### Scenario: Title model unavailable
- **WHEN** the `quick` route fails with `NO_ROUTE`
- **THEN** the title stays the first 60 characters of the message and no error is shown

#### Scenario: User title is preserved
- **WHEN** the user renames the session to "Teaser v2" and sends five more messages
- **THEN** the title remains "Teaser v2"

#### Scenario: Empty title rejected
- **WHEN** the user submits a title consisting only of whitespace
- **THEN** the rename is rejected with the inline message "Enter a title" and the previous title is kept

### Requirement: Session pin
The user SHALL be able to pin and unpin a session from the session menu and the row context menu. Pinned sessions appear under "Pinned" above all folders, ordered by pin time descending. At most 20 sessions can be pinned. [NEW]

#### Scenario: Pin a session
- **WHEN** the user chooses "Pin" on a session in "Recent"
- **THEN** the row moves to the "Pinned" group on all connected devices

#### Scenario: Pin limit
- **WHEN** 20 sessions are pinned and the user pins another
- **THEN** a toast reads "You can pin up to 20 sessions" and the session stays unpinned

### Requirement: Session folders
The user SHALL be able to create, rename, reorder and delete folders and move a session into exactly one folder or none. Folder names are 1–40 characters and unique case-insensitively. At most 50 folders exist. Deleting a folder MUST NOT delete its sessions; they return to "Recent". The session top bar SHALL show the folder as a chip. Folders are host data shared by every device: `jagentchill.session.folder.list {}` (scope `jagentchill.projects.read`) returns `{folders[] {id, name, order, sessionCount}}`; `jagentchill.session.folder.upsert {id?, name}`, `jagentchill.session.folder.remove {id}` and `jagentchill.session.folder.reorder {ids[]}` (scope `jagentchill.agent.use`) create or rename, delete and reorder them; a duplicate name fails with `ALREADY_EXISTS` and a 51st folder with `QUOTA_EXCEEDED`. A session is moved with `jagentchill.session.update {patch: {folderId}}`. Changes reach subscribed devices as `jagentchill.session.updated` with `folders` set. [NEW]

#### Scenario: Create a folder from the session menu
- **WHEN** the user picks "Folders → New folder", types "Client A" and confirms
- **THEN** the folder "Client A" exists, the session is inside it, and the top bar shows a "Client A" chip

#### Scenario: Delete a folder with sessions
- **WHEN** the user deletes a folder holding 4 sessions and confirms the dialog "Delete folder? Its 4 sessions are kept."
- **THEN** the folder is removed and the 4 sessions appear under "Recent"

#### Scenario: Duplicate folder name
- **WHEN** the user creates a folder named "client a" while "Client A" exists
- **THEN** the dialog shows "A folder with this name already exists" and nothing is created

### Requirement: Session tags
The user SHALL edit tags through a tag picker modal with a search field, a checkbox list of existing tags and a "Create '<text>'" row. Tags render as grey pills in the top bar and are usable as filters in session search. Removing the last use of a tag removes it from the picker. [NEW]

#### Scenario: Create and apply a tag
- **WHEN** the user opens "Edit tags", types "shorts" and selects "Create 'shorts'"
- **THEN** the session shows a "shorts" pill
- **AND** "shorts" is offered in the picker for other sessions

#### Scenario: Filter by tag
- **WHEN** the user filters the session list by the tag "shorts"
- **THEN** only sessions carrying that tag are listed

### Requirement: Session archive and restore
Archiving (`jagentchill.session.update {patch: {archived: true}}`; restoring sends `archived: false`) SHALL stop any running turn (after confirmation when one is running), set `archived_ms`, set state `closed`, and hide the session from default lists. Pending permissions, questions and unresolved proposals in the session SHALL be cancelled with reason `session_archived`. Restoring clears `archived_ms` and returns the session to `idle` with its full history. A toast "Session archived" with an "Undo" link SHALL be shown for 6 s. [JAD] [NEW]

#### Scenario: Archive with undo
- **WHEN** the user archives an idle session and clicks "Undo" within 6 s
- **THEN** the session is restored to its previous list position

#### Scenario: Archive a running session
- **WHEN** the user archives a session whose turn is running
- **THEN** a confirm dialog reads "The agent is still working. Stop and archive?"
- **AND** confirming aborts the turn and discards any staged proposal that was not accepted

### Requirement: Session delete
Deleting a session SHALL require a confirm dialog naming the session, and `jagentchill.session.delete {sessionKey}` (scope `jagentchill.agent.use` and the act rule of `chat-agent.Agent sessions run on Gateway sessions`; a running turn is aborted first; the server deletes the Gateway session over its gateway link) SHALL permanently remove its transcript, attachments that are not referenced by a project, and metadata; usage records keep the session id and are retained as defined by `usage-tracking.Retention and reset`. Project edits already accepted from the session MUST remain in the project. Deletion is not undoable. [NEW]

#### Scenario: Delete keeps accepted edits
- **WHEN** a session whose proposals were accepted into project "Promo" is deleted
- **THEN** the session disappears from every device
- **AND** project "Promo" is unchanged and its undo history is intact

#### Scenario: Delete is confirmed
- **WHEN** the user chooses "Delete"
- **THEN** a dialog reads "Delete '<title>'? This cannot be undone." with a destructive "Delete" button and "Cancel"
- **AND** nothing is deleted until "Delete" is pressed

#### Scenario: Editor deletes a workspace session it cannot drive
- **WHEN** an `editor` that owns a workspace-class session calls `jagentchill.session.delete` on it after "Allow workspace agents for editors" was turned off
- **THEN** the call fails with `SCOPE_DENIED` and the session is unchanged

### Requirement: Session fork
The user SHALL be able to fork a session from the session menu ("Fork session", boundary = the current context including a partly streamed turn) and from any completed assistant message or any user message ("Fork from here", boundary = that entry). `jagentchill.session.fork {sessionKey, boundary?: {epoch, seq} | {messageId}, destination: "session" | "workspace", workspaceId?}` (scope `jagentchill.agent.use`) SHALL open a **draft** — never a running session — pre-filled with the source session's agent, runtime, model, mode, thinking option, feature values, attached skills, project binding and ORC overrides, with `parentSessionId` and `forkedFromSeq` set and the title "<source title> (fork)". The prior conversation is carried in one of two ways: on a runtime whose `capabilities.fork` is true the server creates the new session with `sessions.create {parentSessionKey, fork}` so the native transcript is copied up to the boundary; otherwise the draft receives a `chat-history` attachment built by the curation rules of `agent-runtimes.Durable history hand-over` and cut at the boundary. Destination `session` opens the draft as a new session; destination `workspace` (workspace-class sessions only, device permitted to create workspace agents) opens it in a new worktree workspace of `workspaces-terminal.Worktree targets and limits`. A fork MUST NOT copy pending permissions, questions, queued messages, the unattended grant or unresolved proposals, and MUST NOT alter the source session. Boundary validation: a boundary from an older timeline epoch or naming a missing row fails with `FORK_ANCHOR_GONE` and the message "Selected timeline position is no longer available."; a boundary inside an entry that changed after it was rendered fails with `FORK_ANCHOR_CHANGED` and the message "This checkpoint changed after it was created. Fork from a more recent completed response or from the current context instead." Read-only panes (runtime-native sub-agents) offer no fork. [JAD JD-MID-013, JD-MID-014] [NEW]

#### Scenario: Fork from an assistant message
- **WHEN** the user chooses "Fork from here" on the third assistant message of a session
- **THEN** a draft opens whose history ends with that message, with the same runtime, model, mode and thinking option preselected
- **AND** the source session still contains its full history and keeps running if it was running

#### Scenario: Fork on a runtime without native fork
- **WHEN** the source runtime has `capabilities.fork: false`
- **THEN** the draft carries one `chat-history` attachment chip "Chat history (<n> items)" and no native transcript is copied

#### Scenario: Stale anchor
- **WHEN** the user forks from a row of an epoch that was replaced by a rewind on another device
- **THEN** the request fails with `FORK_ANCHOR_GONE` and the stated message, and no draft is created

#### Scenario: Changed anchor
- **WHEN** the boundary names an assistant row that is still streaming
- **THEN** the request fails with `FORK_ANCHOR_CHANGED` and the stated message

#### Scenario: Fork into a new workspace
- **WHEN** an admin forks a workspace session with destination `workspace`
- **THEN** a worktree workspace is created and the draft opens there with the source's runtime and model

### Requirement: Session rewind
User messages SHALL carry a rewind action (undo icon, tooltip "Rewind to this message") that opens a menu headed "This action cannot be undone" with only the items the session supports: "Rewind conversation" (offered when the runtime's `capabilities.rewind.conversation` is true), "Rewind files" (workspace sessions whose runtime has `capabilities.rewind.files`; at the pinned Gateway tag no runtime reports it — `agent-runtimes.Published capability matrix` — so the item is absent everywhere until a matrix generated for a newer tag reports it), "Rewind project changes" (sessions with accepted proposals after that message; always host-supported) and "Rewind conversation and changes" (conversation plus whichever of files and project changes apply). The menu is absent when no item applies. `jagentchill.session.rewind {sessionKey, messageId, scope: ("conversation" | "files" | "project")[]}` (scope `jagentchill.agent.use`, plus `jagentchill.projects.write` for `project`) SHALL: refuse a message the runtime has not yet acknowledged with `REWIND_NOT_ACKNOWLEDGED` ("Cannot rewind before the agent acknowledges this message"); cancel a running turn first and wait for the acknowledgement of `chat-agent.Stop a running turn`; perform the runtime's native revert for `conversation` and `files` — the server calls `sessions.rewind` over its gateway link, which the Gateway reserves for its administrator scope, so this step is gated by spike S12 (`agent-runtimes.Admin proxy and Gateway reuse`), and when S12 fails `capabilities.rewind.conversation` is published `false` for every runtime, "Rewind conversation" and "Rewind conversation and changes" are absent and only "Rewind project changes" remains; for `project`, apply the stored inverse batches of every proposal of this session accepted after that message, newest first, as one change through `agent-editing-tools.Single undo step per proposal` and `agent-editing-tools.Edit lease coordination`; and, unless the scope is `files` only, rebuild the timeline and publish it with a new epoch (`chat-agent.Epoch reset handling`). While the chosen item runs it shows a pending state and the menu cannot be dismissed. After a conversation rewind the message text and attachments are restored into the composer. When a proposal to revert touched elements the user edited afterwards, the dialog lists those proposals under "Changed since" with "Revert anyway" and "Skip these". An unsupported scope fails with `runtime/unsupported-capability`. [JAD JD-MID-015, JD-MID-016] [NEW]

#### Scenario: Only supported items are offered
- **WHEN** the session runs on a runtime with `rewind {conversation: true, files: false}` and no proposal was accepted after the message
- **THEN** the menu shows the warning header and the single item "Rewind conversation"

#### Scenario: Rewind conversation and project
- **WHEN** the user chooses "Rewind conversation and changes" on a message after which two proposals were accepted
- **THEN** the timeline ends at that message under a new epoch and the composer holds its text
- **AND** the project no longer contains the two proposals' changes, and one "Revert this change" entry restores them

#### Scenario: Running turn is cancelled first
- **WHEN** the user confirms a rewind while a turn is running
- **THEN** the turn is cancelled, the rewind starts only after the runtime acknowledges the cancellation, and the status line "Stopped" precedes "Rewound to <time>"

#### Scenario: Unacknowledged prompt
- **WHEN** the user rewinds to a message sent 200 ms ago that the runtime has not echoed
- **THEN** the request fails with `REWIND_NOT_ACKNOWLEDGED` and nothing changes

#### Scenario: Subsequent manual edits conflict
- **WHEN** the user manually moved a clip that an accepted proposal had added and then chooses "Rewind project changes"
- **THEN** the dialog lists that proposal under "Changed since" with "Revert anyway" and "Skip these"

#### Scenario: Administrator-scope rewind unavailable
- **WHEN** the S12 result is `fail` on the pinned Gateway and two proposals were accepted after a message
- **THEN** the rewind menu of that message holds only "Rewind project changes"

### Requirement: Import CLI sessions
The app SHALL offer an "Import session" sheet — from the sidebar "+" menu, the slash command `/import`, and the workspace start tiles of `workspaces-terminal.Workspaces index and start tiles` — that adopts sessions started in a CLI's own interface, using the contract of `agent-runtimes.Session import from a CLI's native history` (`jagentchill.session.import.list` and `.create`); this requirement owns only the presentation. The sheet shows: runtime filter chips beginning with "All" (only runtimes with `capabilities.importSessions`); a refresh button; rows newest first with the title ("Untitled session" when absent), up to three prompt previews ("No prompt preview" when none), the working directory and the relative last-activity time; the row state "Importing…" while a row is being imported; and the empty states "No recent sessions to import.", "All recent sessions are already imported." and "No <runtime> sessions found." A partial failure shows "Unable to load sessions for <runtimes>." above the rows that did load. Rows already imported are hidden unless "Show imported" is on. Importing opens the new workspace-class session when its history has been replayed. The entry points are shown only to devices permitted to select workspace runtimes; on desktop and web the sheet is a 480 px side sheet, on mobile a full-height sheet. [JAD JD-MID-017] [NEW]

#### Scenario: Import a recent CLI session
- **WHEN** an admin opens the sheet, selects a row of a CLI runtime and confirms
- **THEN** the row reads "Importing…", and a new session opens with the native history replayed into its timeline

#### Scenario: Already imported sessions are filtered
- **WHEN** every recent native session was imported earlier
- **THEN** the sheet shows "All recent sessions are already imported."

#### Scenario: One runtime fails to list
- **WHEN** listing succeeds for one runtime and fails for another
- **THEN** rows of the first are shown under the notice "Unable to load sessions for <second runtime>."

#### Scenario: Device without workspace rights
- **WHEN** an `editor` device opens the sidebar "+" menu while "Allow workspace agents for editors" is off
- **THEN** "Import session" is not listed

### Requirement: Session search and filters
The session search (sidebar search button, or the command palette of `keyboard-shortcuts.Command palette` with the "Sessions" scope) SHALL match title, tags and message text, case-insensitively, returning at most 50 results ordered by relevance then `updated_ms`, with the matched fragment highlighted; it calls `jagentchill.session.list` with `query`, `filters` and `sort: "relevance"` (`chat-agent.Session record and metadata`), and the host applies the read rule of `chat-agent.Agent sessions run on Gateway sessions` before matching, so message text of a session a device cannot read never produces a result. Filters SHALL be combinable: status, folder, tag, project, persona, runtime, origin, archived, and date range. Results SHALL appear within 300 ms for a store of 5,000 sessions on the reference desktop host of `diagnostics-quality.Performance budgets`. [NEW]

#### Scenario: Search message text
- **WHEN** the user searches "green screen"
- **THEN** sessions whose messages contain "green screen" are listed with the fragment highlighted

#### Scenario: Filter by runtime
- **WHEN** the user filters by a CLI runtime
- **THEN** only sessions whose current runtime is that runtime are listed

#### Scenario: No results
- **WHEN** no session matches
- **THEN** the panel shows "No sessions match '<query>'" and a "Clear filters" link when filters are set

### Requirement: Session project binding
A session SHALL be bound to at most one project at a time. The binding is set at creation (session started from inside an editor, or a project attachment in the first message) or by the agent creating a project. The top bar SHALL show the bound project as a chip that opens the editor. Changing the binding (`jagentchill.session.update {patch: {projectId}}`) SHALL require no pending proposal and SHALL append a status line "Now working on <project name>". Editing tools that need a project MUST fail with `NO_PROJECT_BOUND` when none is bound. [NEW]

#### Scenario: Session started from the editor
- **WHEN** the user opens the agent panel inside project "Vlog 12" and sends a message
- **THEN** the session is bound to "Vlog 12" and the top bar shows a "Vlog 12" chip

#### Scenario: Rebind blocked by a pending proposal
- **WHEN** a proposal is pending and the user picks another project from the chip menu
- **THEN** a dialog reads "Accept or reject the pending proposal first" and the binding is unchanged

### Requirement: Composer layout and controls
The composer SHALL be a card (radius, hairline border and shadow from the `design-system` composer tokens) containing, top to bottom: the sub-agents track of `multi-agent-orchestration.Sub-agents track above the composer` when it has rows; the queue track of `chat-agent.Steer, queue and interrupt while running` when messages are queued; attachment chips; a multi-line text input (1 to 10 lines tall, then scrolling); and a bottom row. The bottom row holds, left to right: the target pill (home composer only, `chat-agent.Composer targets`); the "+" attach button; the control row of `chat-agent.Composer control row`; and, at the trailing end, the usage indicator of `usage-tracking.Composer usage indicator`, the microphone button and a 28 px circular send button. The send button is disabled when the input is empty and has no attachment. Placeholders: home composer "Describe the video you want, or ask for an edit…"; session composer when idle "Ask or guide the agent…"; while a turn runs "Guide the agent while it works…". The home composer is centred in a column 460 px wide; the session composer is docked at the bottom of the chat pane. Maximum message length is 32,000 characters; a counter appears from 30,000. The same composer is used wherever a chat pane is hosted (`chat-agent.Chat pane hosts`). [JAD] [NEW]

#### Scenario: Send button state
- **WHEN** the input is empty and no attachment is present
- **THEN** the send button is disabled
- **AND** typing one non-whitespace character enables it

#### Scenario: Length limit
- **WHEN** the user pastes text that brings the input to 32,500 characters
- **THEN** the counter shows "32,500 / 32,000" in the danger colour and the send button is disabled

#### Scenario: Placeholder follows the turn state
- **WHEN** a turn starts in an open session
- **THEN** the placeholder changes from "Ask or guide the agent…" to "Guide the agent while it works…"

#### Scenario: Mobile docking
- **WHEN** the on-screen keyboard opens on a phone
- **THEN** the composer stays docked directly above the keyboard and inside the bottom safe area
- **AND** every picker of the control row opens as a bottom sheet

### Requirement: Composer control row
The control row SHALL hold these controls in this order: model (the trigger of `chat-agent.Model browser`), thinking, mode, features, Skills, Autonomous, Team. A draft — a composer with no session yet — shows model, thinking, mode, features and Team only. There is no separate runtime or provider control: runtime and provider are chosen through the model browser. Every control reads its options from the session's entry in `jagentchill.runtime.models.list` (`agent-runtimes.Unified model browser data contract`) and its current values from `session.runtime` of `chat-agent.Session record and metadata`, so that all devices viewing a session show the same selection. Visibility rules: a control is **hidden** when the host lacks the feature entirely (no `multi-agent` flag → no Team and no Autonomous; host reports no skill support → no Skills); a control the host has but the selected runtime lacks stays visible and **dimmed** with the reason, as defined by `agent-runtimes.Behaviour when a runtime lacks a capability`; every control is **disabled** while the device is disconnected, with the tooltip "Unavailable while disconnected"; on a `viewer` device every control is read-only. Glyphs are 16 px on web and desktop and 20 px on mobile; hover tooltips exist on desktop and web only. [JAD JD-CMP-001, JD-CMP-002, JD-CMP-018] [NEW]

#### Scenario: Order in a live session
- **WHEN** a session composer is rendered at full width on a host with every feature
- **THEN** the controls appear in the order model, thinking, mode, features, Skills, Autonomous, Team

#### Scenario: Draft shows a subset
- **WHEN** the home composer is rendered
- **THEN** it shows model, thinking, mode, features and Team, and neither Skills nor Autonomous

#### Scenario: Host without multi-agent
- **WHEN** the Gateway does not advertise `multi-agent`
- **THEN** the Team and Autonomous controls are absent from the row, not dimmed

#### Scenario: Disconnected
- **WHEN** the connection drops
- **THEN** every control of the row is disabled with the tooltip "Unavailable while disconnected" and keeps showing its last value

### Requirement: Model browser
The model control SHALL show the current model label (accessible name "Select model (<model>)", tooltip "Change model") and open the model browser, which presents the data of `agent-runtimes.Unified model browser data contract` in two views. **All**: a search field that searches every runtime and provider at once; a "Favorites" section (favourite models from every runtime); a "Recent" section (the last 5 distinct models used on this device); then one row per runtime-and-provider group in the host's order with the runtime label, the provider label, and either the model count ("<n> models"), a spinner with "Loading", or a warning icon with "Error", plus the readiness reason of `agent-runtimes.Model readiness` and a chevron; pressing a row drills in. **Group**: a header with back, the group name and a gear button "Open <provider> settings" (admin devices; opens `agent-runtimes.Runtimes settings screen`), a search field "Search models…" scoped to the group, then that group's models with favourites sorted first when the query is empty. Each model row shows the label, capability badges (editor tools, steer, attachments), its readiness, a check on the current selection and a star toggle. Favourites are stored on the device as `{runtimeId, providerId, modelId}` triples and are not synced; because the host knows neither favourites nor recents, the client passes its favourites and its 5 recents as `includeIds[]` when it reads a large catalogue with `jagentchill.runtime.models.search` (`agent-runtimes.Aggregator model catalogues`). Initial view: when exactly one group exists → that group; else when the current model is not a favourite → the current model's group; else All. A group in error shows its message and a "Retry" button (label "Retrying…" while pending) that calls `jagentchill.runtime.snapshot.refresh` with `runtimeIds` set to that runtime only; opening the browser while the current runtime is not `ready` triggers that refresh once. A search with no match shows "No models match your search". Selecting a model of the current runtime applies `chat-agent.Live session controls`; selecting a model of another runtime starts `chat-agent.Switch runtime or provider mid-conversation`; in a draft it only updates the draft. Non-selectable rows follow `agent-runtimes.Model readiness`. On desktop and web the browser is a popover at least 360 px wide placed above the composer; on compact form factors it is part of `chat-agent.Compact composer sheet`. A link "Compare runtimes" opens the matrix of `agent-runtimes.Published capability matrix`. [JAD JD-CMP-002, JD-CMP-003, JD-CMP-004, JD-CMP-005, JD-CMP-006, JD-CMP-007] [NEW]

#### Scenario: All view lists every group
- **WHEN** two CLI runtimes and three direct providers are enabled and the current model is a favourite
- **THEN** the browser opens on All with Favorites, Recent and five group rows, each showing its model count

#### Scenario: Initial view with a non-favourite model
- **WHEN** the current model is not a favourite and several groups exist
- **THEN** the browser opens directly on the current model's group with that model checked

#### Scenario: Single group
- **WHEN** only one group is enabled
- **THEN** the browser opens on that group and the back button is hidden

#### Scenario: Favourite a model
- **WHEN** the user presses the star of a model
- **THEN** the model appears under Favorites on this device and not on the user's other devices

#### Scenario: Group error and retry
- **WHEN** a group row shows "Error" and the user presses "Retry"
- **THEN** only that runtime is re-probed, the button reads "Retrying…", and the other groups are not reloaded

#### Scenario: Cross-runtime search
- **WHEN** the user types "sonnet" in the All view
- **THEN** matching models of every runtime are listed, each with its runtime label

#### Scenario: No match
- **WHEN** the query matches no model
- **THEN** the list shows "No models match your search"

### Requirement: Mode control
The mode control SHALL be a button with the current mode's icon and colour tier (tiers and the per-runtime mapping are `agent-runtimes.Runtime modes catalogue`), with its label hidden at the tightest density. It opens a list with a search field "Search modes…" (shown when more than 6 modes exist) holding the four product modes of `chat-agent.Composer modes` first and the runtime's native modes after them; unsupported product modes are dimmed with their reason. Selecting a mode stores it in the device preferences for that runtime and applies it per `chat-agent.Live session controls`; a notice returned by the runtime is shown as a toast and a failure as an error toast with the previous mode restored. The runtime's unattended mode is listed last, in the `dangerous` tier, only for workspace-class sessions on admin devices, and selecting it opens the confirmation of `agent-runtimes.Unattended modes and their warning`; it is never stored as a preference. [JAD JD-CMP-008] [NEW]

#### Scenario: Mode shows tier and icon
- **WHEN** the session is in Auto
- **THEN** the control shows the Auto icon in the `moderate` tier with the text label "Auto" at full density

#### Scenario: Runtime notice
- **WHEN** the user switches mode during a running turn on a runtime with `liveModeChange: false`
- **THEN** a toast reads "Applies after this turn" and the control shows the pending mode with a clock marker

#### Scenario: Unsupported product mode
- **WHEN** the runtime's catalogue lists Ask with `supported: false`
- **THEN** the Ask row is dimmed with the runtime's reason and cannot be selected

#### Scenario: Unattended needs confirmation
- **WHEN** an admin selects the unattended mode of a workspace session
- **THEN** the dialog "Run without asking?" is shown and the mode changes only after "Run without asking"

### Requirement: Thinking control
The thinking control SHALL be shown only when the active model on the active runtime has more than one thinking option (`agent-runtimes.Thinking options`); with zero or one option it is absent. Its label is "Thinking" and its value the option's label; at condensed density the label is hidden. The list is searchable past 6 options on desktop and web and never searchable on compact. Selecting an option stores it on the device **per model** (`thinkingByModel[<runtimeId>/<providerId>/<modelId>]`) and applies it per `chat-agent.Live session controls`; the value shown afterwards is the effective option the runtime reports back. A draft pre-fills the remembered option of the selected model. [JAD JD-CMP-009] [NEW]

#### Scenario: Hidden for a single option
- **WHEN** the selected model exposes one thinking option
- **THEN** the thinking control is not rendered

#### Scenario: Remembered per model
- **WHEN** the user set "High" on model A, switches to model B and then selects model A in a new draft
- **THEN** the draft shows "High" for model A

#### Scenario: Effective value is shown
- **WHEN** the user picks "Max" and the runtime reads back "High"
- **THEN** the control shows "High"

### Requirement: Feature controls
The features of `agent-runtimes.Session features` SHALL render inline in the control row: a `toggle` as an icon button whose on state uses a status token with an icon change (never colour alone), and a `select` as an icon plus the current option with a dropdown. At condensed and tight density, and whenever more than three features exist, they collapse into one "Features" button showing the count of non-default values and opening a sheet with one row per feature (a switch for toggles, a select for selects, each with its description). Changing a feature stores the value on the device per runtime (`featureValues[featureId]`) and applies it per `chat-agent.Live session controls`. A runtime that publishes no feature shows no feature control. The same sheet carries the row "Generation models", which opens `orc-model-routing.Quick switch` for the session. [JAD JD-CMP-010] [NEW]

#### Scenario: Inline toggle
- **WHEN** the model supports fast mode and the row is at full density
- **THEN** a fast-mode control is shown inline and pressing it changes its icon and tone

#### Scenario: Collapse when narrow
- **WHEN** the composer width drops to the condensed density
- **THEN** the inline feature controls are replaced by one "Features" button that opens the sheet

#### Scenario: Runtime cannot set the feature
- **WHEN** the server answers `runtime/unsupported-capability`
- **THEN** an error toast reads "This runtime does not support <feature label>" and the control returns to its previous value

### Requirement: Skills control
The Skills control (sparkles icon, label "Skills", value "<n> skills" when any is attached) SHALL open the picker whose content is owned by `skills.Composer skill picker`; this requirement owns only its placement in the control row. Attachment is a multi-select per session that persists across turns and devices through `skills.Skills attached to a turn`; the picker stays open while toggling. A skill not available to the session's runtime is listed with its reason and, on admin devices, the one-press "Install for <runtime>" row; after installing, the attachment points at the installed copy. Only the attached skill ids travel with a send. The control is absent in drafts and when the host reports no skill support. [JAD JD-CMP-011] [NEW]

#### Scenario: Attach two skills
- **WHEN** the user toggles two skills in the picker
- **THEN** the control reads "2 skills", the picker is still open, and the same two skills are shown as attached when the session is opened on another device

#### Scenario: Install row
- **WHEN** an admin presses "Install for <runtime>" on a skill that is not visible to the session's runtime
- **THEN** the skill is installed for that runtime and becomes attached

#### Scenario: Draft has no Skills control
- **WHEN** the home composer is shown
- **THEN** no Skills control is rendered

### Requirement: Team mode control
The Team control (users icon) SHALL sit last in the control row and behave as defined by `multi-agent-orchestration.Team mode in the composer`: a one-shot arm held in memory only, which turns the next send into an ad-hoc team run with the session's agent as Lead and then disarms. This requirement owns only placement, the armed visual (filled icon in the accent colour plus the caption "Team" at full density) and the accessible name ("Team mode, armed" / "Team mode, off"). The control is shown in drafts and in live sessions when the Gateway advertises `multi-agent` and the runtime can use JAgentChill tools. [JAD JD-CMP-012] [NEW]

#### Scenario: Arm and send
- **WHEN** the user presses the Team control and sends "Make three alternative openings"
- **THEN** no normal turn starts, a team run is created with this session's agent as Lead, and the control is no longer armed

#### Scenario: Reload disarms
- **WHEN** the control is armed and the app is reloaded
- **THEN** the control is not armed

### Requirement: Autonomous control
The Autonomous control (infinity icon) SHALL sit before Team in live sessions and behave as defined by `multi-agent-orchestration.Autonomous control`: it starts or stops the autonomous run of the session's agent and shows live state. This requirement owns only placement and presentation: while a run is active the icon pulses at the `design-system` slow motion duration (static under reduced motion), the tooltip and the accessible name read "<n> turns · <m> done", and the control is absent when the host setting for autonomous runs is off or the Gateway does not advertise `multi-agent`. Spending is bounded by `generation-providers.Approval thresholds and spending caps`. [JAD JD-CMP-013] [NEW]

#### Scenario: Live counters
- **WHEN** an autonomous run has completed 12 turns and reported 5 done items
- **THEN** the control's tooltip reads "12 turns · 5 done"

#### Scenario: Feature off on the host
- **WHEN** the host setting for autonomous runs is off
- **THEN** the control is not rendered

#### Scenario: Wrong mode
- **WHEN** the session is in Ask
- **THEN** the control is dimmed with "Autonomous needs Edit or Auto mode"

### Requirement: Session share control
The session header SHALL contain a "Share" button (it is not part of the composer control row) that opens a "Share session" sheet. JAgentDesk shares a session with anonymous guests through tunnel links and join codes; JAgentChill never opens a public endpoint for a session (design D2, D7), so the same needs are met with paired devices. The sheet contains: (1) "Copy link" — the deep link of the session per `app-shell-navigation.Deep links and file types`, usable only on devices paired with this host; (2) "Invite a device" — starts `device-pairing-signing.Pairing offer format` with the role preselected from five switches that map JAgentDesk's guest permissions onto roles: "Watch only" (on by default → role `viewer`), "Send messages" (→ role `editor`), and three read-only indicators of what the chosen role can see in this session — files and diffs, terminals, project artifacts — derived from `workspaces-terminal.Role and permission matrix`; an invitation shows its verification code with a countdown to expiry and an expired style afterwards; (3) "Watching now" — the devices that currently have the session open, from `cross-device-sync.Presence`, each with name, role and "Remove device" (admin; opens the revoke confirmation of `device-pairing-signing.Revocation`), or "No one else is watching." when empty; (4) "Stop sharing" — revokes every device paired through this sheet for this session after a confirmation listing them. A pairing request raised from this sheet surfaces on admin devices as the dialog "A device wants to join" with "Reject" and "Accept". Several invitations can be pending at once (bounded by the pairing limits). Sharing is pairing-based only: no tunnel link, public URL, guest account or join code exists, an unpaired browser that opens a copied link reaches the pairing screen, and every participant is a paired device with role `viewer` or `editor`. For a workspace-class session the read rule of `chat-agent.Agent sessions run on Gateway sessions` applies to invited devices as to any other: a workspace-class session is `private`, so only its owner and `admin` devices can open it — "Watch only" and "Send messages" are disabled with "Only admin devices can open a workspace session", and the sheet offers pairing with role `admin` through `device-pairing-signing.Pairing offer format` instead. A creative-class session set to `access: "private"` shows "Only you and admin devices can open this session" with the switch "Visible to every paired device" (`jagentchill.session.access.set`, owner or admin). The button is shown to `admin` devices; other roles see only "Copy link". [JAD JD-CMP-014] [NEW]

#### Scenario: Invite a viewer
- **WHEN** an admin opens the sheet, leaves "Watch only" on and presses "Invite a device"
- **THEN** a pairing offer with role `viewer` is shown with a verification code and a countdown

#### Scenario: Join approval
- **WHEN** the invited device submits the code
- **THEN** admin devices show "A device wants to join" with "Reject" and "Accept", and the device joins only after "Accept"

#### Scenario: Remove a watching device
- **WHEN** the admin presses "Remove device" on a row and confirms
- **THEN** that device is revoked and disappears from "Watching now" within 2 s

#### Scenario: No public link
- **WHEN** a link copied from the sheet is opened in a browser that is not paired with the Gateway
- **THEN** no session content is served and the web app shows the pairing screen

#### Scenario: Editor device
- **WHEN** a device with role `editor` opens the sheet
- **THEN** only "Copy link" and the read-only "Watching now" list are shown

#### Scenario: Sharing a workspace session
- **WHEN** an admin opens the sheet on a workspace-class session
- **THEN** "Watch only" and "Send messages" are disabled with "Only admin devices can open a workspace session"

### Requirement: Remembered composer preferences
The app SHALL remember composer choices **per device and per runtime-and-provider**, never per workspace or per session, in device-local storage: `{lastRef {runtimeId, providerId, modelId}, byProvider: {<runtimeId>/<providerId>: {modelId?, modeId?, thinkingByModel {<modelId>: optionId}, featureValues {<featureId>: value}}}, favoriteModels[], recentModels[] (≤ 5), isolation?: "local" | "worktree", defaultSend, lastTarget}`. Every change made in a draft or mid-conversation (model, mode, thinking, feature) updates the entry of the runtime-and-provider in use and seeds the next draft **when the user manually picks that runtime**; a remembered value never overrides an ORC default (`agent-runtimes.Per-role defaults through ORC`) for a new session that the user did not configure, and a remembered value that is no longer offered is ignored. Not remembered: the unattended mode, Team arming (memory only) and attached skills (per session on the host). `isolation` pre-selects local directory or worktree in workspace drafts. Preferences are removed with "Reset composer preferences" in `settings-preferences.Composer and agent personal preferences`. [JAD JD-CMP-015] [NEW]

#### Scenario: Next draft is seeded
- **WHEN** the user changes the mode to Plan in a session on provider X and then opens a new draft and picks provider X
- **THEN** the draft shows Plan and the model last used with provider X

#### Scenario: Another provider keeps its own memory
- **WHEN** the user then picks provider Y in the same draft
- **THEN** the draft shows provider Y's own remembered model, mode and features

#### Scenario: Unattended is never remembered
- **WHEN** the last session on a runtime ran unattended
- **THEN** a new draft on that runtime starts in the runtime's default mode

#### Scenario: Not synced
- **WHEN** the user opens the app on another device
- **THEN** that device shows its own remembered values

### Requirement: Control row densities
The control row SHALL choose one of three densities from its measured width, with 12 px of hysteresis so that a width oscillating around a threshold does not flicker: `full` (≥ 560 px: labels and carets on every control), `condensed` (400–559 px: no carets, thinking label hidden, features collapsed into the "Features" button) and `tight` (< 400 px: additionally the mode label hidden, icons only). Moving from a denser to a sparser level requires the width to exceed the threshold by 12 px. The compact form factor always starts at `tight` and uses `chat-agent.Compact composer sheet` in place of popovers. Controls never wrap onto a second line and never truncate an icon; when even `tight` does not fit, Skills, Autonomous and Team move into the "+" menu in that order. [JAD JD-CMP-016] [NEW]

#### Scenario: Three levels
- **WHEN** the row is 600 px, then 480 px, then 380 px wide
- **THEN** it renders at `full`, `condensed` and `tight` respectively

#### Scenario: Hysteresis
- **WHEN** the row at `condensed` grows from 555 px to 565 px
- **THEN** it stays `condensed`, and it becomes `full` only at 572 px or more

#### Scenario: Overflow
- **WHEN** the row is 300 px wide
- **THEN** Skills, Autonomous and Team are offered in the "+" menu and no control wraps

### Requirement: Compact composer sheet
On the compact form factor the model control SHALL open one full-height bottom sheet titled "Agent settings" that combines the model browser of `chat-agent.Model browser` at the top with, below it, one row each for thinking, mode and every feature of the selected model, each row opening its options in place. The sheet applies each change immediately (no "Apply" button), keeps itself open after a model selection so that thinking and mode can be adjusted for the new model, and closes with a drag-down or "Done". Rows are at least 48 pt tall. Team, Autonomous and Skills keep their own buttons in the row while it fits, per `chat-agent.Control row densities`. [JAD JD-CMP-017] [NEW]

#### Scenario: One sheet for model, thinking and mode
- **WHEN** the user taps the model control on a phone
- **THEN** a full-height sheet shows the model browser followed by Thinking, Mode and feature rows

#### Scenario: Sheet stays open after picking a model
- **WHEN** the user selects another model in the sheet
- **THEN** the sheet stays open and the Thinking row shows the new model's options

### Requirement: Composer modes
A session SHALL have exactly one of four product modes, with ids `ask`, `plan`, `edit` and `auto` and labels "Ask", "Plan", "Edit" and "Auto"; `edit` is the default. `ask`: the agent can call read-only tools only and makes no change. `plan`: read-only tools; the agent produces a plan card that needs approval before any write tool runs (`chat-agent.Plan approval`). `edit`: write tools stage proposals that the user accepts or rejects, and costed work above the per-call approval threshold needs approval. `auto`: valid project proposals are accepted automatically and costed work is approved automatically within the session budget (a proposal on a workflow is accepted automatically only within the limits of `agent-workflows.Proposal and diff for agent edits`); the mode control carries the marker "unattended proposals" in the warning tone. The thresholds and budgets are those of `generation-providers.Approval thresholds and spending caps`, enforced in the tool path by `agent-editing-tools.Cost guard`. The mode gates apply to every tool family of the catalogue of `agent-editing-tools.Tool naming and families`. The mapping of each product mode onto a runtime's permission mode and native modes, and which modes a runtime supports, is `agent-runtimes.Runtime modes catalogue`; `auto` is not an unattended mode, and the runtime-level no-prompt mode exists only as defined by `agent-runtimes.Unattended modes and their warning`. The mode is stored per session and changeable between turns and during a turn (`chat-agent.Live session controls`). The default for new sessions is a personal preference offering Ask, Plan, Edit, Auto and "Last used" (initially Edit); the host "default agent mode" offers Ask, Plan and Edit and never Auto. [JAD] [NEW]

#### Scenario: Ask mode blocks writes
- **WHEN** the session is in `ask` mode and the user says "delete the first clip"
- **THEN** no write tool is executed
- **AND** the agent's reply offers to switch mode, rendered with a "Switch to Edit" button

#### Scenario: Auto mode accepts proposals
- **WHEN** the session is in `auto` mode and the agent submits a valid proposal
- **THEN** the proposal is applied without a user action and its card shows "Applied automatically" with a "Revert this change" button

#### Scenario: Mode change mid-turn
- **WHEN** the user switches from `auto` to `edit` while a turn is running on a runtime with `liveModeChange: true`
- **THEN** the next proposal submitted in that turn waits for acceptance

#### Scenario: Host default never Auto
- **WHEN** an admin opens the host "default agent mode" setting
- **THEN** the options are Ask, Plan and Edit

### Requirement: Live session controls
Changing the model, mode, thinking option or a feature of a live session SHALL use the runtime-side contract of `agent-runtimes.Session control application` (`jagentchill.session.control.set`) and SHALL present the result as follows. The control shows a pending state until the response arrives (at most 3 s) and then the **effective** values the runtime read back — the stored mode is the runtime's read-back mode and the stored thinking option is the runtime's effective option, even when they differ from the request. Selecting "Default model" sends `ref: null` and shows the runtime's default model. Every accepted change is re-broadcast and appears on every device viewing the session within 1 s, and appends a status line ("Model changed to <model>", "Mode changed to <mode>", "Thinking set to <option>"). Each `notices[]` entry is shown as a toast with the runtime's text — in particular `applies-next-turn` ("Applies to the next message") and "Applies after this turn". A refused or failed change restores the previous value and shows an error toast with the reason; `runtime/unsupported-capability` reads "This runtime does not support <feature label>". Options reset by a model change (`resetFeatures[]`) are listed in one toast "Reset: <labels>". None of these changes cancels a running turn. A mode change during a running turn that the runtime cannot apply live is shown as pending and applied before the next turn. [JAD JD-MID-001, JD-MID-002, JD-MID-003, JD-MID-004, JD-MID-005] [NEW]

#### Scenario: Model change is broadcast
- **WHEN** the user selects another model of the same runtime on the desktop
- **THEN** the desktop control shows the new model after the response and the phone shows it within 1 s
- **AND** the status line "Model changed to <model>" is appended

#### Scenario: Default model
- **WHEN** the user selects "Default model"
- **THEN** the request carries `ref: null` and the control shows the runtime's default model label

#### Scenario: Read-back mode differs
- **WHEN** the user requests Plan and the runtime reports that it is in its native read-only mode
- **THEN** the control shows the mode the runtime reported

#### Scenario: Applies next turn
- **WHEN** a model change is made during a running turn and the response carries the notice `applies-next-turn`
- **THEN** a toast reads "Applies to the next message" and the running turn is not cancelled

#### Scenario: Feature not supported
- **WHEN** a feature change fails with `runtime/unsupported-capability`
- **THEN** the control returns to its previous value and the toast names the feature

### Requirement: Switch runtime or provider mid-conversation
Selecting, in a live session, a model that belongs to another runtime SHALL run `agent-runtimes.Switch runtime operation`; selecting another provider inside the built-in runtime is a plain model change with the full transcript kept. This requirement owns the presentation. Before a switch that crosses runtimes the app shows the confirmation of `agent-runtimes.Switch notices and limits` ("Switch runtime?", what is kept, what resets, "Don't ask again on this device"); when the product mode cannot be kept, the dialog names the mode the session will take and requires the explicit choice the operation demands. On confirmation: a running turn is cancelled first and its permission and question cards are shown as cancelled; the session keeps its id, title, displayed timeline, tags, folder, pin, project and workspace binding, queued messages and usage totals; mode, thinking and features show the target's defaults. The app then shows the toast "Runtime switched — your chat context carries over to the next message.", the status line "Switched from <old> to <new>", and the reset notices. The prior conversation travels as the durable hand-over of `agent-runtimes.Durable history hand-over`; the first message after the switch shows a collapsed chip "Chat history (<n> items)" and the session menu offers "View carried context". Rows before the switch show no rewind, edit-and-resend or re-run action when the target has its own native context. The device remembers the selected model for the target runtime (`chat-agent.Remembered composer preferences`). A switch refused by policy, readiness or rate limit leaves the session unchanged and shows the returned reason. [JAD JD-MID-006, JD-MID-007, JD-MID-008] [NEW]

#### Scenario: Switch keeps the session
- **WHEN** the user confirms a switch from the built-in runtime to a CLI runtime in an idle session
- **THEN** the session id, title, timeline, tags and usage totals are unchanged and the controls show the CLI runtime's default mode and thinking option
- **AND** the toast "Runtime switched — your chat context carries over to the next message." is shown

#### Scenario: Running turn is cancelled first
- **WHEN** the switch is confirmed while a turn is running
- **THEN** the turn ends with the status line "Stopped", its pending permission card reads "Cancelled", and only then does the switch status line appear

#### Scenario: Carried context is visible
- **WHEN** the user sends the first message after the switch
- **THEN** the message row shows the chip "Chat history (<n> items)" and the hand-over is marked delivered once the runtime acknowledges the turn

#### Scenario: Context survives a restart
- **WHEN** the Gateway restarts after a switch and before the next message
- **THEN** the next message still carries the hand-over

#### Scenario: Provider change inside the built-in runtime
- **WHEN** the user selects a model of another direct provider while the session runs on the built-in runtime
- **THEN** no confirmation dialog is shown, no hand-over chip appears and earlier rows keep their rewind actions

### Requirement: Attachment types
The composer SHALL accept these attachment kinds, each rendered as a removable chip with an icon or 32 px thumbnail and a label: `project` (a project reference), `media` (an asset from the media library, or a new file that is first imported), `timeline-range` (a time range of a scene, optionally restricted to tracks), `frame-snapshot` (a rendered frame at a time), `element` (one or more selected timeline elements), `file` (document: txt, md, pdf, docx, srt, vtt, ass, json, csv, `.jagentchill` project bundle), `image` (png, jpeg, webp, gif, heic), `session` (another session), `text` (pasted text longer than 2,000 characters, auto-converted into a chip named "Pasted text"), `script` (a script or a selection of its scenes from `script-studio`, sent as structured text with its version id), `workflow` (a workflow or a run of `agent-workflows`, sent as its plan summary and node states), `review` (the review attachment of `workspaces-terminal.Review comments attached to a chat turn`), `forge-context` (a pull request, merge request or issue per `workspaces-terminal.Pull-request and issue context attachments`), `chat-history` (the curated history of a fork or a runtime switch) and `workspace-file` (a path of the session's workspace, sent by reference). Attachments are added through the "+" menu, drag and drop onto the composer, paste, the @-mention popover, the editor context menu action "Send to agent", and the "Add to chat" actions of the owning surfaces. Kinds the selected runtime or model cannot take are refused at attach time per `agent-runtimes.Behaviour when a runtime lacks a capability`. `review`, `forge-context` and `workspace-file` exist only in workspace-class sessions. Content of `file`, `text`, `forge-context`, `review` and `session` attachments is untrusted data under `agent-editing-tools.Untrusted content handling`. [JAD] [NEW]

#### Scenario: Paste an image
- **WHEN** the user pastes an image from the clipboard
- **THEN** an image chip with a thumbnail appears and upload starts

#### Scenario: Large paste becomes a chip
- **WHEN** the user pastes 5,000 characters of script text
- **THEN** a "Pasted text" chip is created and the input keeps its previous content

#### Scenario: Attach a script
- **WHEN** the user picks a script under "Scripts" in the mention popover
- **THEN** a script chip with its title and version is added and the sent message carries the script's structured text

#### Scenario: Review attachment
- **WHEN** the user presses "Add to chat" on a review draft of 4 comments in a workspace session
- **THEN** one `review` chip "Review (4)" is added to that session's composer

#### Scenario: Runtime accepts images only
- **WHEN** the user drops a PDF onto the composer of a session whose runtime accepts images only
- **THEN** no chip is created and the notice "<runtime> accepts images only" is shown

#### Scenario: Unsupported file
- **WHEN** the user drops an `.exe` file on the composer
- **THEN** no chip is created and a toast reads "This file type is not supported"

### Requirement: Attachment limits and upload
A message SHALL carry at most 20 attachments. Size limits: image 20 MiB, document 50 MiB, text 1 MiB; new media files have no chat limit because they are imported through the media library and referenced by asset id. Bytes SHALL travel as content-addressed blobs over the signed chunked routes of `cross-device-sync.Chunked resumable upload` (4 MiB chunks, resumable) and the message references them by blob id; the attachment record is registered with `jagentchill.chat.attachment.create` on channel P. Per-chip progress is a ring. Sending SHALL be blocked until all uploads complete. A failed upload shows a danger-coloured chip with "Retry". Uploaded attachments not referenced by a sent message are garbage-collected after 24 h. [JAD] [NEW]

#### Scenario: Send waits for uploads
- **WHEN** a 40 MiB document is at 60% upload and the user presses the send key
- **THEN** the message is not sent and the send button shows a spinner with the tooltip "Uploading 1 file"

#### Scenario: Over the count limit
- **WHEN** the user adds a twenty-first attachment
- **THEN** the attachment is refused with the toast "Up to 20 attachments per message"

#### Scenario: Resume after disconnect
- **WHEN** the connection drops at 12 MiB of a 40 MiB upload and returns
- **THEN** the upload continues from the last acknowledged 4 MiB chunk

#### Scenario: Oversized image
- **WHEN** the user attaches a 25 MiB image
- **THEN** the chip is refused with "Images can be up to 20 MB"

### Requirement: Timeline-range and frame-snapshot attachments
In an editor, the user SHALL be able to attach the current selection range or in/out range as a `timeline-range` attachment `{projectId, sceneId, start, end, trackIds?}` in ticks (120,000 ticks per second), and the frame under the playhead as a `frame-snapshot` attachment `{projectId, sceneId, time, imageBlobId, width, height}` rendered at the preview resolution capped at 1280 px on the long edge. The chip label SHALL show timecodes in the project's timecode format, for example "00:12.10 – 00:18.00" or "Frame 00:07.15". The agent receives the range as structured data and the snapshot as an image. The actions are `chat.attach-range` and `chat.attach-frame`; their default bindings are stated only in `keyboard-shortcuts.Default bindings for project, application, session and lists`. On mobile both are items in the composer "+" sheet. [NEW]

#### Scenario: Attach the playhead frame
- **WHEN** the playhead is at 7.5 s in a 30 fps project and the user runs `chat.attach-frame`
- **THEN** a chip "Frame 00:07.15" with a thumbnail is added
- **AND** the sent message contains an image whose long edge is at most 1280 px

#### Scenario: No range selected
- **WHEN** the user chooses "Attach timeline range" with no selection and no in/out range
- **THEN** the range defaults to the visible timeline viewport and the chip shows that range

### Requirement: At-mentions
Typing `@` in the composer SHALL open a popover with categories, each with an icon, title and one-line description: Projects, Media, Scenes, Timeline elements, Sessions, Scripts, Skills, Personas, Agents (members of the session's agent tree), Workflows, Films, Characters, Locations, Props, Templates, Files (workspace sessions) and Secrets (names only — a secret mention inserts the name of a host secret and never its value). Selecting a category opens a searchable list (filter as you type, 50 rows per page, results within 200 ms); selecting an entity inserts an inline chip and adds a matching attachment or directive. Keyboard: arrow keys move, Enter selects, Escape closes, Backspace on an empty query returns to the categories. `@` followed directly by characters searches across all categories. A persona or agent mention routes that message to a sub-agent of that persona, or to that agent, under the rules of `multi-agent-orchestration.Mentions that wake agents`. When nothing matches, the popover shows "No matches" and Enter inserts nothing. Categories that need a scope the device lacks are omitted. [JAD] [NEW]

#### Scenario: Mention a media asset
- **WHEN** the user types `@beach` and selects "beach_drone.mp4" under Media
- **THEN** an inline chip "beach_drone.mp4" is inserted and the message carries a `media` attachment with that asset id

#### Scenario: Mention with no match
- **WHEN** the query matches nothing
- **THEN** the popover shows "No matches" and pressing Enter leaves the input unchanged

#### Scenario: Secret mention carries a name only
- **WHEN** the user selects the secret `FREESOUND_API_KEY`
- **THEN** the chip shows the name and the sent message contains the name and no secret value

### Requirement: Slash commands
Typing `/` at the start of the input SHALL open a command list filtered by typed characters. Built-in commands: `/new` (new session), `/mode <ask|plan|edit|auto>`, `/persona <id>`, `/model` (open the model browser), `/attach` (open attach menu), `/snapshot` (attach playhead frame), `/range` (attach timeline range), `/undo` (revert the last accepted proposal), `/stop` (stop the turn), `/compact` (compact context), `/fork`, `/rewind`, `/import` (open the import sheet), `/usage` (open session insights), `/export <preset id>` (start an export of the bound project with a preset id of `export-share.Built-in export presets`), `/workflow <prompt>` and `/film <story>` (`chat-agent.Composer targets`), `/script <prompt>` (ask the Screenwriter for a script proposal in `script-studio`), `/loop` (open the loop dialog of `multi-agent-orchestration.Worker and verifier loops`), the team commands of `multi-agent-orchestration.Team slash commands`, and `/help`. Skills enabled for the persona that declare a command SHALL be listed after the built-ins with a "Skill" badge. Commands that the client executes locally MUST NOT be sent to the model. **Out-of-band commands** — `/mode`, `/model`, `/attach`, `/snapshot`, `/range`, `/usage`, `/help`, `/import`, `/new`, `/fork` — SHALL run while a turn is active without interrupting, steering or queueing behind it; `/stop` acts on the turn itself; every other command follows the send behaviour of `chat-agent.Steer, queue and interrupt while running`. An unknown command is sent as plain text. [JAD JD-MID-018] [NEW]

#### Scenario: Switch mode by command
- **WHEN** the user submits `/mode plan`
- **THEN** the mode control shows "Plan", a status line "Mode changed to Plan" is appended, and no agent turn starts

#### Scenario: Out-of-band command during a turn
- **WHEN** a turn is running and the user submits `/usage`
- **THEN** session insights open, the running turn continues uninterrupted and no message is queued

#### Scenario: Undo by command
- **WHEN** the user submits `/undo` after a proposal was accepted
- **THEN** the proposal's changes are reverted in the project and its card shows "Reverted"

#### Scenario: Command needs a project
- **WHEN** `/export 1080p` is submitted in a session with no bound project
- **THEN** an inline error reads "Attach a project first" and nothing is exported

### Requirement: Steer, queue and interrupt while running
While a turn is running the composer SHALL stay enabled, and what the send key does SHALL follow the personal setting "Default send" with three options: **Steer** (default) — the send key steers the live turn without interrupting it; **Interrupt** — the send key interrupts and the alternate send queues; **Queue** — the send key queues and the alternate send submits as a steer. The alternate send is the action `session.send-alternate` and the split chevron on the send button always offers all three explicitly ("Steer now", "Interrupt and send", "Send after this turn"). The message is sent with `jagentchill.chat.send {…, queueMode, expectedRunId}` (`chat-agent.Message send idempotency and optimistic echo`), where `expectedRunId` is the id of the turn that was active when the user pressed send. The server — not the client — resolves and guards the delivery, in one handler: (a) it resolves the effective queue mode per runtime by `agent-runtimes.Steer support contract`: a steer on a runtime that cannot steer is delivered as a follow-up, the chip reads "Will send after this turn" and the hint "<runtime> cannot take messages mid-turn" is shown; (b) for an effective `steer` it compares `expectedRunId` with the session's active run id, which it tracks from the relayed Gateway events, immediately before calling the Gateway's `chat.send {queueMode: "steer"}`; when they differ nothing is sent, the response is `{delivered: false, effective: "none", reason: "turn-changed"}` and the composer shows "The agent's turn changed before your message arrived" with the text restored; (c) when the expected turn is still active and the Gateway refuses the steer, the server falls back to interrupt-and-replace for that same turn. The Gateway has no conditional send, so one race remains and is accepted: a steer that passes check (b) and reaches the Gateway after the turn ended starts a new turn; the server sees that the run which consumed the message is not `expectedRunId` and marks the user row "Sent as a new message".

Messages waiting for delivery SHALL be shown in a **queue track** above the input. The items are the Gateway's pending inputs of the session: the server reads them over its gateway link (`chat.history` `pendingInputs`, each with its own `runId` and `state`), keeps the full text and attachment references of each queued message it relayed, publishes every change as the stream event `queue_changed {items[] {queueItemId, preview (first 160 characters), attachmentCount, deviceId, created_ms}}` and answers `jagentchill.chat.queue.list {sessionKey}` (scope `jagentchill.projects.read`, read rule) with the same list; `queueItemId` is the pending input's `runId`. Each item is a two-line preview with "Remove" (`jagentchill.chat.queue.remove {sessionKey, queueItemId}`, scope `jagentchill.agent.use` and the act rule, which the server applies as `chat.abort {sessionKey, runId: <queueItemId>}`), "Edit" (remove, then the stored text and attachments are returned in the response and placed in the input) and "Send now" (remove, then the message is sent again as an interrupt; when that send fails the text is restored into the input with an error toast — the Gateway queue has no insert-at-head operation). At most 10 messages can be queued per session; the server enforces the limit before the Gateway call (`QUOTA_EXCEEDED`). Queued follow-ups are held by the Gateway, are visible on every device that can read the session, survive reconnects, and drain one at a time in order when the turn ends. Per-item removal of a pending input rests on spike S11; when S11 shows that a pending input cannot be aborted individually, "Edit", "Remove" and "Send now" are absent and the track offers only "Clear queue" (`jagentchill.chat.abort {sessionKey, clearQueued: true}`). [JAD JD-MID-009, JD-MID-010, JD-MID-011] [NEW]

#### Scenario: Steering during a tool call
- **WHEN** "Default send" is Steer, the agent is running a 40 s generation tool and the user sends "use a warmer colour grade"
- **THEN** the tool call finishes, the message appears in the timeline after the tool result, and the agent's next step takes it into account

#### Scenario: Runtime cannot steer
- **WHEN** the same message is sent in a session on a runtime with `steer: false`
- **THEN** a queued chip "Will send after this turn" appears with the runtime hint and the message starts a turn when the running one ends

#### Scenario: Interrupt setting
- **WHEN** "Default send" is Interrupt and the user presses the send key during a turn
- **THEN** the running turn ends with the status line "Stopped" and the new message starts a turn
- **AND** the alternate send would have queued the message instead

#### Scenario: Turn changed before the steer arrived
- **WHEN** the active turn ends and another begins before the server handles a steer carrying the first turn's `expectedRunId`
- **THEN** the server sends nothing to the Gateway, the response is `{delivered: false, reason: "turn-changed"}`, the text is restored to the input and the stated notice is shown

#### Scenario: Steer arrives just after the turn ended
- **WHEN** a steer passes the expected-turn check and the turn ends before the Gateway delivers it
- **THEN** the message starts a new turn and its row is labelled "Sent as a new message"

#### Scenario: Remove a queued message
- **WHEN** the user presses "Remove" on the second of three queued messages
- **THEN** the server aborts that pending input by its run id, the other two keep their order, and every device viewing the session shows two items within 1 s

#### Scenario: Send now fails
- **WHEN** the user presses "Send now" on a queued message and the send fails
- **THEN** the message text is back in the input and an error toast is shown

#### Scenario: Queue limit
- **WHEN** 10 messages are queued and the user sends another
- **THEN** the call fails with `QUOTA_EXCEEDED`, the message is not queued and a toast reads "10 messages are already waiting"

### Requirement: Stop a running turn
While a turn runs, the send button SHALL become a stop button (accessible name "Stop agent", tooltip "Interrupt") when the input is empty. Pressing it, running the action `chat.stop`, or `/stop` SHALL call `jagentchill.chat.abort {sessionKey, runId}` (scope `jagentchill.agent.use` and the act rule of `chat-agent.Agent sessions run on Gateway sessions`), which the server applies over its gateway link as the Gateway's `chat.abort` for that run. The button then shows the pending state "Stopping…" (accessible name "Cancelling agent") and the session keeps the status `running` until the runtime acknowledges: cancellation is reflected in the timeline and the session state only after that acknowledgement, and a cancellation the runtime rejects leaves the turn running with the toast "The agent did not stop". After 10 s without acknowledgement the app shows "Still stopping…" with a "Force stop" action that calls `jagentchill.chat.abort {sessionKey, force: true, clearQueued: true}` (the server applies `sessions.abort {clearQueued: true}`). A stopped turn keeps its partial output and marks running tool calls as `cancelled`. There is one rule for a proposal the stopped turn left `open`, and its owner is `agent-editing-tools.Proposal staging`: an `open` proposal that holds changes is submitted automatically and its card appears; an `open` proposal with no change is discarded; proposals already submitted stay pending. (Archiving a session keeps its own rule and cancels unresolved proposals, `chat-agent.Session archive and restore`.) Generation jobs already queued by the turn SHALL be cancelled unless the job is at or past 90% progress. Queued follow-ups are kept unless "Force stop" was used. [JAD JD-MID-012] [NEW]

#### Scenario: Stop during streaming text
- **WHEN** the user presses stop while assistant text streams
- **THEN** the button shows "Stopping…", and after the runtime acknowledges (within 2 s on the built-in runtime) the partial text remains and a status line "Stopped" is shown

#### Scenario: State changes only on acknowledgement
- **WHEN** the user presses stop and the runtime has not yet acknowledged
- **THEN** the session row still reads "Working" and no "Stopped" line exists

#### Scenario: Rejected interrupt
- **WHEN** the runtime rejects the cancellation
- **THEN** the turn keeps running, the stop button returns to its normal state and the toast "The agent did not stop" is shown

#### Scenario: Stop while a proposal is pending
- **WHEN** a submitted proposal is awaiting acceptance and the user stops the next turn
- **THEN** the proposal card remains actionable

#### Scenario: Stop after the agent staged changes
- **WHEN** the user stops a turn whose `open` proposal already holds 3 staged changes
- **THEN** the proposal is submitted with a generated title, its card appears with 3 changes, and nothing was discarded

#### Scenario: Stop before anything was staged
- **WHEN** the user stops a turn whose `open` proposal holds no change
- **THEN** the proposal is discarded and no card appears

### Requirement: Composer drafts
The composer SHALL save a draft (text, attachments, mentions, mode) per session and one for the home composer, locally on the device, debounced by 500 ms, and restore it when the session is reopened or the app restarts. A draft is cleared when its message is sent successfully. Drafts are device-local and are not synced. A session row with a non-empty draft SHALL show "Draft" in the meta line. Drafts older than 30 days are removed. [JAD]

#### Scenario: Draft restored after restart
- **WHEN** the user types a message with one attachment, quits the app and reopens the session
- **THEN** the text and the attachment chip are present

#### Scenario: Draft cleared on send
- **WHEN** the message is sent and acknowledged
- **THEN** the draft is empty and the row no longer shows "Draft"

### Requirement: Message send idempotency and optimistic echo
A message SHALL be sent with `jagentchill.chat.send {sessionKey, clientMessageId, text, attachments[], mentions[]?, queueMode?: "steer" | "followup" | "interrupt", expectedRunId?}` (scope `jagentchill.agent.use` and the act rule of `chat-agent.Agent sessions run on Gateway sessions`) → `{accepted, runId?, delivered, effective, downgradedFrom?, reason?}`. After its checks the server applies pending control changes, prepends a staged hand-over (`agent-runtimes.Durable history hand-over`), resolves attached skills (`skills.Skills attached to a turn`), records the turn's initiator, and calls the Gateway's `chat.send` over its gateway link with `clientMessageId` as the Gateway idempotency key. The message SHALL be shown immediately in a pending style (60% opacity) and reconciled with the canonical `user_message` row carrying the same `clientMessageId`. A message not acknowledged within 15 s SHALL show "Not sent" with "Retry"; retry reuses the same `clientMessageId`. The canonical timeline MUST never contain two user messages with the same `clientMessageId`. A send refused by policy (class, runtime disabled, budget, concurrency) returns the error of the failed check and creates no row. [JAD] [NEW]

#### Scenario: Reconcile optimistic message
- **WHEN** the canonical row for a pending message arrives
- **THEN** the pending bubble is replaced in place without a visual jump and shows full opacity

#### Scenario: Retry does not duplicate
- **WHEN** the acknowledgement is lost and the user presses "Retry"
- **THEN** the timeline shows the message once

#### Scenario: Send refused before the Gateway
- **WHEN** a message is sent to a session whose runtime was disabled by an admin
- **THEN** the call fails with `runtime/disabled`, no Gateway `chat.send` was made, and the pending bubble shows "Not sent"

### Requirement: Composer keyboard behaviour
The composer SHALL expose these actions by id only; this capability states their meaning and no key, and every default binding, context and precedence rule is owned by `keyboard-shortcuts.Default bindings for project, application, session and lists` and `keyboard-shortcuts.Action registry`: `session.send` (send), `session.send-alternate` (the alternate send of `chat-agent.Steer, queue and interrupt while running`), `session.newline` (insert a newline), `session.recall-previous` (with an empty input, load the previous user message for editing as a new message), `chat.focus-composer` (focus the composer of the foreground screen, opening the editor agent panel when it is collapsed), `chat.mode.cycle` (next composer mode the runtime supports), `chat.stop` (stop the running turn), `chat.dictation.toggle`, `chat.attach-range`, `chat.attach-frame`, `chat.find` (`chat-agent.Find in chat`), `session.tab.next` and `session.tab.previous` (`chat-agent.Workspace tab strip and new-tab page`) and `session.workspace.toggle` (`chat-agent.Session split view`). Escape closes an open popover of the composer before anything else; this is fixed composer behaviour and not an action of the registry (`keyboard-shortcuts.Default bindings for project, application, session and lists`). A personal preference "Send key inserts a newline" swaps `session.send` and `session.newline`. During IME composition the send key MUST NOT send. On mobile the keyboard return key inserts a newline and sending is done with the send button. [JAD] [NEW]

#### Scenario: IME composition
- **WHEN** the user confirms a Japanese IME candidate with the send key
- **THEN** the candidate is committed and the message is not sent

#### Scenario: Mobile return key
- **WHEN** the user taps the return key on a phone
- **THEN** a newline is inserted and no message is sent

#### Scenario: Rebound action
- **WHEN** the user rebinds `chat.focus-composer` in the shortcut settings
- **THEN** the new binding focuses the composer and the old one does not

### Requirement: Persona picker
The session header SHALL show the persona of the session as a chip that opens a picker listing the personas of `chat-agent.Default agent personas` plus user-defined agents, each with its glyph, name, one-line description and agent class. Changing the persona between turns (`jagentchill.session.update {patch: {agentId}}`; the server re-checks the class rule of `chat-agent.Agent sessions run on Gateway sessions` for the new agent before applying it) switches the session's agent for subsequent turns, re-resolves runtime and model from `agent-runtimes.Per-role defaults through ORC` unless the user picked a model explicitly in this session, and appends a status line "Persona changed to <name>". Changing the persona during a running turn is refused with "Stop the agent to change persona". A persona whose agent class the device cannot select is dimmed with "Admin devices only". Model choice for the agent itself is made in `chat-agent.Model browser`; models for generation roles are chosen in `orc-model-routing.Quick switch`, reached from the "Features" sheet. [JAD] [NEW]

#### Scenario: Switch persona
- **WHEN** the user picks "Editor" in a Director session
- **THEN** the status line "Persona changed to Editor" is appended and the next turn runs on `jagentchill-editor`

#### Scenario: Explicit model is kept
- **WHEN** the user had picked a model in this session and then changes persona
- **THEN** the session keeps that model

#### Scenario: Persona change during a turn
- **WHEN** a turn is running
- **THEN** the picker rows are disabled with "Stop the agent to change persona"

### Requirement: Stream event envelope with seq and epoch
A session's activity SHALL reach clients on one path: the targeted event `jagentchill.chat.stream` on the stream `chat:<sessionId>` of channel P, with payload `{sessionId, event, timestamp_ms, seq?, epoch?, rowId?, deltaIndex?}` under the envelope rules of `server-api.Event delivery` and the transport guarantees of `server-api.Agent stream events and gap recovery` (persist before send, order, coalescing, back-pressure; targeted, subscribed connections that pass the read rule only, no replay — the pull method is `jagentchill.chat.timeline.fetch`). The server subscribes to the session over its gateway link, receives the Gateway events (`agent`, `session.message`, `session.tool`) and produces three classes of stream event. **Row events** (`row_added`, `row_updated`): the server normalises Gateway events into ordered timeline rows, persists them, and sends each row change with `seq` and `epoch`; `seq` is a positive integer that increases by exactly 1 for every canonical timeline row change of a session, and `epoch` is an opaque string identifying one continuous numbering that changes only when the timeline is rebuilt (rewind, restore from backup, transcript repair, import replay). **Text deltas** (`text_delta {rowId, deltaIndex, text}`): token-level text of an in-progress assistant or reasoning row, relayed as the runtime emits it, coalesced by the server to at most one event per row per 50 ms, numbered per row from 0 by `deltaIndex`, not persisted and carrying no `seq`; the row's `row_updated` events carry the accumulated `text` and `nextDeltaIndex`, so the canonical row always supersedes its deltas. **Non-timeline events** (`turn_started {runId}`, `turn_completed`, `turn_failed`, `turn_cancelled`, `usage_updated`, `control_changed`, `permission_requested`, `permission_resolved`, `plan_requested`, `plan_resolved`, `question_requested`, `question_resolved`, `queue_changed`, `attention_required`, `agent_tree_changed`) carry no `seq`. On the SSE fallback of `server-api.SSE and signed HTTP fallback` the same three classes are delivered. Delta fidelity per runtime is part of spike S21; a runtime whose deltas cannot be relayed delivers text at row granularity and its matrix cell says so. [JAD] [NEW]

#### Scenario: Consecutive sequence numbers
- **WHEN** a turn appends a reasoning row, a tool call row and an assistant message row
- **THEN** the three row events carry `seq` values n, n+1 and n+2 and the same `epoch`

#### Scenario: Update to an existing row
- **WHEN** a running tool call completes
- **THEN** a `row_updated` event carries the same tool call id with status `completed` and a new `seq`
- **AND** the client replaces the row in place instead of appending a second row

#### Scenario: Token-level text on the single channel
- **WHEN** an assistant row streams on the built-in runtime
- **THEN** `text_delta` events for that `rowId` arrive on channel P with `deltaIndex` 0, 1, 2, … and the client opens no other connection to the host

#### Scenario: Canonical row supersedes deltas
- **WHEN** a `row_updated` event arrives with `nextDeltaIndex: 12` while the client has applied deltas 0–9
- **THEN** the row shows the event's `text`, and deltas with `deltaIndex` below 12 that arrive afterwards are dropped

### Requirement: Stream ordering and duplicate handling
The client SHALL apply row events strictly in `seq` order per session. A row event whose `seq` is less than or equal to the highest applied `seq` in the same `epoch` MUST be ignored. An event whose `seq` is exactly highest+1 is applied. An event whose `seq` is greater than highest+1 MUST be buffered (up to 500 events) and trigger gap recovery. Text deltas are keyed by `rowId` and `deltaIndex`: out-of-order deltas are reordered by `deltaIndex`, duplicates and deltas below the row's last known `nextDeltaIndex` are dropped, and a delta for a row whose `row_added` has not been applied is held (up to 200 deltas per row) until that row arrives or is fetched. A missing delta never triggers a fetch by itself: the next `row_updated` of that row repairs the text. [JAD]

#### Scenario: Duplicate delivery
- **WHEN** the event with `seq` 41 is delivered twice
- **THEN** the timeline contains its row once

#### Scenario: Out-of-order delivery
- **WHEN** events arrive in the order 41, 43, 42
- **THEN** rows are rendered in the order 41, 42, 43 and no fetch is issued if 42 arrives within 250 ms of 43

#### Scenario: Lost delta
- **WHEN** delta 7 of a streaming row never arrives and the row's next `row_updated` carries `nextDeltaIndex: 10`
- **THEN** the row shows the canonical text and no fetch was issued for the delta

### Requirement: Stream gap recovery
When a `seq` gap persists for 250 ms, the client SHALL call `jagentchill.chat.timeline.fetch {sessionId, direction: "after", cursor: {epoch, seq: highestApplied}, limit: 200}` on channel P and repeat with the returned `endCursor` until the response has `hasNewer: false`. The fetch response is authoritative: it replaces buffered events in its range, and the `text` and `nextDeltaIndex` of an in-progress row in the response replace the deltas the client accumulated for it. While recovering, the chat pane SHALL show a thin progress line at its top and keep rendering already-applied rows. If three consecutive fetches fail, the pane shows "Unable to load new messages" with a "Retry" button and keeps the existing rows. [JAD]

#### Scenario: Gap is filled
- **WHEN** the client has applied `seq` 100 and receives 131
- **THEN** it fetches after 100, applies rows 101–131 in order, and discards the buffered event 131

#### Scenario: Recovery failure
- **WHEN** three fetch attempts fail
- **THEN** the message "Unable to load new messages" and a "Retry" button are shown, and pressing "Retry" issues a new fetch from the same cursor

### Requirement: Initial load and history paging
Opening a session SHALL fetch one tail page with `jagentchill.chat.timeline.fetch {direction: "tail", limit: 100}`. Older history SHALL be fetched with `direction: "before"`, `limit: 100` when the user scrolls within 600 px of the top; the scroll position MUST stay anchored to the row the user was reading (no jump larger than 1 px). The fetch response SHALL carry `epoch`, `reset`, `staleCursor`, `gap`, `window {minSeq, maxSeq, nextSeq}`, `startCursor`, `endCursor`, `hasOlder`, `hasNewer` and `entries[]`, where each entry has `item`, `timestamp_ms`, `seqStart`, `seqEnd` and `collapsed[]` (`assistant_merge` | `reasoning_merge` | `tool_lifecycle`). The list SHALL be virtualised so that scrolling a session of 10,000 entries drops at most 2 % of frames on the reference desktop and at most 5 % on the reference phones of `diagnostics-quality.Performance budgets`. A skeleton of three rows SHALL be shown while the first page loads. [JAD]

#### Scenario: Long session opens fast
- **WHEN** a session with 4,000 entries is opened
- **THEN** only the latest 100 entries are fetched and the first paint occurs within 500 ms of the response

#### Scenario: Load older history
- **WHEN** the user scrolls to the top
- **THEN** the previous 100 entries are inserted above and the viewport stays on the same row

#### Scenario: Scrolling a very long session on a phone
- **WHEN** a 10,000-entry session is flung from bottom to top on a reference phone
- **THEN** at most 5 % of frames are dropped during the scroll

#### Scenario: Start of history
- **WHEN** `hasOlder` is false
- **THEN** a centred caption "Start of session · <date>" is shown above the first row and no further fetch is issued

### Requirement: Resume after reconnect
After a reconnect the client SHALL restore channel P (`device-pairing-signing.Reconnect handshake`; backoff, liveness and connect timeout are owned by `device-pairing-signing.Connection liveness and backoff`), re-subscribe to open sessions and, for each, call `jagentchill.chat.timeline.fetch` with `direction: "after"` from its last applied cursor before applying new live events. Returning from background forces an immediate reconnect check. Live events received before the catch-up fetch completes SHALL be buffered and then applied under the ordering rules. Requests in flight at disconnect are rejected and their UI returns to the retry state. [JAD]

#### Scenario: Phone returns from background
- **WHEN** the app was in background for 5 minutes during a running turn and returns to foreground
- **THEN** the missing rows are fetched and rendered in order within 3 s on a working connection
- **AND** the live stream continues without duplicated rows

#### Scenario: Stale cursor
- **WHEN** the catch-up fetch returns `staleCursor: true`
- **THEN** the client discards its in-memory timeline for that session and loads a fresh tail page

### Requirement: Epoch reset handling
When a stream event or fetch response carries an `epoch` different from the client's, or `reset: true`, the client SHALL discard its cached timeline rows and local replica cache for that session, fetch a new tail page, and keep the composer draft, scroll the view to the bottom and keep the workspace pane state. [JAD]

#### Scenario: Rewind on another device
- **WHEN** device A rewinds a session that device B has open
- **THEN** device B receives the new epoch, reloads the tail page and shows the shortened timeline within 2 s

#### Scenario: Draft and workspace survive a reset
- **WHEN** a fetch response carries `reset: true` while the composer holds a draft and the Assets tab is active
- **THEN** the timeline is reloaded from a fresh tail page, the draft text is unchanged and the Assets tab is still active

### Requirement: Selective stream subscription
The client SHALL subscribe to timeline streams only for sessions that are open in a pane on that device, using `jagentchill.chat.subscribe {sessionIds[]}` and `jagentchill.chat.unsubscribe {sessionIds[]}` on channel P (scope `jagentchill.projects.read`; a session the device cannot read under `server-api.Session ownership and visibility` is refused with `NOT_FOUND` and the others are subscribed); the server keeps one Gateway subscription per session over its gateway link while at least one device is subscribed or a turn runs; for all other sessions it receives only list-level updates through `jagentchill.session.updated` (status, title, unread, attention). Which session a device has focused is reported through the single heartbeat of `cross-device-sync.Presence`; presence is used only for notification routing and MUST NOT affect delivery. [JAD]

#### Scenario: Background session
- **WHEN** a session that is not open on the device produces 200 timeline rows
- **THEN** the device receives no row events for it, only status and unread updates

#### Scenario: Pane closed
- **WHEN** the user closes the last pane showing a session
- **THEN** the device unsubscribes from that session within 1 s and receives no further row or delta event for it

#### Scenario: Subscribe to a session the device cannot read
- **WHEN** a `viewer` device calls `jagentchill.chat.subscribe` with the id of a workspace-class session
- **THEN** that id is refused with `NOT_FOUND` and no event of that session reaches the device

### Requirement: Streaming text reveal
Assistant and reasoning text deltas SHALL be revealed on the client at a paced rate such that text received at time t is visible within 400 ms of t. While a row streams, a caret indicator is shown at its end. If the view is scrolled to within 80 px of the bottom, it SHALL follow new content; otherwise it MUST NOT move and a floating circular "scroll to bottom" button SHALL appear with a count badge of new rows. Markdown that is incomplete during streaming (an open code fence, table or list) SHALL render as its closed form, and the height of a streaming row MUST never decrease between two consecutive frames. [JAD]

#### Scenario: Reveal latency
- **WHEN** a delta is received at time t
- **THEN** its text is visible by t + 400 ms

#### Scenario: Row height is monotonic
- **WHEN** a code fence opens and closes while streaming
- **THEN** the row's height never decreases from one frame to the next

#### Scenario: Reading earlier content while streaming
- **WHEN** the user has scrolled up 1,000 px and new text streams in
- **THEN** the viewport does not move and the scroll-to-bottom button shows the number of new rows

#### Scenario: Follow mode
- **WHEN** the view is at the bottom and text streams
- **THEN** the latest line stays visible

### Requirement: User message rendering
A user message SHALL render right-aligned in a bubble with the subtle background, 12 px radius, maximum width 80% of the chat column, with attachment chips below the text and inline mention chips inside it. Hovering (desktop/web) or long-pressing (mobile) shows actions: Copy, Edit and resend (creates a rewind-and-resend confirmation when newer turns exist), Fork from here, Rewind to here. The sender device name and time are shown in a tooltip or the long-press sheet. [JAD] [NEW]

#### Scenario: Attachments under the message
- **WHEN** a message was sent with a frame snapshot and a timeline range
- **THEN** both chips are shown under the bubble, and clicking the range chip moves the editor playhead to the range start and selects the range

#### Scenario: Edit and resend with newer turns
- **WHEN** the user chooses "Edit and resend" on a message that is followed by two completed turns
- **THEN** a confirmation states that the conversation will be rewound to that message, and nothing changes until it is confirmed

#### Scenario: Long message width
- **WHEN** a user message is 2,000 characters long
- **THEN** its bubble is at most 80% of the chat column wide and wraps

### Requirement: Assistant text rendering
Assistant text SHALL render left-aligned without a bubble, as Markdown supporting headings, emphasis, lists, tables, block quotes, inline code, fenced code with syntax highlighting and a copy button, links, and timecode links. A timecode written as `[[t:<ticks>]]` or a recognised `mm:ss.ff` / `hh:mm:ss` pattern preceded by "at" SHALL render as a link that seeks the bound project's playhead. References `[[el:<elementId>]]`, `[[asset:<assetId>]]` and `[[scene:<sceneId>]]` SHALL render as chips that select or reveal the entity in the editor. Remote content named by the model MUST never be fetched automatically: Markdown images, iframes, audio and video whose source is not a blob or artifact of the paired host (`server-api.Authenticated media delivery`) render as a link chip showing the host name, and no request is made until the user presses it. External links open in the system browser only after a click and a confirmation showing the full URL. Raw HTML in agent output MUST be rendered as text. [NEW]

#### Scenario: Timecode link
- **WHEN** the assistant writes "the jump cut is at [[t:1440000]]"
- **THEN** a link "00:12.00" is rendered and clicking it moves the playhead to 12 s in the bound project

#### Scenario: Remote image is not loaded
- **WHEN** the assistant output contains `![x](https://collector.test/p.png?d=secret)`
- **THEN** no request is sent to `collector.test` and a link chip labelled with the host name is shown

#### Scenario: HTML is not executed
- **WHEN** the assistant output contains `<img src=x onerror=alert(1)>`
- **THEN** the literal text is displayed and no script runs

### Requirement: Reasoning rendering
Reasoning rows SHALL be collapsed by default into a single row "Thought for <duration>" with a chevron; expanding shows the reasoning text in the secondary text colour. While reasoning streams, the row reads "Thinking…" with an animated indicator and the elapsed seconds. Consecutive reasoning rows merge into one. A user preference "Show reasoning expanded" defaults to off. [JAD]

#### Scenario: Collapsed by default
- **WHEN** a turn produced 9 s of reasoning
- **THEN** a row "Thought for 9s" is shown collapsed and expands on click

#### Scenario: Streaming reasoning
- **WHEN** reasoning has been streaming for 4 s
- **THEN** the row reads "Thinking…" with the elapsed seconds and no reasoning text is shown until the row is expanded

#### Scenario: Preference to expand
- **WHEN** "Show reasoning expanded" is on
- **THEN** new reasoning rows render expanded

### Requirement: Tool call rendering and lifecycle
A tool call row SHALL show an icon by tool family (families per `agent-editing-tools.Tool naming and families`), a human label built from the tool and its key parameters (for example "Split clip 'Interview A' at 00:14.02", "Generate image · 16:9"), the status (`running` with spinner and elapsed time, `completed` with a check, `failed` in the danger colour, `cancelled` in the tertiary colour) and the duration. Expanding a row shows the parameters as a key/value list, the result summary, and "View raw" with the JSON input and output; output shown is capped at 64 KiB with a "Truncated" note. Editing tool rows SHALL have a "Show in timeline" action that selects the affected elements. Clicking a tool row SHALL open the matching event in the Worklog tab. Tool rows of runtimes that report native tools (a CLI's own file or shell tools) use the runtime's tool name as the label and the family icon "runtime". [JAD] [NEW]

#### Scenario: Running to completed
- **WHEN** a tool call starts and completes after 3.2 s
- **THEN** the row shows a spinner with elapsed seconds, then a check and "3.2s"

#### Scenario: Failed tool call
- **WHEN** a tool returns the validation error `ELEMENT_NOT_FOUND`
- **THEN** the row shows the danger colour, the label "Failed", and the error message when expanded

#### Scenario: Cancelled tool call
- **WHEN** a turn is stopped while a tool call runs
- **THEN** that row shows the status `cancelled` in the tertiary colour

### Requirement: Collapsible activity groups
Consecutive reasoning and tool-call rows between two assistant texts SHALL be grouped into one collapsible activity row "Worked for <duration> · <n> steps" with, when the group changed the project, a change summary "+<added> ~<modified> −<removed>" in the success, secondary and danger colours. The group of the currently running turn is expanded; groups of completed turns are collapsed. Expanding shows a nested step list with one line per tool call and a status icon. Groups holding more than 50 steps render the first 20 and a "Show <n> more" row. [JAD] [NEW]

#### Scenario: Completed turn collapses
- **WHEN** a turn with 14 tool calls completes after 4 min 1 s having added 6 and removed 2 elements
- **THEN** the group collapses to "Worked for 4m 1s · 14 steps  +6 −2"

#### Scenario: Large group
- **WHEN** a group holds 120 steps and is expanded
- **THEN** 20 steps and a "Show 100 more" row are displayed

### Requirement: Task list rendering
When the agent publishes a task list (timeline item type `tasks`), the chat SHALL render a single task card that is updated in place for the turn: each item shows a state icon (`pending` empty circle, `in_progress` spinner, `completed` filled accent check, `cancelled` struck through) and its text, with a header "<done>/<total>" and a thin progress bar. The latest task list of the running turn SHALL also be pinned in a compact one-line form above the composer, expandable on click. [JAD]

#### Scenario: Progress updates in place
- **WHEN** the agent marks the third of seven items completed
- **THEN** the same card shows "3/7" and no second card is appended

#### Scenario: Pinned compact form
- **WHEN** a running turn has a task list with 3 of 7 items completed
- **THEN** a one-line row above the composer reads "3/7" with the current item's text and expands on click

#### Scenario: Turn without tasks
- **WHEN** a turn publishes no task list
- **THEN** no task card and no pinned row are shown

### Requirement: Proposal cards
A submitted proposal (`agent-editing-tools.Proposal staging`) SHALL render as a card with: title, summary sentence, author line when the author is not the session's own agent ("Proposed by <agent title>", per `multi-agent-orchestration.Proposals from team members`), change counts by kind (added, modified, removed, with element counts and affected duration), a before/after thumbnail pair of the most affected frame, estimated project duration change, and the buttons "Accept" (primary), "Reject" (ghost), "Review" (opens the Changes tab on this proposal) and a "⋯" menu with "Accept selected…" and "Ask for changes". The card shows the proposal state of the owning enum with these labels: `pending` "Pending", `applying` "Applying…", `accepted` "Applied" (with "Revert this change"), `partially_accepted` "Partly applied" (with "Revert this change"), `rejected` "Rejected", `stale` "Out of date" (with "Regenerate"), `expired` "Expired", `failed` "Failed" (with the error and "Retry"); an `open` proposal has no card. With the card focused the actions `proposal.accept` and `proposal.reject` apply, bindings per `keyboard-shortcuts`. Accepting and rejecting require the scope `jagentchill.projects.write`; devices without it see the card read-only. On mobile the buttons span the card width with 44 px height. [NEW]

#### Scenario: Accept from the card
- **WHEN** the user presses "Accept" on a pending proposal
- **THEN** the card shows "Applying…", then "Applied" with a "Revert this change" button
- **AND** the editor timeline shows the change

#### Scenario: Reject with feedback
- **WHEN** the user presses "Ask for changes" and writes "keep the intro music"
- **THEN** the proposal becomes `rejected` and the text starts a new agent turn carrying the rejection and the note

#### Scenario: Stale proposal
- **WHEN** the project changed so that the proposal no longer validates
- **THEN** the card shows "Out of date" with a "Regenerate" button and the accept button is disabled

#### Scenario: Viewer device
- **WHEN** a `viewer` device shows a pending proposal
- **THEN** "Accept" and "Reject" are disabled with the tooltip "This device cannot change projects"

### Requirement: Media cards
Generated or referenced media SHALL render as a media card: images as a thumbnail grid (up to 4 per row, click opens a lightbox with zoom), video as a poster with a play button and inline playback, audio as a waveform player with duration. Bytes are loaded only through `server-api.Authenticated media delivery`. Each card shows the caption, the model label, the cost when generated and the fallback disclosure of `orc-model-routing.Fallback disclosure` when a fallback served it, and actions: "Add to timeline" (inserts at the playhead through a proposal), "Save to media", "Download", "Regenerate", "Use as reference". Candidates of the same generation call are shown as one card with a selector. A card for a running generation job shows a progress bar with percentage and "Cancel", fed by `jagentchill.job.updated`. [NEW]

#### Scenario: Add a generated video to the timeline
- **WHEN** the user presses "Add to timeline" on a generated clip
- **THEN** a proposal that inserts the clip at the playhead on the main track is staged

#### Scenario: Job fails
- **WHEN** a generation job fails with a content-safety error
- **THEN** the card shows the mapped message from `generation-providers.Error and content-safety mapping` and a "Regenerate" button

### Requirement: Error items
A turn failure SHALL append an error item with a one-line human message, an error code, and actions that depend on the code: "Retry" (re-runs the last user message), "Switch model" (opens the model browser) for provider, quota and `NO_ROUTE` errors, "Sign in" or "Open provider settings" for authentication errors (admin devices; other devices see "Ask an admin device"), "Raise budget" for `BUDGET_EXCEEDED`, and "Copy details" (diagnostic text without secrets). Runtime errors use the mapping of `agent-runtimes.Error mapping`; provider errors of generation use `generation-providers.Error and content-safety mapping`. Errors SHALL be mapped to messages in the active locale; the raw provider text is available under "Details". [JAD] [NEW]

#### Scenario: Provider authentication error
- **WHEN** a turn fails because the API key was revoked
- **THEN** the error item reads "The provider rejected the API key" with "Open provider settings" and "Retry"

#### Scenario: Budget reached
- **WHEN** a turn's tool call is blocked with `BUDGET_EXCEEDED`
- **THEN** the error item names the budget scope and offers "Raise budget" on admin devices

### Requirement: Context compaction marker
When a session's context is compacted, the timeline SHALL show a divider row "Context compacted · <time>" that expands to the summary text. Entries before the marker stay visible and scrollable. `/compact` SHALL call `jagentchill.session.compact {sessionKey}` (scope `jagentchill.agent.use` and the act rule of `chat-agent.Agent sessions run on Gateway sessions`), which triggers compaction between turns on runtimes whose `capabilities.compaction` is not `none` and is refused during a running turn with `CONFLICT`; on other runtimes the command is absent from the list. The server applies it over its gateway link with the Gateway's `sessions.compact`, which the Gateway reserves for its administrator scope, so the command is gated by spike S12 (`agent-runtimes.Admin proxy and Gateway reuse`): when S12 fails, `/compact` is absent on every runtime and only the Gateway's automatic compaction produces markers. [JAD] [NEW]

#### Scenario: Automatic compaction
- **WHEN** the Gateway compacts the context during a long session
- **THEN** a "Context compacted" divider appears at that point and earlier rows remain readable

#### Scenario: Runtime without compaction
- **WHEN** the session's runtime has `compaction: "none"`
- **THEN** `/compact` is not offered in the command list

#### Scenario: Manual compaction between turns
- **WHEN** the user submits `/compact` in an idle session on the built-in runtime
- **THEN** the server compacts the session over its gateway link and a "Context compacted" divider appears

#### Scenario: Administrator-scope compaction unavailable
- **WHEN** the S12 result is `fail` on the pinned Gateway
- **THEN** `/compact` is not offered in the command list of any session

### Requirement: Message footer and actions
Each completed assistant turn SHALL end with a footer row holding the turn rating thumbs (`chat-agent.Turn rating`), copy (copies the turn's assistant text as Markdown), "Fork from here", and the completion time; hovering the time shows the absolute timestamp, the runtime and model that answered, the served-by attribution of `agent-runtimes.Served-by attribution`, and whether a fallback model was used. A floating circular scroll-to-bottom button SHALL appear when the view is more than 200 px above the bottom. [JAD] [NEW]

#### Scenario: Fallback is disclosed
- **WHEN** a turn was answered by a fallback model
- **THEN** the footer tooltip reads "Answered by <model> (fallback from <primary>)"

#### Scenario: Copy the turn
- **WHEN** the user presses copy on a turn with two assistant text rows
- **THEN** the clipboard holds both texts as Markdown in order

### Requirement: Status lines
The chat SHALL render status lines (centred, caption text style, secondary colour, with a small icon) for: turn stopped, mode changed, persona changed, model changed, thinking changed, runtime switched, context restored from history, project bound, session forked, session imported, rewind performed, agent waiting ("Waiting for your approval"), agent idle after a turn of at least 60 s ("Finished in <duration>"), waiting for a turn slot, connection lost and restored, and budget warnings. While a turn runs with no visible output for 2 s, an activity indicator line with a verb derived from the running tool family ("Reviewing the timeline…", "Rendering a frame…") SHALL be shown above the composer. [JAD] [NEW]

#### Scenario: Activity indicator reflects the running tool
- **WHEN** the agent is running a frame render tool for longer than 2 s
- **THEN** the indicator reads "Rendering a frame…"

#### Scenario: Short turn has no finished line
- **WHEN** a turn completes after 12 s
- **THEN** no "Finished in" status line is added

### Requirement: Permission request cards
A tool call that needs approval (`agent-editing-tools.Approval for out-of-project effects`, `agent-editing-tools.Cost guard`, the terminal approvals of `workspaces-terminal.Agent terminal tools`, the skill approvals of `skills.Agent tools to create and update skills`, and the command approvals of workspace runtimes) SHALL be held by the server and resolved by the server: no device answers a Gateway approval method, so the server knows which device answered and can restrict who is allowed to. The mechanism (block-and-retry for requests raised by `jc_*` tools at the server's tool endpoint, runtime-raised requests answered over the gateway link, the request record and the resolver rule) is owned by `server-api.Approval and question resolution`; this requirement owns the card and the client methods. The server stores the request and announces it as the stream event `permission_requested {requestId, kind, toolLabel, detail, requestingAgent?, actions[], requiredScope, adminOnly, expires_ms}` to the devices that can read the session. It renders as a permission card inside the stream with: title, the tool label, a detail block (exact target path, URL, command or keys verbatim, estimated cost, affected project), the requesting agent when it is not the session's own agent, and action buttons from `actions[]`, by default "Allow once", "Always allow for this session", "Deny" and "Deny and tell the agent why" (opens a text field). The answer is `jagentchill.chat.approval.resolve {requestId, decision: "allow-once" | "allow-session" | "deny", reason? (0–2,000 characters)}`; the server checks, before it releases anything, that the device can act in the session and holds the scope of this table (quoted from the owner), records `{resolverDeviceId, decision, decided_ms}` on the request and in the audit record of the tool call, and only then lets the call proceed (or answers the runtime's request over its gateway link):

| Request kind | Who can answer |
|---|---|
| `out-of-project` (URL import, other project, forced asset delete, trash and restore) | scope `jagentchill.agent.use` plus `jagentchill.projects.write` |
| `cost` (cost guard, budget raise) | scope `jagentchill.generation.run` |
| `publish` (publishing, share links, connectors) | scope `jagentchill.export.run` |
| `host-exec` (commands, terminal keys, script start and stop, file writes outside the working directory — every native approval of a workspace-class session) | scope `jagentchill.host.exec` (role `admin`) |
| `skill-write` (agent-created or updated skills) | scope `jagentchill.config.write` (role `admin`) |
| `unattended` (an agent asks to enter an unattended mode) | scope `jagentchill.config.write` (role `admin`) |

A device that lacks the needed right shows the card read-only with "This device cannot approve", or "Waiting for an admin device" when `adminOnly` is true, and a resolve attempt from it fails with `SCOPE_DENIED` and leaves the request pending. An unanswered request keeps the turn in `waiting` and expires after the timeout owned by `agent-editing-tools.Approval for out-of-project effects` (30 minutes), which denies it with `APPROVAL_TIMEOUT`. `jagentchill.chat.approval.list {sessionKey}` (scope `jagentchill.projects.read`, read rule) returns the pending requests of a session. With the card focused the actions `approval.allow-once` and `approval.deny` apply, bindings per `keyboard-shortcuts`. **Team runs.** The cards of a team run — its members' permission, cost and consent requests and its sign-offs — are shown in the run's home session (the Supervisor's session, `multi-agent-orchestration.Starting a team run`) and nowhere else, to the devices that can read that session; the session a run was started from shows one timeline item "Team run started — Open", which navigates to the home session and carries no card. [JAD] [NEW]

#### Scenario: Allow once
- **WHEN** the user presses "Allow once" on a request to import from a URL
- **THEN** the tool call proceeds, the card collapses to "Allowed · <time>", and the same tool asks again on its next out-of-project call

#### Scenario: Deny with reason
- **WHEN** the user denies and types "use the stock library instead"
- **THEN** the tool call fails with `PERMISSION_DENIED` and the reason is delivered to the agent

#### Scenario: Expiry
- **WHEN** no answer is given for 30 minutes
- **THEN** the card shows "Expired", the tool call fails with `APPROVAL_TIMEOUT`, and the turn continues

#### Scenario: Viewer device
- **WHEN** a permission card is shown on a `viewer` device
- **THEN** its buttons are disabled with the tooltip "This device cannot approve"

#### Scenario: Editor cannot approve a host command
- **WHEN** a workspace session raises a `host-exec` request and an `editor` device sends `jagentchill.chat.approval.resolve {decision: "allow-once"}` for it
- **THEN** the call fails with `SCOPE_DENIED`, the command does not run, the request stays pending, and the editor's card reads "Waiting for an admin device"

#### Scenario: Resolver is recorded
- **WHEN** an admin phone allows a skill write
- **THEN** the request record and the audit record of the tool call name that phone as `resolverDeviceId`

#### Scenario: Team run card lives in the home session
- **WHEN** a Peer of a team run started with `/team` from session A requests a cost approval
- **THEN** the card appears in the run's home session, session A shows only the item "Team run started — Open", and activating it opens the home session

### Requirement: Permission resolution across devices
A pending permission, question or plan approval SHALL be shown on every connected device that can read the session and answerable from any of them that holds the right the request names (`chat-agent.Permission request cards`, `chat-agent.Plan approval`, `chat-agent.Agent questions`). The server is the single resolver: when one device answers, the server publishes `permission_resolved`, `plan_resolved` or `question_resolved` with `{resolverDeviceId, resolverDeviceName, decision}`, all other devices MUST clear the card within 1 s and show who answered ("Allowed on <device name>"). A second answer for the same request id MUST be rejected with `ALREADY_RESOLVED` and have no effect. Pending requests are included in the session snapshot so a device that connects afterwards renders them. [JAD]

#### Scenario: Answer on the phone
- **WHEN** a permission card is shown on desktop and phone and the user allows it on the phone
- **THEN** the desktop card changes to "Allowed on <phone name>" within 1 s

#### Scenario: Racing answers
- **WHEN** two devices answer the same request within 100 ms
- **THEN** the first answer the server receives wins and the other device gets `ALREADY_RESOLVED` and shows the winning resolution

### Requirement: Plan approval
In `plan` mode the agent's plan SHALL render as a plan card (stream event `plan_requested {planId, steps[], estimateUsd?, workflowId?}`) with numbered steps, the tools and paid generations each step will use, an estimated total cost, and the buttons "Approve and run", "Approve in Auto", "Edit plan" (puts the plan text into the composer as a quoted reply) and "Reject". The answer is `jagentchill.chat.plan.resolve {planId, decision: "approve" | "approve-auto" | "reject"}` (scope `jagentchill.agent.use` and the act rule of `chat-agent.Agent sessions run on Gateway sessions`). Until approved, write tools of every family MUST fail with `PLAN_NOT_APPROVED`. The plan gate is enforced by the server on the host for every runtime that supports Plan (`agent-runtimes.Runtime modes catalogue`); a runtime's own native plan mode, when it has one, is presented with the same card. A waiting plan sets `attentionReason: "plan"`. A plan that creates a workflow links to the draft workflow of `agent-workflows.Agent behaviour per session mode` through `workflowId`.

What approval does depends on whether the runtime can change its permission mode during a turn (`liveModeChange` of `agent-runtimes.Capability flags per runtime`), so that this requirement never asks a runtime for a change it cannot make. **`liveModeChange: true`** (the built-in runtime): the plan card holds the turn in `waiting`; "Approve and run" switches the session to `edit` (and "Approve in Auto" to `auto`) and the same turn continues with step 1. **`liveModeChange: false`** (CLI and ACP runtimes): the plan turn ends when the plan card is raised — the session is `idle`, nothing is held in `waiting`; on approval the server patches the session mode to `edit` or `auto` between turns and starts a new turn itself with the data-only message "Plan approved — execute it", and the card reads "Approved · running in a new turn". "Reject" ends the turn where one is held and leaves the session in `plan` mode in both cases. An unanswered plan expires after 30 minutes like any approval. [JAD] [NEW]

#### Scenario: Approve a plan on a runtime with live mode change
- **WHEN** the user presses "Approve and run" in a session on the built-in runtime
- **THEN** the mode control shows "Edit" and the agent starts executing step 1 in the same turn

#### Scenario: Approve a plan on a CLI runtime
- **WHEN** a plan card was raised by a session on a runtime with `liveModeChange: false` and the user presses "Approve and run"
- **THEN** the plan turn had already ended, the session mode becomes `edit`, a new turn starts with the message "Plan approved — execute it", and the card reads "Approved · running in a new turn"

#### Scenario: Write attempted before approval
- **WHEN** the agent calls a write tool before the plan is approved
- **THEN** the call fails with `PLAN_NOT_APPROVED` and no project change occurs

#### Scenario: Reject a plan
- **WHEN** the user presses "Reject"
- **THEN** the turn ends, the session stays in `plan` mode and no write tool has run

### Requirement: Agent questions
When an agent calls `jc_session_ask` (`agent-editing-tools.Session question tool`), the server SHALL create a question record and announce it on channel P as the stream event `question_requested`; the chat SHALL render a question card with the question text and one of: single-choice options (2–6, each with label and description), multi-choice options, or free text; every choice question also offers "Other…" with a text field. Up to 4 questions can be grouped in one card and are submitted together with `jagentchill.chat.question.answer {questionId, answers[]}` (scope `jagentchill.agent.use`). The turn waits in `waiting`; answering resumes it; a second answer for the same question fails with `ALREADY_RESOLVED`. "Skip" answers with `skipped`. An unanswered question expires after 24 h and resolves as `skipped`. Questions to the user travel only through the server on channel P — the record, the `question_requested` event, the answer RPC and the cross-device resolution: questions are server-owned because no device holds any OpenClaw scope; a runtime's native structured question that the Gateway routes through its own question flow is received by the server over its gateway link, shown with the same card, and answered by the server over its gateway link (`question.resolve`, listed in `agent-runtimes.Admin proxy and Gateway reuse`) with the device's answer and the answering device recorded, and on a runtime with `capabilities.questions: false` the question is delivered as a plain assistant message that ends the turn (`agent-runtimes.Behaviour when a runtime lacks a capability`). [JAD] [NEW]

#### Scenario: Single choice
- **WHEN** the agent asks "Which aspect ratio?" with options 16:9, 9:16 and 1:1 and the user picks 9:16
- **THEN** the card collapses to "Aspect ratio: 9:16" and the turn resumes

#### Scenario: Other answer
- **WHEN** the user selects "Other…" and types "4:5"
- **THEN** the agent receives the free-text answer "4:5"

#### Scenario: Expiry
- **WHEN** a question is unanswered for 24 h
- **THEN** it resolves as `skipped`, the card reads "Skipped (no answer)" and the turn continues

#### Scenario: Runtime without questions
- **WHEN** the agent asks a question on a runtime with `questions: false`
- **THEN** the question appears as a plain assistant message and the turn ends

### Requirement: Remembered permission decisions
"Always allow for this session" SHALL store a rule `{toolName, scope}` valid for the session only, where `scope` is the rule target defined by `agent-editing-tools.Approval for out-of-project effects` (an exact URL, an origin plus path prefix without a query string, a path prefix, or a provider). Rules are kept by the server (they are never written into Gateway approval configuration), listed in the session menu under "Session permissions" from `jagentchill.chat.permissionRule.list {sessionKey}` (scope `jagentchill.projects.read`, read rule) and removed with `jagentchill.chat.permissionRule.remove {sessionKey, ruleId}` (the same right that was needed to create the rule). A rule can be created only by a device that was allowed to answer the request, and never for the kinds `host-exec`, `skill-write` and `unattended`, whose "Always allow for this session" action is absent. Rules MUST NOT persist across sessions and MUST NOT apply to requests whose scope differs. Automations and `auto` mode MUST NOT create rules implicitly. [NEW]

#### Scenario: Rule scope
- **WHEN** the user always-allows imports from `https://example.com` and the agent then imports from `https://other.test`
- **THEN** a new permission card is shown for the second origin

#### Scenario: Remove a rule
- **WHEN** the user removes a rule in "Session permissions"
- **THEN** the next matching tool call asks again

#### Scenario: No standing rule for host commands
- **WHEN** a `host-exec` request card is shown to an admin
- **THEN** its actions are "Allow once", "Deny" and "Deny and tell the agent why", and no session rule can be stored for it

### Requirement: Session split view
The session view SHALL be the two-pane frame owned by `app-shell-navigation.Session split view`, which is the only place that states the pane ratio, minimum widths, the overlay form at the medium breakpoint, the segmented "Chat | Workspace" switch at the compact breakpoint, persistence and the toggle and Focus-mode actions. This capability owns what the panes contain: the chat pane (header with title, persona chip, agent-class chip — "Creative" or "Workspace", the session's class of design D25, the Workspace chip in the warning tone with an icon and text —, folder and project chips, runtime badge, "Unattended" badge when granted, Share and "⋯"; the timeline; the composer) and the workspace pane (`chat-agent.Workspace tab strip and new-tab page`). On the compact form factor the "Workspace" segment shows a badge when a proposal, approval or question arrived while the chat was not visible, and vice versa. The action `session.workspace.toggle` collapses and restores the workspace pane (binding owned by `keyboard-shortcuts`); the state is the one that requirement persists. [NEW]

#### Scenario: Frame comes from the shell
- **WHEN** the session view is laid out at the wide breakpoint
- **THEN** pane widths, limits and persistence equal the values of `app-shell-navigation.Session split view`

#### Scenario: Phone layout
- **WHEN** the session is opened on a 390 px wide phone
- **THEN** the chat is shown with a "Chat | Workspace" segmented control, and a badge on "Workspace" indicates a new proposal

### Requirement: Workspace tab strip and new-tab page
The workspace pane SHALL have a tab strip, a "+" button and an expand button that maximises the pane. Panel types, each with icon, title and one-line description on the new-tab page opened by "+": **Timeline preview**, **Changes** (project proposals), **Worklog**, **Diagram**, **Assets**, **Files**, **File changes** (git), **Terminal**, **Agents** and **Script**. Default open tabs: Timeline preview, Changes, Worklog, Diagram and Assets for a session bound to a video project; Files, File changes and Agents for a workspace-class session without a project. Availability: Files and File changes need the session to have a workspace; Terminal is listed only on `admin` devices when the terminal is enabled (`workspaces-terminal.Terminal enablement and host-shell warning`); Agents needs the `multi-agent` flag; Script needs the `scripts` flag; Diagram needs the `workflows` flag — a type that is unavailable is omitted from the new-tab page, and an already open tab of that type shows the owning capability's requires-host or permission state. Files opened from the Files or Assets tabs, agent timelines opened from the Agents tab and scripts opened from the Script tab open as additional closable tabs. Tabs are reorderable by drag (desktop/web), closable except the last remaining tab, and their order and active tab are persisted per session per device. The actions `session.tab.next` and `session.tab.previous` cycle tabs, bindings per `keyboard-shortcuts`. At most 12 tabs are open; opening a thirteenth replaces the least recently used closable file tab, and when none exists the open is refused with the toast "Close a tab first". [NEW]

#### Scenario: Open a panel from the new-tab page
- **WHEN** the user presses "+" and chooses "Files"
- **THEN** a "Files" tab opens and becomes active

#### Scenario: Default tabs of a project session
- **WHEN** a new session bound to a video project is opened
- **THEN** the tabs Timeline preview, Changes, Worklog, Diagram and Assets are open in that order

#### Scenario: Terminal is admin-only
- **WHEN** an `editor` device opens the new-tab page
- **THEN** "Terminal" is not listed

#### Scenario: Tab limit
- **WHEN** 12 tabs are open including 5 file tabs and the user opens another file
- **THEN** the least recently used file tab is replaced by the new file

#### Scenario: Tab limit without a replaceable tab
- **WHEN** 12 tabs are open and none is a file tab
- **THEN** opening a file is refused with "Close a tab first"

### Requirement: Timeline preview tab
The Timeline preview tab SHALL show the bound project's preview player (play/pause, scrub, current time and duration, fit zoom) above a read-only miniature timeline with tracks, clips and the playhead, rendered by the same engine as the editor. When a proposal is pending, a segmented control "Current | Proposed" switches the player and the miniature timeline between the committed state and the proposal preview; elements added by the proposal are outlined in the success colour, modified ones in the accent colour, and removed ones are shown hatched in the danger colour in "Current". An "Open in editor" button opens the full editor at the same playhead. On mobile the player uses the engine surface WebView and the miniature timeline scrolls horizontally with a fixed centre playhead. With no bound project the tab shows "No project yet" and a "Create project" button. [NEW]

#### Scenario: Preview a proposal
- **WHEN** a proposal that trims three clips is pending and the user selects "Proposed"
- **THEN** playback shows the trimmed result and the three clips are outlined in the accent colour
- **AND** the committed project is unchanged

#### Scenario: No project bound
- **WHEN** the session has no bound project
- **THEN** the tab shows the empty state "No project yet" with "Create project"

### Requirement: Changes tab
The Changes tab SHALL list every proposal of the session that has a card (pending, applied, rejected, out of date…), newest first, each with its card (state, before and after pictures, counts, affected duration, accept / reject / review / revert) and its change list (kind, element, summary); it is never empty when the session's agent proposed a change. [OWNER 2026-10-07] The Changes tab SHALL show the project proposals of the session; file changes of a workspace are a different tab (`chat-agent.File changes and Terminal tabs`). Its header holds a status pill for every state of the proposal enum (`Pending` accent, `Applying…` accent, `Applied` success, `Partly applied` success, `Rejected` neutral, `Out of date` warning, `Expired` neutral, `Failed` danger), the proposal title, author, change counts and, for a pending proposal, "Accept all" (primary) and "Reject" buttons. Below, a list groups changes by scene then track; each change row has a kind icon (add, modify, remove, move), the element name, a before → after description of the changed properties (for example "start 00:04.00 → 00:03.12", "volume 0 dB → −6 dB"), a checkbox for partial acceptance, and a "Show" action that seeks and selects it in the preview. A sub-tab "History" lists every proposal of the session and of its agent tree with its state and time; selecting one shows its diff. A text filter narrows rows by element name. The Changes tab is a review surface and registers the `review` context with these action semantics (ids only; bindings are owned by `keyboard-shortcuts.Default bindings for workspaces, files, diffs and review`): `review.next-item` and `review.previous-item` move the focus to the next or previous change row, seeking the preview to it; `review.accept-item` ticks the focused row's checkbox and `review.reject-item` clears it, each together with its dependants; `review.submit` resolves the pending proposal with the ticked rows — "Accept all" when every row is ticked, partial acceptance (`agent-editing-tools.Partial acceptance`) otherwise, and "Reject" after a confirmation when no row is ticked; `review.add-comment` opens the reject-feedback field for the proposal. The actions are inert on a proposal that is not `pending` and on devices without `jagentchill.projects.write`. Changes that depend on another (a trim of a clip the proposal adds) SHALL be selected and deselected together, per `agent-editing-tools.Partial acceptance`. [NEW]

#### Scenario: Partial acceptance
- **WHEN** the user unchecks 2 of 9 changes and presses "Accept selected"
- **THEN** 7 changes are applied as one change and the proposal state is `partially_accepted`, shown as "Partly applied"

#### Scenario: Dependent changes
- **WHEN** the user unchecks "Add clip B" on which "Trim clip B" depends
- **THEN** "Trim clip B" is unchecked automatically

#### Scenario: Empty state
- **WHEN** the session has produced no proposal
- **THEN** the tab shows "No changes yet"

#### Scenario: Review actions on a pending proposal
- **WHEN** a pending proposal with 6 changes is open, the user runs `review.reject-item` on two rows and then `review.submit`
- **THEN** the proposal is resolved with partial acceptance of the 4 ticked changes and their dependants

#### Scenario: Review actions without write scope
- **WHEN** a `viewer` device runs `review.submit` on the Changes tab
- **THEN** nothing is resolved and the buttons are shown disabled

### Requirement: Worklog tab with scrubber
The Worklog tab SHALL present the session's tool activity as a sequence of events. The body shows the selected event: a header with the human label and time, and a viewer by event kind — a structured timeline snapshot (track list), a rendered frame, a transcript excerpt, a diff of a write tool, a generation job (prompt, parameters, result), or raw JSON. A bottom bar holds a scrubber spanning all events with accent progress, previous and next step buttons, the position "<i> / <n>", and a "● Live" toggle that, when on, follows the newest event. Moving the scrubber or pressing a step button turns Live off. The actions `worklog.previous`, `worklog.next` and `worklog.live` step and return to Live when the tab has focus (bindings per `keyboard-shortcuts`). For write events, a "View project at this point" action shows the project state after that event in a read-only preview. [NEW]

#### Scenario: Follow live
- **WHEN** Live is on and the agent performs a new tool call
- **THEN** the Worklog shows that event and the scrubber is at its end

#### Scenario: Step back
- **WHEN** the user presses the previous button twice
- **THEN** Live turns off, the event two positions earlier is shown, and the position reads "<n−2> / <n>"

#### Scenario: Empty worklog
- **WHEN** no tool has run in the session
- **THEN** the tab shows "The agent has not done any work yet"

### Requirement: Diagram tab
The Diagram tab SHALL be a host for `workflow-diagram.Session workspace Diagram tab`, which owns everything shown inside it: the canvas, the workflow and run selectors, node details and actions, the empty state and the status dot. This capability provides only the tab slot, its persistence in the tab strip, and the composer hook that the empty-state action uses to insert `/workflow ` and focus the input. [NEW]

#### Scenario: Hosted content
- **WHEN** a workflow run is bound to the session and the Diagram tab is opened
- **THEN** the run's canvas of `workflow-diagram` is shown inside the tab with its own toolbar

#### Scenario: Empty-state action reaches the composer
- **WHEN** the user presses "Start a workflow" in the empty tab
- **THEN** the session composer contains `/workflow ` and has focus

### Requirement: Assets tab
The Assets tab SHALL list every asset the session produced or attached — generated images, videos, voice, music, imported media, exported files — as a grid (default) or list, with filters by kind and by origin (Generated, Imported, Attached, Exported), sorted newest first. Each item shows a thumbnail, name, duration or dimensions, model and cost when generated. Actions: preview, "Add to timeline", "Reveal in media library", "Download", "Delete from session" (does not delete an asset used by a project). Multi-select supports batch "Add to timeline" and "Download". [NEW]

#### Scenario: Filter generated assets
- **WHEN** the user selects the filter "Generated"
- **THEN** only assets created by generation tools are shown

#### Scenario: Asset in use
- **WHEN** the user deletes from the session an asset that a project timeline uses
- **THEN** the asset is removed from the session list and remains in the media library and the project

### Requirement: Files tab
The Files tab SHALL be a host for the explorer of `workspaces-terminal.File tree with lazy loading, sorting and search`, bound to the session's workspace: the managed workspace of the bound project for creative sessions (`workspaces-terminal.Default project workspace directory`) or the session's own workspace for workspace-class sessions. Viewing, editing, uploading, downloading, size limits, confinement and role rules are those of `workspaces-terminal.File viewer by type with live reload`, `workspaces-terminal.File editing with optimistic concurrency`, `workspaces-terminal.Path confinement and limits` and `workspaces-terminal.Role and permission matrix`; this capability states no limit of its own, and the earlier read-only tree with a 5 MiB preview limit no longer exists. Files open as closable tabs in the session's tab strip. A row menu action "Add to chat" attaches the path as a `workspace-file` attachment. A session without a workspace shows the owning capability's requires-host state. [NEW]

#### Scenario: Open a script file
- **WHEN** the user opens `script.md` from the tree
- **THEN** a tab "script.md" opens with the viewer of `workspaces-terminal`

#### Scenario: Add a file to the chat
- **WHEN** the user chooses "Add to chat" on `notes/brief.md`
- **THEN** the composer gains a `workspace-file` chip for that path

#### Scenario: No workspace
- **WHEN** the session has neither a bound project nor a workspace
- **THEN** the tab shows the requires-host or "No workspace" state defined by `workspaces-terminal`

### Requirement: File changes and Terminal tabs
The **File changes** tab SHALL host `workspaces-terminal.Changes view with uncommitted and base diff` for the session's workspace, including its review drafts, whose "Add to chat" produces the `review` attachment of `chat-agent.Attachment types`. The **Terminal** tab SHALL host the terminals of the session's workspace as defined by `workspaces-terminal.Terminal tabs, splits and naming`, including terminals created by the session's agent (`workspaces-terminal.Agent terminal visibility and human takeover`). Both tabs follow the role rules of `workspaces-terminal.Role and permission matrix`: File changes is readable by every role and its git actions need the stated role; Terminal exists only for `admin` devices and only when the terminal is enabled. This capability defines no behaviour inside these tabs. [NEW]

#### Scenario: Review comments reach the composer
- **WHEN** the user adds two review comments in File changes and presses "Add to chat"
- **THEN** the session composer shows one `review` chip "Review (2)"

#### Scenario: Agent terminal is visible
- **WHEN** the session's agent creates a terminal
- **THEN** it appears in the Terminal tab of that session with the agent badge

#### Scenario: Terminal disabled on the host
- **WHEN** the terminal feature is off
- **THEN** the Terminal type is not offered on the new-tab page

### Requirement: Agents tab
The **Agents** tab SHALL host `multi-agent-orchestration.Agents tab and roster` for the session's agent tree, with its Roster, Team and Activity log views, and opens an agent's timeline as a closable tab defined by `multi-agent-orchestration.Per-agent timeline panel`. The tab is named "Agents"; no surface of this product is named "Sub-agents" except the composer lane of `chat-agent.Sub-agents track`. The tab title carries a count badge of items in "Needs you". [NEW]

#### Scenario: Roster is shown
- **WHEN** the session's agent created two children and the user opens the Agents tab
- **THEN** the roster lists three agents as a tree

#### Scenario: Needs-you badge
- **WHEN** a child agent waits for an approval
- **THEN** the Agents tab title shows the badge "1"

### Requirement: Script tab
The **Script** tab SHALL host the script work of the session: with one script bound to the session (created by the session's agent, attached by the user, or the script of the bound project) it shows that script; with several, a selector lists them newest first. A script that is `in_review`, `changes_requested` or escalated opens in the presentation of `script-studio.Review screen`; an agent's script proposal opens as the diff of `script-studio.Agent changes are versions presented as proposals`; any other script opens read-only with "Open in Script studio", which navigates to the script's route. All content, actions, scopes and limits inside the tab are owned by `script-studio`. Empty state: "No script in this session" with the actions "Write a script" (inserts `/script ` into the composer) and "Attach a script…". [NEW]

#### Scenario: Review inside the session
- **WHEN** the Screenwriter submits a script for review under a `human` policy
- **THEN** the Script tab shows the review presentation with its decision buttons

#### Scenario: Empty state
- **WHEN** the session has no script
- **THEN** the tab shows "No script in this session" with the two actions

### Requirement: Session menu
The top bar "⋯" button SHALL open a grouped menu with separators: Archive · Folders (Move to folder, Remove from folder, Pin/Unpin, New folder) · Edit tags, Rename, Copy session ID, Open project in editor, Fork session, Import session…, Save as workflow… (`agent-workflows.Entry points`), Schedule (opens an automation prefilled with this session as target), Session permissions, View carried context (after a runtime switch) · Focus mode, Session limits (the session budget of `generation-providers.Budgets with hard stop`), Find in chat (compact form factor) · Rate this session, View session insights · Stop (danger, when running), Delete (danger). A footer block shows live figures: total cost in USD with the accuracy label of `usage-tracking.Cost determination and labels`, number of user messages, context size from `usage-tracking.Context-window meter data`, runtime and model, and persona. Items that do not apply are disabled, not hidden. [NEW]

#### Scenario: Menu footer figures
- **WHEN** the menu is opened in a session with 12 user messages and 1.84 USD of usage
- **THEN** the footer shows "Cost $1.84 · 12 messages · Context 37% · <runtime · model> · Director"

#### Scenario: Copy session ID
- **WHEN** the user chooses "Copy session ID"
- **THEN** the id is on the clipboard and a toast "Copied" is shown

#### Scenario: Item that does not apply
- **WHEN** the session has no bound project
- **THEN** "Open project in editor" is shown disabled

### Requirement: Turn rating
The user SHALL be able to rate any assistant turn with thumbs-up or thumbs-down; thumbs-down opens a modal with reason checkboxes (Wrong edit, Did not follow instructions, Too slow, Too expensive, Poor generation quality, Other) and a text field of up to 2,000 characters. "Rate this session" in the session menu opens the same modal for the whole session. Ratings SHALL be stored on the user's Gateway only (`jagentchill.chat.rating.set`, scope `jagentchill.agent.use`), attached to the session and turn, exportable from settings as JSON with `jagentchill.chat.rating.export {sessionKey?}` (scope `jagentchill.config.read`; returns a blob reference downloaded over the signed media route), and MUST NOT be transmitted to any external service. A rating can be changed or cleared. This feature is named "Turn rating" everywhere; the product "Feedback" form is `diagnostics-quality.Local feedback capture`. [NEW]

#### Scenario: Thumbs-down with a reason
- **WHEN** the user selects thumbs-down, checks "Wrong edit" and submits
- **THEN** the thumb is highlighted and the rating appears in session insights

#### Scenario: Clear a rating
- **WHEN** the user presses the highlighted thumb again
- **THEN** the rating is removed from the turn and from session insights

#### Scenario: No outbound transmission
- **WHEN** a rating is submitted
- **THEN** no request leaves the Gateway host as a result

### Requirement: Session insights and usage
"View session insights" SHALL open a modal (960 px at the wide breakpoint, a full-screen page on compact) with tabs: **Overview** (duration, active time, turns, tool calls by family, proposals staged, accepted and rejected, turn ratings, runtime switches), **Usage** and **Timeline** (per-turn rows with start time, duration, steps and cost). The Usage tab is a host: its entire content — totals, the by-model-and-runtime table, per-turn list and chart, generation table, agent-tree drill-down, accuracy labels and CSV export — is `usage-tracking.Session usage view with agent-tree drill-down`, and every figure in the modal, the session menu footer and the composer indicator comes from the single query of `usage-tracking.Unified usage query`. This capability defines no usage figure or ledger of its own. [NEW]

#### Scenario: Usage tab is hosted
- **WHEN** the user opens the Usage tab of a session that used an LLM and a video model
- **THEN** the content of `usage-tracking.Session usage view with agent-tree drill-down` is shown and its total equals the session menu footer cost

#### Scenario: No usage yet
- **WHEN** insights are opened before the first turn completes
- **THEN** the Overview shows zeros and the Usage tab shows the empty state defined by `usage-tracking`

### Requirement: Sub-agents track
When the session agent delegates, the chat SHALL show the collapsible lane above the composer that is defined by `multi-agent-orchestration.Sub-agents track above the composer`, and one inline delegation row in the timeline per created agent (persona, task title, status, elapsed time, cost; pressing it opens the agent's timeline tab). Limits on depth and concurrency are exclusively those of `multi-agent-orchestration.Tree limits` (depth 3, 4 concurrent children per agent, 8 concurrent agents per tree, 24 agents per tree by default); this capability states none. Mode, permission and budget inheritance are `multi-agent-orchestration.Child mode and permission inheritance` and `multi-agent-orchestration.Cost and budget inheritance`; a descendant's permission request and proposal surface once in the root session's chat (`multi-agent-orchestration.Child approvals surface once`). The full tree is shown in the Agents tab (`chat-agent.Agents tab`). [JAD] [NEW]

#### Scenario: Parallel sub-agents
- **WHEN** the Director delegates storyboard work to two Storyboard agents
- **THEN** the lane lists both with independent progress and the timeline shows two delegation rows

#### Scenario: Limit comes from the tree limits
- **WHEN** the agent requests a fifth concurrent child with the default limits
- **THEN** the call fails with `AGENT_LIMIT_CHILDREN` as defined by `multi-agent-orchestration.Tree limits`

#### Scenario: Sub-agent permission
- **WHEN** a child agent's tool needs approval
- **THEN** exactly one permission card appears, in the root session's chat, labelled with the child's title

### Requirement: Voice dictation
Pressing the microphone button SHALL start dictation: the client records microphone audio (PCM 16 kHz mono 16-bit), streams 250 ms chunks through `jagentchill.chat.dictation.start`, `.chunk` and `.finish` on channel P with a `dictationId` and a per-chunk `seq`, and inserts partial then final transcripts at the caret. Transcription uses the task route `transcription.realtime` of `orc-model-routing.Routes with primary and ordered fallbacks`, which requires a model with `streaming` support; when the resolved model lacks it, dictation records first and transcribes on stop through the role's `default` route, inserting the final transcript only and showing the hint "Live transcript unavailable with this model". While recording the button shows a level meter and the elapsed time; pressing it again, pressing Escape while the composer has focus, or invoking `chat.dictation.toggle` ends dictation. Dictation MUST NOT send the message automatically. Maximum duration is 10 minutes. Microphone permission denial SHALL show "Microphone access is off" with a link to the system settings. Audio is not retained after transcription. [JAD] [NEW]

#### Scenario: Dictate into the composer
- **WHEN** the user dictates "trim the first five seconds" and stops
- **THEN** the text "trim the first five seconds" is in the input and no message has been sent

#### Scenario: Model without streaming
- **WHEN** the resolved transcription model has no streaming support
- **THEN** no partial text appears while recording, the hint is shown, and the full transcript is inserted after stop

#### Scenario: Permission denied
- **WHEN** the operating system denies microphone access
- **THEN** dictation does not start and the message "Microphone access is off" is shown with a settings link

#### Scenario: Connection lost during dictation
- **WHEN** the socket drops while recording
- **THEN** recording stops, the transcript received so far stays in the input, and a toast reads "Dictation stopped: connection lost"

### Requirement: Voice mode
Voice mode SHALL provide a hands-free conversation with the session agent: an overlay with a level visualiser, live transcript of the user's speech, the agent's spoken reply, and buttons Mute, Interrupt and End. Speech is detected with voice-activity detection (end of utterance after 700 ms of silence), transcribed with the route `transcription.realtime`, answered by the session agent, and spoken with the route `voice-tts.conversation`. The wire contract is three methods on channel P (scope `jagentchill.agent.use` and the act rule of `chat-agent.Agent sessions run on Gateway sessions`): `jagentchill.chat.voice.start {sessionKey}` → `{voiceId}`; `jagentchill.chat.voice.chunk {voiceId, seq, audio}` (PCM 16 kHz mono 16-bit, 250 ms chunks, as dictation); `jagentchill.chat.voice.stop {voiceId}`; the reply audio arrives as stream events `voice_audio {voiceId, seq, mime, data, final}` in chunks of at most 64 KiB, and an utterance becomes a turn through the same path as `jagentchill.chat.send`. Speaking while the agent talks interrupts playback within 300 ms. Every spoken exchange is written to the session timeline as normal user and assistant messages. Tool calls, proposals and permissions behave exactly as in text chat; a pending approval is announced by voice ("I need your approval to …") and must be confirmed on screen. An utterance whose transcription fails or is empty is discarded with the spoken and displayed notice "Didn't catch that". Voice mode ends automatically after 5 minutes without speech. On mobile it continues with the screen locked only while audio is active and shows a system audio session indicator. Voice mode requires a transcription model with `streaming` support. [JAD] [NEW]

#### Scenario: Spoken request
- **WHEN** the user says "add a fade out to the last clip" in voice mode
- **THEN** the utterance appears as a user message, the agent stages a proposal, and the reply is spoken

#### Scenario: End of utterance
- **WHEN** the user stops speaking for 700 ms
- **THEN** the utterance is closed and sent for transcription

#### Scenario: Barge-in
- **WHEN** the user starts speaking while the agent's reply plays
- **THEN** playback stops within 300 ms and the new utterance is captured

#### Scenario: Transcription fails
- **WHEN** an utterance cannot be transcribed
- **THEN** no user message is created and "Didn't catch that" is spoken and shown

#### Scenario: Automatic end
- **WHEN** no speech is detected for 5 minutes
- **THEN** voice mode ends and the overlay closes

#### Scenario: No usable voice route
- **WHEN** `voice-tts.conversation` resolves to no usable profile or the transcription model lacks streaming
- **THEN** voice mode cannot be started and a notice reads "Set up a voice model in ORC settings" with a link

### Requirement: Attention notifications hook
The chat agent SHALL emit an `attention_required` event with reason `finished`, `error`, `permission`, `question`, `plan` or `proposal` for every such occurrence and hand it to the `notifications` capability under exactly one kind of `notifications.Notification event catalogue` — `finished` → `agent.finished`, `error` → `agent.failed`, `permission` → `agent.approval_required`, `question` → `agent.question`, `plan` → `agent.plan_ready`, `proposal` → `agent.proposal_ready` (raised when a project edit proposal becomes `pending` and waits for accept or reject; resolved on every device when the proposal leaves `pending`; not raised for a proposal that `auto` mode applies without a user action) — and the `notifications` capability which alone decides whether, where and how it is delivered (`notifications.Attention routing by presence`, `notifications.Notification event catalogue`); this capability applies no presence rule, no minimum-duration rule and no suppression window of its own. The payload carries `sessionId`, `hostId`, title, reason, a 140-character summary, `automationId?` and the deep link `jagentchill://h/<hostId>/sessions/<sessionId>` (form owned by `app-shell-navigation.Deep links and file types`). Opening the deep link opens the session and focuses the pending card. [JAD]

#### Scenario: Turn finishes
- **WHEN** a turn completes
- **THEN** exactly one `attention_required` event with reason `finished` is handed to `notifications`

#### Scenario: Proposal ready
- **WHEN** a proposal is submitted
- **THEN** one event with reason `proposal` is emitted with the host-scoped deep link and is raised as the kind `agent.proposal_ready`

#### Scenario: Proposal applied automatically
- **WHEN** a proposal is accepted by the host in `auto` mode without a user action
- **THEN** no `agent.proposal_ready` notification is raised for it

#### Scenario: No suppression in this capability
- **WHEN** a turn finishes 3 s after it started while the user has the session focused
- **THEN** the event is still handed to `notifications`, which alone decides whether anything is shown

#### Scenario: Deep link focuses the card
- **WHEN** the user opens the deep link of a `permission` event
- **THEN** the session opens with the pending permission card focused

### Requirement: Offline and disconnected behaviour
When the connection to the Gateway is lost, the session view SHALL show one banner (warning left bar) within 2 s reading "Reconnecting to the host…" — there is one channel, so there is no separate agent connection state — keep the already-loaded timeline readable, keep the composer editable with the send button replaced by "Queue", and store up to 10 messages locally. On reconnect, locally stored messages are sent in order after the catch-up fetch, each with its original `clientMessageId`. Approval buttons, proposal accept and reject, control-row controls and voice are disabled while disconnected, with the tooltip "Unavailable while disconnected". After 60 s without connection the banner offers "Retry now" and "Connection settings". Sessions keep running on the Gateway while a client is disconnected. When the device is revoked or its role changes, channel P is closed by the host (`device-pairing-signing.Revocation`) and every Gateway call the server was making on that device's behalf stops; turns the device started keep running and stay visible to the remaining permitted devices. On a client without any paired host the chat area shows the pairing empty state. [JAD] [NEW]

#### Scenario: Message queued offline
- **WHEN** the connection is down and the user submits a message
- **THEN** the message appears with a "Queued" label and is sent after reconnection without user action

#### Scenario: Turn continues without the client
- **WHEN** the phone loses its connection for 3 minutes during a running turn
- **THEN** the turn completes on the Gateway and the phone shows the result after reconnecting

#### Scenario: Approval while disconnected
- **WHEN** a permission card is visible and the connection is down
- **THEN** its buttons are disabled with the tooltip "Unavailable while disconnected"

#### Scenario: Device revoked during a turn
- **WHEN** an admin revokes the phone that started a running turn
- **THEN** the phone's channel closes and it receives no further stream event, and the turn continues and is visible on the admin's desktop

### Requirement: Default agent personas
The server SHALL ship six **creative-class** agents (design D25: JAgentChill tools only, no host command or file tool), created at first start when absent and never overwriting user edits. Each has a name, description, avatar glyph, instructions, an ORC role, a tool allow-list expressed in tool families of `agent-editing-tools.Tool naming and families`, and the default skills of `skills.Bundled skill selection and persona defaults`:

| Agent id | Name | ORC role | Tool families allowed |
|---|---|---|---|
| `jagentchill-director` (default for new sessions) | Director | `director` | project, scene, media, search, timeline, editor, frame, transcript (read), generate, job, proposal, workspace, session, workflow, script (read), agent, room, board, team, loop, heartbeat, autonomous, skill |
| `jagentchill-screenwriter` | Screenwriter | `screenwriter` | project (read), media (read), transcript (read), timeline (read), script, workspace, session, agent (hand-off and hand-back only) |
| `jagentchill-storyboard` | Storyboard artist | `storyboard` | project (read), media, search, timeline (read), frame, script (read), generate (image, vision, cost), job, film (storyboard and panel tools), workspace, session, agent (hand-off and hand-back only) |
| `jagentchill-editor` | Editor | `editor` | every editing family (project, scene, media, search, timeline, editor, frame, track, clip, range, text, caption, transcript, audio, effect, filter, transition, color, keyframe, speed, mask, chroma, cutout, sticker, shape, marker, template, ai), generate, job, export, proposal, workspace, session, agent (hand-off and hand-back only) |
| `jagentchill-reviewer` | Reviewer | `reviewer` | the read-only tools of project, scene, media, timeline, editor, frame, transcript, script and workflow, plus `jc_review_submit`, `jc_script_approve`, session and agent (hand-back only) |
| `jagentchill-producer` | Producer | `director` | project, media, search, timeline (read), frame, generate, job, export, proposal, workflow, film, script, workspace, session, agent, room, board, team, loop, heartbeat, autonomous |

"(read)" means only the tools of that family marked `readOnly`. The effective policy is written and verified as defined by `agent-editing-tools.Tool policy profile`. Users SHALL be able to duplicate a persona, edit a persona's instructions, tool families and skills in settings, and reset a shipped persona to its defaults, through the methods and the screen of `chat-agent.Persona list and editor`; a user-defined persona stays creative-class, and workspace agents are not personas — they are sessions on a workspace runtime created under `agent-runtimes.Who can configure and who can select`. [NEW]

#### Scenario: Personas exist after first start
- **WHEN** the server starts on a fresh Gateway
- **THEN** `agents.entries` contains the six `jagentchill-*` agents and the persona picker lists them with Director selected

#### Scenario: Reviewer cannot write
- **WHEN** the Reviewer persona attempts a write tool of the clip family
- **THEN** the tool is not available to it and no project change occurs

#### Scenario: Creative persona has no command tool
- **WHEN** any shipped persona's effective tool list is read
- **THEN** it contains no host command, process, browser or generic file tool

#### Scenario: User edit is preserved on upgrade
- **WHEN** the user edited the Editor persona's instructions and the server is upgraded
- **THEN** the edited instructions are kept and settings show "Customised" with a "Reset to default" action

### Requirement: Persona list and editor
Personas SHALL be listed, duplicated, edited, reset and deleted through the channel P methods of the sub-namespace `agent.persona.*`, which `server-api.RPC domain ownership` delegates to this capability inside the `agent` domain, and through the screen that Settings ▸ Host ▸ Agents ▸ "Agent personas" ▸ "Manage…" opens (`settings-preferences`; decision E8). A persona record is `{personaId, name (1–40 characters), description (0–200), avatar (one glyph of `design-system.Icon tokens` or an emoji of at most 2 grapheme clusters), instructions (0–20,000 characters), orcRole (a role id of `orc-model-routing.Role catalogue`), toolFamilies[] (families of `agent-editing-tools.Tool naming and families`, each optionally marked read-only), skillIds[] (the persona's skill allow-list, `skills.Per-agent and per-runtime availability`), origin: "shipped" | "user", basedOn? (the persona it was duplicated from), customised (a shipped persona that differs from its defaults), rev, updated_ms}`; every persona is creative-class and no edit can change that. The methods are: `jagentchill.agent.persona.list {}` → `{personas[]}` and `jagentchill.agent.persona.get {personaId}` (scope `jagentchill.projects.read`); `jagentchill.agent.persona.duplicate {personaId, name?}` → the new record with `origin: "user"`, id `persona-<12 base32 characters>` and the name "<name> copy" when none is given; `jagentchill.agent.persona.update {personaId, rev, changes {name?, description?, avatar?, instructions?, orcRole?, toolFamilies?, skillIds?}}`, which applies to shipped and user personas alike and fails with `CONFLICT` on a stale `rev`; `jagentchill.agent.persona.reset {personaId}`, which restores a shipped persona to the defaults of `chat-agent.Default agent personas` and of `skills.Bundled skill selection and persona defaults` and answers `INVALID_PARAMS` for a user persona; and `jagentchill.agent.persona.delete {personaId}`, which removes a user persona, answers `INVALID_PARAMS` for a shipped one, and answers `CONFLICT` with `details.usedBy[]` while a Team role, an ORC role, a workflow node or an automation names it. The four mutating methods need scope `jagentchill.config.write` (role `admin`) and accept `idempotencyKey`. A `toolFamilies` value SHALL contain only families of the index and never a native command, file, terminal, browser or web tool; a value outside it is refused with `INVALID_PARAMS` naming the family. After each mutation the server rewrites the persona's Gateway agent entry (`agents.create` / `agents.update` over the gateway link, with the tool policy of `agent-editing-tools.Tool policy profile`) and announces the change with `jagentchill.settings.host.changed`, on which clients refetch the list; a mutation made while the Gateway is unavailable is stored, answers success with `projection: "pending"` and is applied when the link is ready. A running turn keeps the instructions and tools it started with; the next turn of every session on that persona uses the new ones. At most 50 user personas exist per host (`QUOTA_EXCEEDED` beyond). **Screen.** The list shows shipped personas first and then user personas by name, each row with glyph, name, description, ORC role and the badge "Customised" where it applies; a row's menu offers "Edit", "Duplicate", "Reset to default" (shipped and customised only, behind the confirmation "Reset <name> to its default instructions, tools and skills?") and "Delete" (user personas only). The editor has the fields Name, Description, Glyph, Model role, Instructions (a multi-line field with a character count), Tools (one checkbox per family with a "read only" option where the family has read-only tools) and Skills (the allow-list control of `skills.Per-agent and per-runtime availability`), with "Save" and "Cancel"; the list and the editor open inside the Host ▸ Agents settings page — a detail pane on wide and medium layouts and a full-height sheet on compact ones, not routes of their own — with the same fields on web, desktop and mobile. Devices without `jagentchill.config.write` see the list and the editor read-only with "Only an admin device can change personas". [NEW]

#### Scenario: Duplicate and edit
- **WHEN** an admin duplicates "Editor", renames the copy "Shorts editor" and removes the `export` family
- **THEN** a user persona with `origin: "user"` and `basedOn: "jagentchill-editor"` exists, its Gateway agent entry no longer allows any `jc_export_*` tool, and the persona picker lists it within 2 s on every connected device

#### Scenario: Reset a shipped persona
- **WHEN** an admin edited the Director's instructions and then chooses "Reset to default" and confirms
- **THEN** the Director's instructions, tool families and skills equal the shipped defaults and the "Customised" badge is gone

#### Scenario: Delete a persona in use
- **WHEN** an admin deletes a user persona that a Team role names
- **THEN** the call fails with `CONFLICT`, `details.usedBy[]` names the team, and the persona still exists

#### Scenario: Native tool family refused
- **WHEN** `jagentchill.agent.persona.update` is called with `toolFamilies` containing `exec`
- **THEN** the call fails with `INVALID_PARAMS` naming `exec` and the persona is unchanged

#### Scenario: Editor device
- **WHEN** an `editor` device opens "Agent personas"
- **THEN** the list and the fields are read-only, and `jagentchill.agent.persona.update` from that device answers `SCOPE_DENIED`

### Requirement: Persona skills
The skills shipped with the product and their default assignment to personas SHALL be those of `skills.Bundled JAgentChill skills` (21 bundled skills) and `skills.Bundled skill selection and persona defaults`; this capability keeps no list of its own. The persona editor of `chat-agent.Persona list and editor` shows each persona's allow-list (written by `jagentchill.agent.persona.update {changes: {skillIds}}`) with the controls of `skills.Per-agent and per-runtime availability`, and a skill assigned to a persona but missing or disabled is reported there as defined by `skills.Skill failure and degraded states`. The per-turn attachment of skills is `chat-agent.Skills control`. [NEW]

#### Scenario: Editor persona loads its default skills
- **WHEN** a session runs on the Editor persona with default settings
- **THEN** the skills available to the agent are exactly the Editor defaults listed in `skills.Bundled skill selection and persona defaults`

#### Scenario: Missing skill
- **WHEN** a skill assigned to a persona is missing on the host
- **THEN** the persona settings show the degraded state defined by `skills` and the session still starts without it

### Requirement: Find in chat
The action `chat.find` (binding per `keyboard-shortcuts`) with focus in the chat pane SHALL open a find bar searching the full session transcript on the host with `jagentchill.chat.search {sessionId, query, cursor?}` (not only loaded rows), showing "<i> of <n>" with previous and next buttons; navigating to a match loads the page containing it and highlights the match. Search covers user text, assistant text and tool labels, is case-insensitive, and returns within 500 ms for a 10,000-entry session on the reference desktop host. On mobile the find bar is opened from the session menu. [JAD]

#### Scenario: Match in unloaded history
- **WHEN** the query matches an entry 3,000 rows above the loaded window
- **THEN** pressing next loads that page and scrolls to the highlighted match

#### Scenario: No match
- **WHEN** the query matches nothing
- **THEN** the bar shows "0 of 0" and the previous and next buttons are disabled

### Requirement: Concurrent session limits
The Gateway SHALL run at most 4 root-session turns concurrently by default (`limits.maxConcurrentTurns`, range 1–16, scope `jagentchill.config.write`). A message sent beyond the limit puts its session in the state `queued` with the status line "Waiting for a free agent slot (position <n>)" and starts in first-in-first-out order. Turns in the state `waiting` (blocked on a person) do not hold a slot: the slot is released when the turn blocks and re-acquired, ahead of `queued` sessions, when it resumes. The limit does not apply to agents created inside a tree, which are bounded by `multi-agent-orchestration.Tree limits`, nor to workflow, team and automation runs, which have their own limits. [NEW]

#### Scenario: Fifth concurrent turn
- **WHEN** four turns are running and the user sends a message in a fifth session
- **THEN** that session is `queued`, shows "Waiting for a free agent slot (position 1)" and starts when one turn ends

#### Scenario: Waiting turn frees its slot
- **WHEN** one of four running turns blocks on a permission request
- **THEN** the queued fifth session starts

#### Scenario: Remove a queued message
- **WHEN** the user removes the message of a `queued` session
- **THEN** the session returns to `idle` and other queued sessions move up one position

### Requirement: Chat accessibility and localisation
All chat controls SHALL be reachable by keyboard in a logical order, have accessible names, and expose streaming updates through a polite live region that announces at most one update every 5 s plus an immediate announcement for permission, question and proposal cards. Focus MUST move to a new permission, question or proposal card only when the chat pane already has focus. UI strings come from locale resources (`en`, `vi`, `ja`); agent-authored text is not translated by the UI. The agent SHALL be instructed to reply in the language of the user's message. Touch targets on mobile are at least 44 × 44 px. [NEW]

#### Scenario: Screen reader announcement
- **WHEN** a permission card appears while a screen reader is active
- **THEN** the card's title and available actions are announced immediately

#### Scenario: Japanese locale
- **WHEN** the app locale is `ja`
- **THEN** composer placeholder, card buttons and status lines are shown in Japanese while agent text stays as generated

### Requirement: Chat pane hosts
The chat pane (header, timeline, composer with its control row) SHALL be one component hosted in three places with identical behaviour: the session view (`chat-agent.Session split view`); the editor agent panel of `app-shell-navigation.Editor agent panel` (desktop and web: a collapsible region beside the inspector; mobile: a full-height sheet), which shows the most recent session bound to the open project or a draft bound to it, and previews proposals on the editor's own player and timeline; and the `agent` panel of a workspace screen (`workspaces-terminal.Panel kinds`). Host-specific differences are limited to: the editor agent panel has a session switcher and "Open in session view" in its header and no workspace pane; the workspace `agent` panel takes its Files, File changes and Terminal from the surrounding workspace screen. A session opened in two hosts on one device shares one subscription and one draft. [NEW]

#### Scenario: Agent panel inside the editor
- **WHEN** the user opens the agent panel in the editor of project "Vlog 12" and sends a message
- **THEN** a session bound to "Vlog 12" is created and its proposal cards preview on the editor's own timeline

#### Scenario: Same draft in two hosts
- **WHEN** a session is open in the session view and in the editor agent panel on the same device and the user types in one composer
- **THEN** the other composer shows the same draft text

### Requirement: Session and chat RPC surface
This capability SHALL define exactly the channel P methods of the two tables below in the `session` and `chat` domains of `server-api.RPC domain ownership`. The parameters, result and required scope of each method are stated by the requirement named in its row; every method that names a session applies the ownership and visibility rules of `chat-agent.Agent sessions run on Gateway sessions` before any Gateway call, and no method of either table takes a Gateway method name, an OpenClaw scope or a raw Gateway parameter object from the client.

Domain `session` (14 methods of this capability; event `jagentchill.session.updated` on stream `session`, opened and closed with `jagentchill.session.subscribe {}` and `jagentchill.session.unsubscribe {}`, scope `jagentchill.projects.read`; pull RPC `jagentchill.session.list`):

| Method | Defined in |
|---|---|
| `jagentchill.session.get` | `chat-agent.Agent sessions run on Gateway sessions` |
| `jagentchill.session.create` | `chat-agent.Session creation from the home composer` |
| `jagentchill.session.list` | `chat-agent.Session record and metadata` |
| `jagentchill.session.update` | `chat-agent.Session record and metadata` |
| `jagentchill.session.delete` | `chat-agent.Session delete` |
| `jagentchill.session.fork` | `chat-agent.Session fork` |
| `jagentchill.session.rewind` | `chat-agent.Session rewind` |
| `jagentchill.session.compact` | `chat-agent.Context compaction marker` |
| `jagentchill.session.folder.list` | `chat-agent.Session folders` |
| `jagentchill.session.folder.upsert` | `chat-agent.Session folders` |
| `jagentchill.session.folder.remove` | `chat-agent.Session folders` |
| `jagentchill.session.folder.reorder` | `chat-agent.Session folders` |
| `jagentchill.session.subscribe` | `chat-agent.Session and chat RPC surface` |
| `jagentchill.session.unsubscribe` | `chat-agent.Session and chat RPC surface` |

The remaining `session` methods are delegated and listed only by their owners: `jagentchill.session.bind` (`server-api.Agent tools and provider registration`), `jagentchill.session.access.get` and `.access.set` (`server-api.Session ownership and visibility`), `session.control.*`, `session.runtime.*`, `session.handover.*`, `session.queue.*`, `session.import.*` and `session.unattended.*` (`agent-runtimes.Runtime and provider administration RPC surface`) and `session.skills.*` (`skills.Skill RPC surface`); this capability calls `jagentchill.session.control.set` and `jagentchill.session.import.list` and defines neither. There is no generic relay method: a client reaches the Gateway only through the typed methods of these tables and of the delegated owners.

Domain `chat` (23 methods; event `jagentchill.chat.stream`; pull RPC `jagentchill.chat.timeline.fetch`):

| Method | Defined in |
|---|---|
| `jagentchill.chat.send` | `chat-agent.Message send idempotency and optimistic echo` |
| `jagentchill.chat.abort` | `chat-agent.Stop a running turn` |
| `jagentchill.chat.queue.list` | `chat-agent.Steer, queue and interrupt while running` |
| `jagentchill.chat.queue.remove` | `chat-agent.Steer, queue and interrupt while running` |
| `jagentchill.chat.attachment.create` | `chat-agent.Attachment limits and upload` |
| `jagentchill.chat.timeline.fetch` | `chat-agent.Stream event envelope with seq and epoch` |
| `jagentchill.chat.subscribe` | `chat-agent.Selective stream subscription` |
| `jagentchill.chat.unsubscribe` | `chat-agent.Selective stream subscription` |
| `jagentchill.chat.approval.list` | `chat-agent.Permission request cards` |
| `jagentchill.chat.approval.resolve` | `chat-agent.Permission request cards` |
| `jagentchill.chat.plan.resolve` | `chat-agent.Plan approval` |
| `jagentchill.chat.question.answer` | `chat-agent.Agent questions` |
| `jagentchill.chat.permissionRule.list` | `chat-agent.Remembered permission decisions` |
| `jagentchill.chat.permissionRule.remove` | `chat-agent.Remembered permission decisions` |
| `jagentchill.chat.rating.set` | `chat-agent.Turn rating` |
| `jagentchill.chat.rating.export` | `chat-agent.Turn rating` |
| `jagentchill.chat.dictation.start` | `chat-agent.Voice dictation` |
| `jagentchill.chat.dictation.chunk` | `chat-agent.Voice dictation` |
| `jagentchill.chat.dictation.finish` | `chat-agent.Voice dictation` |
| `jagentchill.chat.voice.start` | `chat-agent.Voice mode` |
| `jagentchill.chat.voice.chunk` | `chat-agent.Voice mode` |
| `jagentchill.chat.voice.stop` | `chat-agent.Voice mode` |
| `jagentchill.chat.search` | `chat-agent.Find in chat` |

A handler under `jagentchill.chat.`, or under `jagentchill.session.` outside the delegated prefixes, that these tables do not name MUST fail the contract test `rpc-ownership`. [NEW]

#### Scenario: Ownership test is exact
- **WHEN** the contract test `rpc-ownership` compares the server's handlers under `jagentchill.chat.` and the non-delegated handlers under `jagentchill.session.` with these tables
- **THEN** the two sets are equal

#### Scenario: Dictation has three methods
- **WHEN** the protocol package is read for the prefix `jagentchill.chat.dictation.`
- **THEN** exactly `start`, `chunk` and `finish` have schemas, and no method named `jagentchill.dictation.*` exists

#### Scenario: Unlisted method
- **WHEN** server code adds a handler `jagentchill.chat.export`
- **THEN** `rpc-ownership` fails and names the method

#### Scenario: No generic relay
- **WHEN** a client sends a request whose method is `jagentchill.session.relay` with a Gateway method name in its parameters
- **THEN** the response error is `NOT_FOUND` with `details.reason` `unknown_method` and no Gateway method was called

### Requirement: Streamed answers arrive as increments and are revealed evenly
While a turn runs, the host SHALL send the assistant text to subscribed devices as increments — never the whole text again with each one: every `jagentchill.chat.stream` event in state `delta` carries `seq` (1, 2, 3… within the turn), `deltaText`, `length` (the length of the whole text after this increment) and `replace: true` when `deltaText` replaces the text so far. A device whose text does not have that length after applying an increment SHALL read the text so far from `jagentchill.chat.subscribe` (its result carries `live { runId, seq, text }` while a turn runs; the same field lets a device that opens a session in the middle of a turn show what was written so far). A `status` event in the middle of a turn changes no text. The app SHALL fold the events of one animation frame into one update and SHALL reveal arriving text at an even pace (at least 90 characters per second, faster the more is waiting, the rest within 250 ms once the turn ended), so a runtime that reports its text in a few large pieces is revealed, not dropped in; text read from the transcript is shown whole. [OWNER 2026-10-07]

#### Scenario: Many small increments
- **WHEN** a model streams 2,000 characters in 200 pieces 20 ms apart
- **THEN** no event to the device is larger than its own piece plus the envelope, and the text on screen grows frame by frame for the length of the turn

#### Scenario: One large piece
- **WHEN** a runtime reports 1,500 characters at once
- **THEN** the text appears over many frames and no frame adds more than a few words

#### Scenario: A missed increment
- **WHEN** the increment with `seq` 3 never reaches a device and `seq` 4 arrives
- **THEN** the device shows no wrong text, reads `live` from `jagentchill.chat.subscribe` and continues from there

### Requirement: Cards keep their place in the conversation
Question, proposal, notice and approval cards SHALL stand in the timeline at the moment they happened (host time): a card is drawn before the first row that began after it, it changes state in place (an answered question folds to its line where it was asked), and everything produced afterwards appears below it. The pane SHALL follow the newest content only while the reader is at the end; any move up stops the following, the pane then stays where the reader is and shows a "New messages" button that returns to the end. Sending a message returns to the end. [OWNER 2026-10-07]

#### Scenario: Answer a question
- **WHEN** the user answers a question card and the agent writes on
- **THEN** the answered card stays above the agent's new text

#### Scenario: Reading earlier content
- **WHEN** the user scrolls up while an answer is streaming
- **THEN** the pane does not move and "New messages" is offered

### Requirement: Work log rows are sentences
Every tool call of the work log SHALL be titled by what it did, built from its arguments in the reader's language ("Added text “JAgentChill”", "Split clip at 00:03", "Read the timeline") — never the tool's id, and never the engine's dispatcher ("Tool call"): a call made through the dispatcher is one row, the tool's own. A row shows a kind icon per tool family, its live state (spinner, then check or warning), its duration and a one-line outcome (the host's summary sentence, or the error). Opened, it lists the arguments and the result as label / value lines with times as timecodes, the pictures a tool returned, and offers the raw data on demand. Consecutive calls form a group with a header (count, total time, first titles); a group is open while it runs, folded once its turn has ended, and stays open when a call failed, the failed row itself opened on its error. Reasoning the runtime reports is a collapsible block of its own. The host's link to the Gateway declares the `tool-events` capability so that arguments and results reach the app. [OWNER 2026-10-07]

#### Scenario: A failed call
- **WHEN** `jc_clip_split` fails with `ELEMENT_NOT_FOUND`
- **THEN** its row is titled "Split clip at 00:03", shows the warning state, and is open on the error message

### Requirement: The person's own MCP servers stay out of JAgentChill sessions
An agent CLI the host starts for a session SHALL NOT load the MCP servers of the person's own CLI configuration unless the host setting "Load my CLI's own MCP servers in JAgentChill sessions" (admin, default off, applied when the agent engine next starts) is on. Claude Code is started with only the session's MCP configuration; for OpenCode the host starts the engine with an environment that disables every MCP entry of the person's OpenCode configuration. The person's configuration files are never changed. [OWNER 2026-10-07]

#### Scenario: Default
- **WHEN** the host starts with the setting off and the person's OpenCode configuration lists the MCP server `serena`
- **THEN** the engine's environment carries `OPENCODE_CONFIG_CONTENT` with `mcp.serena.enabled` false
