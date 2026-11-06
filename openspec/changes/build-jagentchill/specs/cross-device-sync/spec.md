## ADDED Requirements

### Requirement: Gateway as the sync rendezvous
Synchronisation between devices SHALL happen only through a host that the devices are paired with (`device-pairing-signing.Identity model without accounts`); there SHALL be no vendor cloud, no account and no direct device-to-device channel. Every sync RPC SHALL be a channel P method of the domains `sync`, `blob`, `comment`, `presence` and `trash`, listed in `cross-device-sync.Sync RPC surface`, and every media byte SHALL travel over the signed HTTP routes of `server-api.Signed HTTP route surface`. The rendezvous is JAgentChill Server — where a requirement title of this capability says "Gateway" it names the host as devices see it, and the party that answers is always the server; the OpenClaw Gateway that the server supervises stores no document and no blob and takes no part in sync, so sync, blob transfer, presence, comments and trash keep working while that Gateway is restarting or down (`server-api.Gateway supervision and lifecycle`). The server is a rendezvous and store: it accepts, orders and stores state patches and never executes editor command logic (design D8). All editing SHALL keep working on a device while the server is unreachable, and nothing in this capability SHALL delay or block a local edit. Devices SHALL be linked for sync by the pairing of `device-pairing-signing.Offer presentation and intake`; no account link exists. When no host is paired, sync controls SHALL be replaced by a "Connect a host" entry that opens pairing. [CAPCUT CC-265, CC-266] [PORT N-011] [NEW]

#### Scenario: Local edit is never blocked
- **WHEN** a user splits a clip while the server is unreachable
- **THEN** the split is applied and saved locally in the same time as with sync disabled (no added wait)
- **AND** the project's sync status becomes "Offline changes (1)"

#### Scenario: Sync while the OpenClaw Gateway is down
- **WHEN** the supervised OpenClaw Gateway is in a crash loop and a paired device pushes an operation batch and uploads a blob chunk
- **THEN** both are accepted, other devices receive the operations within the usual limits, and only agent features answer `GATEWAY_UNAVAILABLE`

#### Scenario: No host paired
- **WHEN** a user opens the project list on a device with no paired host
- **THEN** no sync badges are shown and the host space section shows "Connect a host"

#### Scenario: No third-party endpoint
- **WHEN** network traffic is captured during a full project and media sync
- **THEN** every sync connection terminates at an address of the paired host

### Requirement: Synced document kinds
This capability SHALL sync three document kinds with two concurrency models. **Video projects** (`kind: "project"`) and **scripts** (`kind: "script"`, file form `.jcscript`, model owned by capability `script-studio`) use the state-patch operation log, revisions and snapshots, the single-writer edit lease, offline branches and the conflict choices of this capability; every sync method takes `doc: { kind, id }`. **Workflow documents** (`kind: "workflow"`) do NOT use the lease or the operation log of this capability: they are host-authoritative, edited concurrently through optimistic revisions in which geometry-only batches (node positions, sizes, groups, viewport) are merged and all other batches require the current revision, as defined by `agent-workflows.Graph operations` and `agent-workflows.Document operation stream`; this capability provides for them only blob transfer, presence, the host space listing and trash. Element provenance fields `filmLink`, `workflowLink` and `scriptLink` are ordinary document content and are carried by patches unchanged. Media of kind `slate` (locally rendered placeholder stills of draft timelines) sync as ordinary image blobs. A sync method naming a document that is not synced SHALL answer `PROJECT_NOT_SYNCED` or `SCRIPT_NOT_SYNCED` according to the kind. [NEW]

#### Scenario: Script uses the lease
- **WHEN** two devices open the same synced script for editing
- **THEN** the second receives `LEASE_HELD` and opens the script view-only

#### Scenario: Workflow does not use the lease
- **WHEN** two devices move different nodes of the same workflow at the same time
- **THEN** both changes are accepted, no lease is requested, and `jagentchill.sync.lease.acquire` with `doc.kind` `workflow` answers `INVALID_PARAMS`

#### Scenario: Unsynced script
- **WHEN** `jagentchill.sync.ops.pull` names a script that exists only on one device
- **THEN** the response error code is `SCRIPT_NOT_SYNCED`

### Requirement: Gateway space
The app SHALL present the paired host's storage as a space with five sections: "Projects" (synced projects with name, cover, duration, last-modified time, last-editing device or agent, and sync status), "Scripts" (synced scripts), "Exports" (results of remote exports; contents, retention and actions owned by `export-share.Remote export contract`), "Media" (blobs with name, type, size, variants present, linked or stored, and number of documents referencing them) and "Trash" (deleted synced items, typed `project`, `script`, `template`, `workflow-run`, `film` or `film-panel-asset` as defined by `projects.Trash`; restorable for 30 days). A header SHALL show used and total bytes from `jagentchill.settings.storage.get` as a bar and as text (for example "38.2 GB of 100 GB"). Each section SHALL support search by name, sort by name, date and size, multi-select, and an empty state with one sentence and one primary action. Lists SHALL page 50 items at a time. On mobile the sections SHALL be tabs in a horizontally scrollable strip and item actions SHALL open in a bottom sheet. The space SHALL state "Everyone paired with this host can see these items". [CAPCUT CC-264] [NEW]

#### Scenario: Browsing projects from a second device
- **WHEN** a user opens the host space on a phone that has never opened project P, which was synced from a desktop
- **THEN** P appears under "Projects" with its cover, duration and the desktop's device name
- **AND** tapping it downloads the project as specified in `cross-device-sync.Opening a synced project on another device`

#### Scenario: Restore from trash
- **WHEN** a user restores a project from "Trash" 10 days after deletion
- **THEN** it returns to "Projects" at its last revision with all media references intact

#### Scenario: Empty exports
- **WHEN** no remote export exists
- **THEN** "Exports" shows "No exports on this host yet" and a button "Export a project"

#### Scenario: Storage nearly full
- **WHEN** used bytes reach 90 % of the quota
- **THEN** the storage bar turns to the warning colour and a banner "Host storage is almost full" links to the Media section sorted by size

### Requirement: Per-project sync enablement
Each project and each script SHALL have a sync setting with values "On this device only" and "Sync with <host name>", shown in the project settings dialog and in the per-project menu of capability `projects`. New documents SHALL default to the app preference "Sync new projects" (default on when a host is paired, off otherwise). Turning sync on SHALL upload a snapshot of the document as revision 1 (or attach to the existing host copy when the id already exists there) and queue its media per `cross-device-sync.Media sync policy by platform`. Turning sync off SHALL keep the local document, stop all transfers for it, and ask whether to also remove the server copy (default: keep). Enabling requires scope `jagentchill.projects.write`. The per-device preferences named in this capability ("Sync new projects", "Download originals automatically", "Sync media over mobile data", "Upload limit", "Download limit", "Sync my library", comment display name) are shown on the Sync card of capability `settings-preferences` with exactly these names and defaults. [CAPCUT CC-265] [NEW]

#### Scenario: Enable sync on an existing project
- **WHEN** a user turns on sync for a local project with 12 media files
- **THEN** the project appears in the host space within 5 seconds of the snapshot upload finishing
- **AND** media upload progress is shown as "n of 12 files"

#### Scenario: Disable sync and keep the server copy
- **WHEN** a user turns sync off and chooses "Keep on host"
- **THEN** local edits stop being pushed and the server copy stays at its last revision

#### Scenario: Viewer cannot enable sync
- **WHEN** a device with role `viewer` opens the sync setting
- **THEN** the control is disabled with the tooltip "Your role on this host does not allow this"

### Requirement: Operation log
Every committed editor `Command` (one undo step, including the single step produced by committing a preview) on a synced document SHALL append one operation to the document's op log: `{ opId (UUIDv7), doc, revision, baseRevision, author, created_ms, commandType, label, patches[], schemaVersion }`. `patches` is the RESULT of the command — an ordered list of entries `{ op: "add" | "remove" | "replace", path, value?, before? }` in the state patch format of `project-document.State patch format`: `path` is a JSON Pointer into the canonical document in which a member of an id-keyed array is addressed by an `@<id>` segment instead of an index (for example `/scenes/@s1/tracks/overlay/@t3/elements/@e9/transform/position/x`), `add` into an ordered id-keyed array takes `before: "@<id>"` (absent = append), and a reorder is a `remove` followed by an `add`; which arrays are id-keyed is listed by that requirement for projects and by `script-studio` for scripts, and this capability restates no document shape — computed by the writer by comparing the document before and after the command; `commandType` and `label` are for display only. `author` is `{ kind: "device", deviceId }` or `{ kind: "host", principal }` with `principal` one of the forms of `cross-device-sync.Host principal lease`. Appliers (viewers, the server, other platforms, other app versions) SHALL apply patches — resolving an `@<id>` segment by a lookup of `id`, which needs no editor code — and SHALL never execute command logic, so the result does not depend on the JavaScript engine or the applier's command set; numbers in patches are serialised by the writer and copied by appliers. Undo and redo SHALL be recorded as new operations carrying the resulting patches; history is never rewritten. Preview-only state (uncommitted `previewElements`), selection, and everything under the document's device-local section `local` (playheads, zoom, panel layout, per-device media presence, export save path) SHALL NOT be written to the op log (`project-document.Device-local data is never synced`); a pushed patch whose `path` starts with `/local` is refused with `PATCH_INVALID`. A patch that is invalid by the rules of `project-document.State patch format` (a path that does not resolve, an `@<id>` that matches zero or several entries, an `add` of an existing id, a value whose `id` differs from the path's, a `remove`/`replace` of a missing member) SHALL make the server refuse the whole batch with `PATCH_INVALID` and `details { opId, index, documentCode: "document/patch-invalid" }`. The server checks patch form only; document invariants such as the template lock (`project-document.Template lock enforcement`) are enforced by every writer — device command managers and host tools — before a patch is emitted, and a host-side writer refuses a violating command with `CONFLICT` and `details.documentCode: "document/template-locked"`. On a device the patches are not computed a second time for sync: the client store emits them once per committed command into its pending-patch journal (`project-storage.State patch emission`), and this capability consumes that journal — an entry is removed only after the server acknowledged the operation built from it, entries survive an app restart, and a journal of a document whose sync is off is discarded when its snapshot is saved. Agent proposals are patch lists computed on the host replica by `agent-editing-tools.Proposal staging`; rebasing a proposal re-runs its tool calls and never re-applies stale patches. [NEW]

#### Scenario: One command, one operation
- **WHEN** a user drags a clip and releases it
- **THEN** exactly one operation is appended and the project revision increases by 1

#### Scenario: Undo is an operation
- **WHEN** the user presses undo
- **THEN** a new operation whose patches restore the previous state is appended and the revision increases by 1

#### Scenario: Applier does not run commands
- **WHEN** a viewer on an app version that lacks the command type `clip.speedCurve.set` receives an operation with that `commandType`
- **THEN** it applies the patches, its document equals the writer's, and it shows the operation's `label` in history

#### Scenario: Selection change
- **WHEN** the user only changes the selection or moves the playhead
- **THEN** no operation is appended

#### Scenario: Concurrent-safe addressing by id
- **WHEN** a host batch inserts an element before `@e4` and the lease holder's pending operation replaces `/scenes/@s1/tracks/main/elements/@e9/opacity`
- **THEN** both apply to the intended members whatever the array positions were

#### Scenario: Device-local path pushed
- **WHEN** a client pushes a patch with path `/local/timelineViewState/zoom`
- **THEN** the batch is refused with `PATCH_INVALID` and nothing is stored

#### Scenario: Invalid patch
- **WHEN** a pushed operation contains `{ "op": "replace", "path": "/scenes/@s9/name", "value": "x" }` and no scene has id `s9`
- **THEN** the batch is refused with `PATCH_INVALID`, `head` is unchanged and the device keeps the operations locally

### Requirement: Canonical document form
The canonical form of a synced project is defined by `project-document.Canonical JSON serialisation` and is not restated here beyond what transport needs: it is the document WITHOUT its `local` section, with object keys sorted by UTF-16 code unit order at every level, no insignificant whitespace, strings escaped minimally as by ECMAScript `JSON.stringify`, numbers written by the ECMAScript number-to-string algorithm after the writer rounded non-integer values to 6 fractional digits, and no negative zero; scripts use the same serialisation rules over the script model of `script-studio`. Appliers copy numbers from patches and never re-round. Snapshots, snapshot hashes and equality checks SHALL use this form. Applying the same ordered patches to the same snapshot SHALL produce byte-identical canonical JSON on every platform and on the server, which performs patch application with a JSON library only and needs no editor code. [NEW]

#### Scenario: Deterministic application
- **WHEN** the same snapshot and 500 recorded operations are applied on web (V8), iOS (JavaScriptCore), Android (Hermes) and the server (Node)
- **THEN** the SHA-256 of the canonical document JSON is identical on all four

#### Scenario: Local section excluded
- **WHEN** two devices hold the same project with different `local` sections (zoom, playhead, save path)
- **THEN** their canonical forms and snapshot hashes are identical

#### Scenario: Key order does not matter on input
- **WHEN** two writers serialise the same document with different key insertion orders
- **THEN** their canonical forms are byte-identical

### Requirement: Revisions and snapshots
A synced document's `revision` SHALL be a positive integer that starts at 1 and increases by exactly 1 per accepted operation or committed snapshot; the server's highest accepted revision is the document `head`. The server SHALL store a full snapshot (canonical JSON, gzip-compressed, addressed by SHA-256) at revision 1, whenever 200 operations have accumulated since the last snapshot, whenever a lease is released with operations since the last snapshot, and for every snapshot commit; it builds snapshots by patch application only. The server SHALL retain the 20 most recent automatic snapshots plus every snapshot marked as a named version, and SHALL discard operations older than the oldest retained snapshot. An operation or batch too large for `cross-device-sync.Pushing operations` SHALL instead be committed as a snapshot: the writer uploads the gzip-compressed canonical document as a blob and calls `jagentchill.sync.snapshot.commit { doc, leaseId, baseRevision, sha256, commandType, label }`, which creates exactly one revision. `jagentchill.sync.project.get` (and `jagentchill.sync.doc.get` for scripts) SHALL return `head`, `headSnapshotRevision`, `schemaVersion`, `maxSchemaVersion`, `updated_ms`, `lastAuthor` and the lease state. New snapshots are announced with `jagentchill.sync.snapshot`. [NEW]

#### Scenario: Snapshot cadence by count
- **WHEN** 200 operations are accepted after a snapshot at revision 400
- **THEN** a snapshot exists at revision 600

#### Scenario: Snapshot retention
- **WHEN** a project has 25 automatic snapshots and 2 named versions
- **THEN** the 5 oldest automatic snapshots and the operations before the oldest retained snapshot are deleted, and both named versions remain

#### Scenario: Catch-up needs a snapshot
- **WHEN** a client asks for operations from a revision older than the oldest retained operation
- **THEN** the response is `SNAPSHOT_REQUIRED` with the revision of the nearest snapshot at or below `head`

#### Scenario: Large paste committed as a snapshot
- **WHEN** a paste of 2 000 elements produces patches of 1.5 MiB
- **THEN** the writer commits a snapshot, `head` increases by exactly 1, and viewers fetch that snapshot

### Requirement: Pushing operations
The lease holder SHALL push operations with `jagentchill.sync.ops.push { doc, leaseId, baseRevision, ops[] }` in batches of at most 100 operations and at most 393 216 bytes of serialised `ops`, debounced 500 ms after the last local commit and flushed immediately when 100 operations are pending. The server SHALL accept a batch only when the caller's connection holds the current lease (`LEASE_NOT_HELD` otherwise), `baseRevision` equals `head` (`REVISION_CONFLICT` with `details.head` otherwise), every patch applies (`PATCH_INVALID`) and the batch's `schemaVersion` does not exceed the server's `maxSchemaVersion` for the document's kind (`SCHEMA_TOO_NEW`, `cross-device-sync.Schema version skew`); it SHALL assign consecutive revisions and SHALL be idempotent by `opId` (a re-sent operation already stored returns its existing revision). Accepted operations are published to subscribers as `jagentchill.sync.ops` on stream `sync:<kind>:<id>`; `jagentchill.sync.ops.pull { doc, afterRevision, limit }` is the stream's pull RPC. Operation pushes are never refused for storage quota (`server-api.Host storage accounting and cleanup`). Unpushed operations SHALL be persisted locally before the push is attempted and SHALL survive an app restart. A rejected or failed push SHALL never discard local operations. [NEW]

#### Scenario: Batch accepted
- **WHEN** the holder pushes 3 operations with `baseRevision` 41 while `head` is 41
- **THEN** the response lists revisions 42, 43 and 44 and `head` is 44

#### Scenario: Duplicate delivery
- **WHEN** the same batch is sent again after a lost response
- **THEN** the response returns the same revisions and `head` is still 44

#### Scenario: Push without the lease
- **WHEN** a device that does not hold the lease pushes
- **THEN** the response is `LEASE_NOT_HELD` and its operations remain stored locally as an offline branch

#### Scenario: App killed with pending operations
- **WHEN** the app is terminated with 7 unpushed operations and relaunched online
- **THEN** the 7 operations are pushed in order without user action

#### Scenario: Push while host storage is full
- **WHEN** the host's blob quota is exhausted and the holder pushes 2 operations
- **THEN** the push succeeds

### Requirement: Live following by non-writers
A device that opens a synced document without holding the lease SHALL open it in view-only mode: it SHALL subscribe with `jagentchill.sync.subscribe { doc }`, receive `jagentchill.sync.ops` events, and apply each operation's patches to its local copy within 1 second of the server accepting it on a link of at least 5 Mbit/s with at most 100 ms round-trip time. View-only mode SHALL allow playback, scrubbing, zoom, inspection of properties, comments, export of the current revision and "Save as a copy", and SHALL disable every editing control with the banner "<holder name> is editing this project" plus the actions "Request to edit" and "Follow"; when the holder is an agent the banner reads "<agent name> is applying changes" and has no "Request to edit". With "Follow" on, the viewer's playhead and visible timeline range SHALL track the editor's at an update rate of 4 per second, carried by presence (`cross-device-sync.Presence`); any manual scrub turns "Follow" off. A device with role `viewer` SHALL always open synced documents in view-only mode without the "Request to edit" action. [CAPCUT CC-270] [NEW]

#### Scenario: Viewer sees an edit
- **WHEN** the editor adds a text element on the desktop
- **THEN** the element appears in the phone's view-only preview and timeline within 1 second of the server accepting the operation on the stated link

#### Scenario: Editing controls disabled
- **WHEN** a view-only user tries to drag a clip or press Delete
- **THEN** nothing changes and the banner pulses once to indicate view-only mode

#### Scenario: Event gap
- **WHEN** the viewer's connection drops for 20 seconds and 15 operations are accepted meanwhile
- **THEN** on reconnect the viewer pulls the 15 operations with `jagentchill.sync.ops.pull` and its revision equals `head`

#### Scenario: Follow turned off by scrubbing
- **WHEN** a following viewer drags the playhead
- **THEN** "Follow" switches off and the viewer's playhead stays where the user put it

### Requirement: Single-writer edit lease
A synced project or script SHALL have at most one writer at a time, enforced by an edit lease held on the server: `{ leaseId (UUID), doc, holder, acquired_ms, expires_ms }` with `holder` either `{ kind: "device", deviceId, connId, clientInstanceId }` or `{ kind: "host", principal }` (`principal` is `agent:<sessionId>`, `run:<runId>`, `film:<filmId>` or `automation:<automationId>`, see `cross-device-sync.Host principal lease`), and a duration of 30 000 ms. A device with scope `jagentchill.projects.write` SHALL acquire it with `jagentchill.sync.lease.acquire` when it opens the document for editing and the lease is free, SHALL renew it with `jagentchill.sync.lease.heartbeat` every 10 000 ms while the document is open, and SHALL release it with `jagentchill.sync.lease.release` (after flushing pending operations, waiting at most 5 000 ms for the flush) when the document is closed, the app goes to the background on mobile for more than 20 000 ms, or the user chooses "Stop editing". A device lease is bound to one connection: push and heartbeat SHALL be accepted only from the connection that holds it, a reconnect with the same `clientInstanceId` before expiry re-binds it to the new `connId`, and a device holds at most one lease per document. A second connection of the same device (another tab or window) SHALL receive `LEASE_HELD` with `details.sameDevice: true` and show "Open in another tab or window of this device". A lease whose `expires_ms` passes without a heartbeat SHALL become free. Acquire on a held lease SHALL return `LEASE_HELD` with the holder's name, `acquired_ms` and `expires_ms`. Every lease change SHALL emit `jagentchill.sync.lease` to subscribers. A holder that learns its lease is gone SHALL switch to view-only within 1 second and keep its unpushed operations as an offline branch. [CAPCUT CC-269] [NEW]

#### Scenario: Acquire a free lease
- **WHEN** an editor opens a synced project nobody is editing
- **THEN** it receives a `leaseId` with `expires_ms` 30 000 ms ahead and the project opens editable

#### Scenario: Second device opens the project
- **WHEN** a second editor device opens the same project 5 seconds afterwards
- **THEN** acquire returns `LEASE_HELD` naming the first device, and the project opens view-only

#### Scenario: Two tabs of one device
- **WHEN** a web user who is editing a project in one tab opens the same project in a second tab
- **THEN** the second tab receives `LEASE_HELD` with `details.sameDevice` true, opens view-only and shows "Open in another tab or window of this device"
- **AND** a push from the second tab's connection is refused with `LEASE_NOT_HELD`

#### Scenario: Holder disappears
- **WHEN** the holder loses its connection and sends no heartbeat for 30 seconds
- **THEN** the lease is free, subscribers receive `jagentchill.sync.lease`, and a waiting device's banner offers "Start editing"

#### Scenario: Heartbeat after expiry
- **WHEN** the former holder's heartbeat arrives after the lease expired and another device acquired it
- **THEN** the heartbeat returns `LEASE_NOT_HELD` and the former holder switches to view-only within 1 second

### Requirement: Host principal lease
Host-side writers SHALL write a synced project or script only as a host principal, of exactly four forms: `agent:<sessionId>` for an agent session applying an accepted proposal (`agent-editing-tools.Edit lease coordination`); `run:<runId>` for a workflow or team run that has no chat session — an `editor` node of `agent-workflows.Editor node`, including the runs of the one-prompt video and film templates; `film:<filmId>` for a Film Studio action started by a person outside a run (assembly into the timeline, replacing a panel's clip); and `automation:<automationId>` for an automation instruction that writes without a session. A writer that runs inside a session always uses that session's `agent:` principal. Which agent is allowed to write is arbitrated among agents by `multi-agent-orchestration.Agent writer token`; this requirement arbitrates the host against devices and serialises host principals among themselves (one host batch per document at a time, in arrival order, a waiting batch failing with `LEASE_HELD` after 30 000 ms). The host principal SHALL be granted the lease only when no device holds it, SHALL hold it only while it is applying a batch, SHALL never request a takeover, and SHALL yield within 5 000 ms when a device calls `acquire`: the device's `acquire` waits on the server for the running batch to be committed (at most 5 000 ms) and is then granted the lease instead of receiving `LEASE_HELD`. Operations written by the host carry `author { kind: "host", principal }`. When a device holds the lease, an accepted host batch SHALL be applied BY that device: the server sends `jagentchill.sync.applyRemote { doc, batchId, baseRevision, label, patches[] }` to the holder's connection; the device applies the patches through its own command manager as one undo step, pushes the resulting operation, and answers `jagentchill.sync.applyRemote.result { batchId, result }` with `result` in `applied`, `busy` (a gesture or preview is in flight; the host retries after 2 000 ms, at most 5 times) or `rejected` (`baseRevision` no longer matches; the proposal is rebased by its owner). No answer within 10 000 ms counts as `busy`. A batch prepared by a run, a film action or an automation follows the same two paths as a session's batch: handed to the lease-holding device with `jagentchill.sync.applyRemote` when one exists, applied by the host principal otherwise; its `label` names the source ("Agent: <title>", "Workflow: <run name>", "Film: <episode>", "Automation: <name>") and becomes the name of the single history step on the applying device. Every host batch records, beside its principal, the device that owns its origin (the session owner or the device that started the run, `server-api.Session ownership and visibility`), for audit only. Revoking the device that started a session, run or automation does not cancel a host batch that is already being applied; batches not yet started by a turn that revocation aborted (`device-pairing-signing.Revocation`) are dropped with their proposal left pending. [NEW]

#### Scenario: Agent writes while nobody edits
- **WHEN** an agent's accepted proposal is applied to a project that no device has open for editing
- **THEN** the server grants the lease to `agent:<sessionId>`, appends one operation with a host author, and releases the lease

#### Scenario: Device opens the project during a host batch
- **WHEN** a device calls `acquire` while a host batch is being applied
- **THEN** the call returns a lease within 5 000 ms, after the host batch's revision, and never returns `LEASE_HELD`

#### Scenario: Device holds the lease
- **WHEN** the user accepts an agent proposal while their desktop holds the project's lease
- **THEN** the desktop receives `jagentchill.sync.applyRemote`, applies the patches as one undo step, pushes one operation and answers `applied`
- **AND** Ctrl/Cmd+Z on the desktop undoes the whole batch

#### Scenario: Holder is mid-gesture
- **WHEN** the lease-holding device is dragging a clip when `applyRemote` arrives
- **THEN** it answers `busy`, the host retries after 2 000 ms, and the batch is applied once the gesture ended

#### Scenario: Host never takes a device's lease
- **WHEN** an agent wants to write while a device holds the lease and the device answers `busy` 5 times
- **THEN** the batch stays pending with the state "Waiting for <device name>" and no lease change occurs

#### Scenario: Film assembly with nobody editing
- **WHEN** a person starts "Assemble into timeline" in Film Studio for a synced project that no device has open for editing
- **THEN** the host acquires the lease as `film:<filmId>`, commits the batch as one revision whose `author.principal` is that value, and releases the lease

#### Scenario: Workflow editor node while a phone holds the lease
- **WHEN** an `editor` node of a run without a chat session produces a batch while a phone holds the lease of the target project
- **THEN** the phone receives `jagentchill.sync.applyRemote` with label "Workflow: <run name>", applies it as one undo step and answers `applied`

### Requirement: Lease takeover and transfer
A non-holder device with scope `jagentchill.projects.write` SHALL be able to choose "Request to edit", which calls `jagentchill.sync.lease.requestTakeover` and raises the notification kind `sync.edit_requested` of `notifications.Notification event catalogue` for the holder device only (`targetDeviceIds: [<holder>]`; no other device receives or lists it). The holder SHALL see a dialog "<device name> wants to edit this project" with a 30-second countdown and the actions "Hand over" and "Keep editing". On "Hand over", or when the countdown ends with no answer, the holder SHALL flush pending operations (at most 5 000 ms), release the lease, and the server SHALL grant it to the requester; the former holder becomes view-only. On "Keep editing" the requester SHALL receive `TAKEOVER_DECLINED`, see "<device name> is still editing", and a further request within 60 seconds SHALL be answered `TAKEOVER_COOLDOWN`. The holder SHALL also be able to choose "Transfer editing to…" and pick a connected device with write scope, which SHALL receive the lease after accepting a prompt within 30 seconds. A device with role `admin` SHALL additionally have "Take over now" (`jagentchill.sync.lease.forceTake`, scope `jagentchill.devices.manage`), which grants the lease immediately after a confirmation; the previous holder's unpushed operations SHALL be kept on that device as an offline branch, the previous holder — and only that device (`targetDeviceIds`) — is notified with kind `sync.edit_taken`, and the takeover is written to the audit log. [CAPCUT CC-269] [NEW]

#### Scenario: Holder hands over
- **WHEN** the holder chooses "Hand over"
- **THEN** within 6 seconds the requester's project becomes editable at the latest `head` and the former holder's becomes view-only

#### Scenario: Holder idle
- **WHEN** the holder does not respond for 30 seconds
- **THEN** the lease transfers to the requester automatically

#### Scenario: Holder declines
- **WHEN** the holder chooses "Keep editing"
- **THEN** the requester sees "<device name> is still editing", and a second request 20 seconds afterwards is answered `TAKEOVER_COOLDOWN`

#### Scenario: Admin forces takeover with unpushed work on the holder
- **WHEN** an admin chooses "Take over now" while the holder has 4 unpushed operations and no connection
- **THEN** the admin's device gets the lease immediately
- **AND** when the former holder reconnects, its 4 operations are treated as an offline branch under `cross-device-sync.Conflict resolution choices`

#### Scenario: Transfer target rejects
- **WHEN** the chosen transfer target declines or does not answer within 30 seconds
- **THEN** the holder keeps the lease and sees "<device name> did not accept"

### Requirement: Offline branches
When a device edits a synced document without holding a valid lease on a reachable host (offline, lease lost, or forced takeover), its operations SHALL form an offline branch recorded locally as `{ baseRevision, ops[] }`, unlimited in length and persisted across restarts. The document's status SHALL read "Offline changes (n)". On reconnect the client SHALL fetch `head`: when `head` equals the branch `baseRevision` and the lease can be acquired, the client SHALL acquire it and push the branch without prompting (fast-forward); when `head` is greater than `baseRevision`, or the lease is held by another device, the client SHALL NOT push and SHALL raise the conflict flow. When the server copy has a `schemaVersion` the app does not support (`SCHEMA_TOO_NEW`), the branch SHALL be kept, only "Save mine as a copy" SHALL be offered, and sync of that document resumes after the app is updated. The client SHALL never merge two operation sequences automatically. [NEW]

#### Scenario: Fast-forward
- **WHEN** a laptop edits offline from revision 80 for an hour, reconnects, and `head` is still 80 with the lease free
- **THEN** all offline operations are pushed in order, `head` advances by their count, and no dialog is shown

#### Scenario: Diverged
- **WHEN** the same laptop reconnects and `head` is 95
- **THEN** nothing is pushed and the conflict dialog opens when the project is next opened or immediately when it is open

#### Scenario: Lease held but head unchanged
- **WHEN** `head` equals `baseRevision` and another device holds the lease
- **THEN** the client keeps the branch, shows "Offline changes (n) — waiting for <device name>", and offers "Request to edit"

#### Scenario: Host copy is at a newer schema
- **WHEN** a device with an offline branch reconnects and the document on the server answers `SCHEMA_TOO_NEW`
- **THEN** the branch is kept, the status reads "Update required to sync", and the only conflict action offered is "Save mine as a copy"

### Requirement: Conflict resolution choices
The conflict dialog SHALL show two columns, "This device" and "Host", each with: last-modified time, author name, number of operations since the common base revision, document duration and a preview thumbnail at the playhead; a "Compare" action SHALL open both versions side by side in view-only players with linked playheads. The dialog SHALL offer exactly these choices: (a) "Keep this device's version" — the device acquires the lease, commits its state as a snapshot that becomes `head + 1`, and the superseded host head is kept as a named version "Replaced on <date> by <device>" for 30 days; (b) "Keep the host version" — the local working copy is reset to `head` and the local branch is kept as a local version "Local changes from <date>" for 30 days; (c) "Save mine as a copy" — the local state becomes a new document named "<name> (copy from <device name> <YYYY-MM-DD HH:mm>)" with a new id, and the original is reset to `head`; (d) "Not now" — the document stays in a local-only conflicted state, opens editable locally, shows a "Sync paused — conflict" badge, and re-opens the dialog from that badge. Choice (a) SHALL require the lease to be free or handed over and scope `jagentchill.projects.write`. No choice SHALL discard either side's work without a recoverable version. Detection of a conflict raises the notification kind `sync.conflict` of capability `notifications` on the device that holds the branch. [NEW]

#### Scenario: Keep this device's version
- **WHEN** the user chooses (a) with local branch from base 80 and host `head` 95
- **THEN** `head` becomes 96 with the device's state, and the version list contains "Replaced on …" holding revision 95

#### Scenario: Keep the host version
- **WHEN** the user chooses (b)
- **THEN** the working copy equals revision 95 and the local version list contains "Local changes from …" which can be restored or saved as a copy within 30 days

#### Scenario: Save mine as a copy
- **WHEN** the user chooses (c)
- **THEN** two projects exist: the original at revision 95 and a new project with the local state, both referencing the same media without re-uploading bytes

#### Scenario: Not now
- **WHEN** the user chooses (d) and keeps editing
- **THEN** further edits extend the local branch, nothing is pushed, and the badge remains until a choice (a), (b) or (c) is made

#### Scenario: Compare
- **WHEN** the user chooses "Compare"
- **THEN** two view-only players open side by side, labelled "This device" and "Host", and scrubbing one moves the other to the same time

#### Scenario: Lease held by another device during choice (a)
- **WHEN** the user chooses (a) while another device is editing
- **THEN** the dialog shows "<device name> is editing — request to edit first" and no state is changed

### Requirement: Opening a synced project on another device
Opening a document from the host space on a device that lacks it SHALL download the newest snapshot and the operations after it, verify the snapshot's SHA-256, apply the patches, and open the document view-only or editable according to the lease, within 3 seconds for a project of up to 2 000 elements on a 20 Mbit/s link, excluding media. Media SHALL then be fetched per `cross-device-sync.Media sync policy by platform`; until a clip's media is present the clip SHALL render the placeholder defined in `cross-device-sync.Missing media presentation`. A document whose `schemaVersion` is newer than the app supports SHALL NOT be opened and SHALL show "Update JAgentChill on this device to open this project". A document at an older schema is migrated under `cross-device-sync.Schema version skew`. "Look for it on <host>" on the project-not-found screen of capability `projects` SHALL call `jagentchill.sync.project.get` and open the project when found or show "Not on <host> either". [CAPCUT CC-265] [NEW]

#### Scenario: First open on a phone
- **WHEN** a user taps a synced 300-element project on a phone for the first time
- **THEN** the timeline structure is visible within 3 seconds and media placeholders fill in as proxies arrive

#### Scenario: Corrupt snapshot
- **WHEN** the downloaded snapshot's hash does not match
- **THEN** the client retries once, then shows "Unable to download this project" with "Retry", and writes nothing to local storage

#### Scenario: Newer schema
- **WHEN** the project's `schemaVersion` is higher than the app's
- **THEN** the project does not open and the update message is shown

### Requirement: Schema version skew
Schema skew SHALL be handled per document kind, because each synced kind has its own schema line: video projects (`project-document.Evolution rules`, schema 32 at first release), scripts (`schemaVersion` owned by capability `script-studio`, 1 at first release) and workflow documents (`schemaVersion` owned by capability `agent-workflows`). The server SHALL advertise `maxSchemaVersion: { project, script, workflow }` — per kind, the highest schema its document code, agent tools and (for projects) render host understand — in the `ready` frame, and every `jagentchill.sync.doc.get` / `jagentchill.sync.project.get` response SHALL carry the document's `kind`, `schemaVersion` and `minReaderSchemaVersion` beside the host's maximum for that kind; a comparison SHALL always be made between values of the same kind (a script batch is never compared with the project maximum). **Projects and scripts** (operation log): a device SHALL NOT push operations or a snapshot whose `schemaVersion` exceeds the host's maximum for that kind — the server refuses such a batch with `SCHEMA_TOO_NEW` and `details { kind, max }` — so the document stays at the old schema on the server, the device keeps a local migrated branch, and the status reads "Update the host to sync this project" (or "…this script"). A document at an older schema SHALL be migrated locally only by the lease holder; before the holder pushes a schema-raising snapshot it SHALL show a confirmation listing the devices paired with the host and seen in the last 30 days whose last reported app supports only a lower schema of that kind ("These devices will need an update to open this project"), and push only after "Continue". Devices report their supported schema version per kind in presence. What an older app does with a newer document is decided by the document's `minReaderSchemaVersion` (for projects computed per document from the breaking features present, `project-document.Minimum reader version`; for scripts declared by `script-studio`): an app whose schema for that kind is at least `minReaderSchemaVersion` SHALL open the document read-write, preserve every field it does not know byte-for-byte in the patches it emits (`project-document.Unknown-field preservation`), and push operations whose `schemaVersion` is the document's (not the app's); an app below it SHALL open the document view-only with the status "Update JAgentChill on this device to edit this project" and SHALL never acquire the lease for it (`SCHEMA_TOO_NEW` when it tries). The confirmation above lists only devices that would become view-only. **Workflow documents** (host-authoritative, no lease): the host stores a workflow at its own schema; a client whose workflow schema is lower than the document's `minReaderSchemaVersion` opens it view-only with the outline and run overlay and the status "Update JAgentChill on this device to edit this workflow", its graph operations are refused with `SCHEMA_TOO_NEW`, and unknown node types and fields are shown as generic nodes and preserved; a client whose workflow schema is higher than the host's maximum sends only operations expressible at the host's schema, hides the node types the host does not know, and shows "Update the host to use newer workflow features"; a workflow file imported at a schema above the host's maximum is refused with `SCHEMA_TOO_NEW`. Host-side writers (agent tools, runs) always write at the document's current schema. [NEW]

#### Scenario: Phone updated before the host
- **WHEN** a phone whose app writes project schema 33 opens a synced project on a host whose `maxSchemaVersion.project` is 32 and edits it
- **THEN** nothing with schema 33 is pushed, the project on the host stays at schema 32, and the phone shows "Update the host to sync this project"

#### Scenario: Script batch is compared with the script maximum
- **WHEN** a device pushes a script batch with `schemaVersion` 2 to a host whose `maxSchemaVersion` is `{ project: 32, script: 1, workflow: 1 }`
- **THEN** the batch is refused with `SCHEMA_TOO_NEW` and `details { kind: "script", max: 1 }`, although 2 is below the project maximum

#### Scenario: Confirmation before a schema-raising push
- **WHEN** the lease holder is about to push the first schema-33 snapshot and one paired tablet seen 3 days ago supports only schema 32
- **THEN** a confirmation names that tablet and nothing is pushed until the user chooses "Continue"

#### Scenario: Older device after the push
- **WHEN** the tablet (schema 32) then opens the project, whose `minReaderSchemaVersion` is 33
- **THEN** it opens view-only with "Update JAgentChill on this device to edit this project", a lease request answers `SCHEMA_TOO_NEW`, and its local copy is unchanged

#### Scenario: Additive schema step
- **WHEN** a laptop whose app writes schema 33 opens a project at schema 34 whose `minReaderSchemaVersion` is 33 and moves a clip
- **THEN** the edit is pushed with `schemaVersion` 34, and the fields introduced by schema 34 are byte-identical in the document before and after

#### Scenario: Older client opens a newer workflow
- **WHEN** a phone whose workflow schema is 1 opens a workflow whose `minReaderSchemaVersion` is 2
- **THEN** the workflow opens view-only with its run overlay, a node-move operation answers `SCHEMA_TOO_NEW`, and the document on the host is unchanged

#### Scenario: Newer client, older host, workflow
- **WHEN** a desktop app with workflow schema 2 edits a workflow on a host whose `maxSchemaVersion.workflow` is 1
- **THEN** the palette omits node types introduced by schema 2 with the notice "Update the host to use newer workflow features", and every operation it sends is accepted

### Requirement: Content-addressed media blobs
Every media file SHALL be identified on the server by the lowercase hex SHA-256 of its bytes. Before uploading, a client SHALL compute the hash off the UI thread (mobile: `JagentchillCrypto.sha256File`) and call `POST /jagentchill/v1/blobs/{sha256}/init` with `{ size, mime, name, chunkSize }`; when the blob already exists complete, the server SHALL answer `{ exists: true }` and the client SHALL upload nothing. A media asset record in a document SHALL reference `{ sha256, size, mime, name, duration_ticks?, width?, height? }`; names are metadata and two assets with the same bytes SHALL share one blob. The maximum blob size SHALL be 68 719 476 736 bytes (64 GiB); a larger file SHALL be refused locally with "This file is too large to sync (limit 64 GB)" (`BLOB_TOO_LARGE` when attempted) and SHALL stay usable locally. The same blob protocol carries workspace uploads, skill uploads and attachments of other capabilities. [NEW]

#### Scenario: Duplicate file
- **WHEN** two projects import the same 800 MB file and sync
- **THEN** the second `init` answers `exists: true`, no chunk is uploaded, and the server stores the bytes once

#### Scenario: Hashing does not freeze the UI
- **WHEN** a 4 GiB file is hashed on the reference desktop
- **THEN** the UI keeps responding with no frame longer than 100 ms attributable to hashing, and a progress value is shown

#### Scenario: Oversized file
- **WHEN** a 70 GiB file is in a synced project
- **THEN** it is not uploaded, the asset shows "Too large to sync", and other devices see the missing-media placeholder with that reason

### Requirement: Chunked resumable upload
Uploads SHALL use fixed chunks of 4 194 304 bytes (the last chunk smaller), each sent with `PUT /jagentchill/v1/blobs/{sha256}/chunks/{index}` whose body hash is covered by the request signature. Up to 3 chunks SHALL be in flight per blob and up to 2 blobs per device. `GET /jagentchill/v1/blobs/{sha256}/status` SHALL return `{ state, size, receivedChunks[], variants: { <variant>: { size, sha256 } } }`; after any interruption (connection loss, app restart, device sleep) the client SHALL query it and send only missing chunks. A failed chunk SHALL be retried up to 5 times with delays of 1, 2, 4, 8 and 16 seconds before the blob transfer is marked "Failed" with a "Retry" action. `POST /jagentchill/v1/blobs/{sha256}/complete` SHALL make the server verify the SHA-256 of the assembled file: on match the blob becomes available; on mismatch the server SHALL delete all chunks and answer `BLOB_HASH_MISMATCH`; `complete` with chunks missing answers `BLOB_INCOMPLETE` with `details.missing[]`, and a chunk index beyond the declared size answers `CHUNK_OUT_OF_RANGE`. Re-sending a chunk already stored SHALL succeed without storing it twice. An `init` that the quota or free disk space cannot hold answers `QUOTA_EXCEEDED` as defined by `server-api.Host storage accounting and cleanup`. [NEW]

#### Scenario: Resume after connection loss
- **WHEN** a 1 GiB upload is interrupted after 100 of 256 chunks
- **THEN** after reconnecting the client uploads only the remaining 156 chunks and `complete` succeeds

#### Scenario: Resume after app restart
- **WHEN** the app is quit mid-upload and reopened
- **THEN** the transfer resumes automatically from the server's status without rehashing chunks already confirmed

#### Scenario: Hash mismatch
- **WHEN** the assembled bytes do not hash to `{sha256}`
- **THEN** `complete` returns `BLOB_HASH_MISMATCH`, no blob is published, and the client restarts the upload once before reporting failure

#### Scenario: Complete with a gap
- **WHEN** `complete` is called while chunk 7 was never received
- **THEN** the response is `BLOB_INCOMPLETE` with `details.missing` containing 7

#### Scenario: Chunk retries exhausted
- **WHEN** one chunk fails 5 consecutive times
- **THEN** the transfer shows "Failed" with "Retry", and other blobs continue

### Requirement: Chunked resumable download
Downloads SHALL request `GET /jagentchill/v1/blobs/{sha256}` (or a variant route) in ranges of 4 194 304 bytes with up to 3 ranges in flight, writing directly to the platform media store of capability `project-storage` (OPFS on web, the project library folder on desktop, app files on mobile) without holding the whole file in memory. Completed ranges SHALL be recorded so that a download resumes after interruption or restart from the first missing range. On completion the client SHALL verify the SHA-256 of an original against its address and of a variant against the `sha256` reported by `status`, and SHALL discard and re-download once on mismatch. Requests are signed as defined by `server-api.Authenticated media delivery`; no host URL carries a credential. [NEW]

#### Scenario: Resume download
- **WHEN** a 600 MiB download stops at 40 % and the app is reopened
- **THEN** the download continues from the first missing 4 MiB range and the already stored ranges are not requested again

#### Scenario: Memory bound
- **WHEN** a 2 GiB original downloads on the reference phone
- **THEN** the app's memory attributable to the transfer stays at or below 64 MiB

#### Scenario: Corrupted variant
- **WHEN** a downloaded proxy does not hash to the `sha256` reported for that variant
- **THEN** the client discards it, downloads it once more, and shows "Download failed — Retry" if the second copy also mismatches

#### Scenario: Insufficient local space
- **WHEN** the device lacks space for the file
- **THEN** the download is not started, the asset shows "Not enough space on this device", and proxies continue to be used

### Requirement: Local blob linking
So that a desktop app and the JAgentChill Server it started on the same machine do not store every media file twice, the server SHALL accept `POST /jagentchill/v1/blobs/{sha256}/link { path, size, mtime_ms }` only when the request comes over loopback, without forwarded-for attribution (`server-api.Product listeners and path restriction`), from the device record flagged `localSupervisor` — the flag set by the desktop trust bootstrap and by `devices add-admin --local-supervisor` ("Restore this computer as admin") and carried over by a device key rotation (`device-pairing-signing.Trust bootstrap for the first device`), so linking keeps working after either; any other caller receives `SCOPE_DENIED`. The server SHALL record a linked blob without copying bytes, SHALL re-check `size` and `mtime_ms` on every read, SHALL verify the SHA-256 once in the background within 24 hours of linking, and SHALL serve and read the file in place (including as FFmpeg and render-host input). When the file is missing or changed, the blob SHALL become `unavailable`: routes answer `BLOB_UNAVAILABLE`, other devices show "Not uploaded yet", and the desktop is asked to relink or upload. Linked bytes SHALL NOT count toward `storage.quotaBytes` and SHALL never be deleted by the sweep. Managed desktop media lives as files in the project library folder (`project-storage.Desktop project library folder`), so both managed and referenced-in-place media can be linked; the desktop import default is to reference files in place, and those files are linked, never copied, until the user chooses "Copy media into library". The rule is the same on macOS, Windows and Linux. [NEW]

#### Scenario: Desktop sync without duplication
- **WHEN** the desktop syncs a project with 100 GB of media to its own built-in host
- **THEN** the server's data directory grows by less than 1 GB and `jagentchill.settings.storage.get` reports the media under `linkedBytes`

#### Scenario: Link from a remote device
- **WHEN** a phone sends a `link` request
- **THEN** the response is HTTP 403 `SCOPE_DENIED`

#### Scenario: Linking after a key rotation
- **WHEN** the desktop app rotated its device key, or was restored as admin with a new key, and then links a file
- **THEN** the link is accepted, because the current record carries `localSupervisor`

#### Scenario: Linked file deleted
- **WHEN** the user deletes a linked file in the OS file manager and a phone requests its original
- **THEN** the response is `BLOB_UNAVAILABLE` and the phone shows "Not uploaded yet" for that clip

### Requirement: Media variants and proxies
For each video blob the server SHALL be able to hold these variants addressed by the original's hash: `original`; `preview` (the single proxy format defined by `media-library.Proxy media`: H.264 fitted to 1280×720 or 720×1280, source timestamps preserved; this capability defines no format of its own); `thumb` (longest side 320 px); `waveform` (peak data); and `mezzanine` (an H.264 transcode at source resolution and timestamps, produced by a `media.transcode` job when the render host or a client reports that it cannot decode the original). For audio blobs: `original` and `waveform`; for images: `original` and `thumb`. Each variant has its own `{ size, sha256 }`, reported by `status` and verified by clients. Variants SHALL be produced by the device that imports the media when it is able, and otherwise by a host `media.proxy` job once the original is on the server. The synced `preview` variant is always the 720p format; a device's own lower-resolution local proxy is never uploaded. A proxy SHALL be used only for preview and editing; an export above 720 px output height SHALL use originals (`cross-device-sync.Originals for local export`). A source that is 720 px or smaller in its shorter dimension and whose codec the device can decode SHALL be used directly without a proxy. [NEW]

#### Scenario: Proxy generated on the server
- **WHEN** a 4K original uploaded from the web client has no proxy
- **THEN** a `media.proxy` job produces the `preview` variant and other devices can download it when the job succeeds

#### Scenario: Frame alignment
- **WHEN** a clip from a 60 fps source is trimmed at a frame boundary using the proxy and exported using the original
- **THEN** the exported cut is at the same source frame

#### Scenario: Small source
- **WHEN** the source is 1280×720 H.264
- **THEN** no proxy is created and the original serves as the editing media

#### Scenario: Original the host cannot decode
- **WHEN** the render host reports that it cannot decode an HEVC original
- **THEN** a `media.transcode` job creates the `mezzanine` variant and the export uses it

### Requirement: Media sync policy by platform
Default media policy SHALL be: desktop uploads originals (by linking on its own built-in host) and downloads originals; web uploads originals and downloads proxies; mobile (phone and tablet) uploads originals and downloads proxies (proxy-first), fetching thumbnails and waveforms first so the timeline is populated before any proxy finishes. Downloads SHALL be prioritised: clips under and nearest the playhead first, then the rest of the open document in timeline order, then other documents. Each platform SHALL expose the per-device settings "Download originals automatically" (default on for desktop, off elsewhere), "Sync media over mobile data" (mobile only, default off) and "Upload limit" / "Download limit" (off, or 1 to 100 Mbit/s). With "Sync media over mobile data" off, media transfers SHALL wait for an unmetered connection while document operations (which are small) continue; a transfer larger than 104 857 600 bytes on a metered connection SHALL ask for confirmation even when the setting is on. On desktop, a file referenced in place SHALL be read from its location, and when it is missing the asset SHALL enter the relink flow of `media-library.Offline media and relink` and upload SHALL be skipped. [NEW]

#### Scenario: Phone opens a desktop project
- **WHEN** a phone opens a project with ten 4K clips synced from desktop
- **THEN** thumbnails and waveforms appear first, then 720p proxies download nearest-the-playhead first, and no original is downloaded

#### Scenario: Metered connection
- **WHEN** the phone is on mobile data with the setting off
- **THEN** operations sync, media transfers show "Waiting for Wi-Fi", and a per-item action "Download now" is available

#### Scenario: Bandwidth limit
- **WHEN** the upload limit is 5 Mbit/s
- **THEN** measured upload throughput over any 10-second window stays at or below 5.5 Mbit/s

#### Scenario: Referenced file missing on desktop
- **WHEN** an in-place referenced file was moved before sync
- **THEN** the asset is flagged for relink, is not uploaded, and other devices show the missing-media placeholder with reason "Not uploaded yet"

### Requirement: Originals for local export
When a device starts an on-device export whose output height exceeds 720 px, or whose settings require source quality (the "Use original media" option of capability `export-share`), it SHALL first ensure every referenced original is present locally: the export sheet SHALL list the missing originals with total size, download them with a single progress bar, and begin encoding only when all are verified. The user SHALL be offered, in the same sheet, "Export on host instead" (target row "Host: <name>") (`cross-device-sync.Remote export hand-off`) and "Export at 720p with proxies". When an original does not exist on the server either, the export SHALL NOT start and the sheet SHALL name the files and the device that holds them. [NEW]

#### Scenario: 1080p export on a phone with proxies only
- **WHEN** a user starts a 1080p export on a phone holding only proxies for 3 clips totalling 1.2 GB of originals
- **THEN** the sheet shows "Download 3 originals (1.2 GB)" with the two alternatives, and encoding starts only after the downloads verify

#### Scenario: Original not on the server
- **WHEN** one original was never uploaded
- **THEN** the sheet shows "1 file is only on <device name>" and the export button is disabled until it is uploaded or the user picks 720p with proxies

### Requirement: Missing media presentation
A timeline element whose media is not on the device SHALL be drawn with its real duration, name and (when available) thumbnail strip, overlaid with a cloud glyph and one of the states "Downloading n%", "Waiting for Wi-Fi", "Not uploaded yet", "Too large to sync", "Not enough space on this device", "Host storage full" or "Download failed — Retry". In the preview such an element SHALL render as a neutral placeholder frame carrying the asset name, never as a black frame without explanation. An element using a proxy SHALL carry a "Proxy" badge in the inspector, and the preview shows the single "Reduced preview quality" chip of capability `render-engine`. Tapping or clicking the overlay SHALL open the transfer actions (Download now, Download original, Retry, Cancel). [NEW]

#### Scenario: Clip waiting for download
- **WHEN** a clip's proxy is 35 % downloaded
- **THEN** the clip shows "Downloading 35%" and the preview shows the placeholder frame with the asset name

#### Scenario: Download finishes during playback
- **WHEN** the proxy completes while the project is open
- **THEN** the clip's frames appear in the preview within 1 second without reopening the project

#### Scenario: Screen reader
- **WHEN** a screen reader focuses a clip that is waiting for Wi-Fi
- **THEN** it announces the clip name followed by "media not downloaded, waiting for Wi-Fi"

### Requirement: Sync status and activity
Every synced document SHALL show one status in the project list and editor header: "Synced" (revision equals `head`, no pending transfers), "Syncing" (operations or media in transit, with a count), "Offline changes (n)", "Sync paused — conflict", "Viewing — <name> is editing", "Sync paused" (user paused), "Update the host to sync this project", "Update required to sync", "Sync error — host storage is full" (with "Manage storage", shown when a media upload received `QUOTA_EXCEEDED`; operations still sync) or "Sync error" (with the error text and "Retry"). A sync activity panel SHALL list active and recent transfers (name, direction, size, percentage, speed, time remaining) with per-item Pause, Resume and Cancel and a global "Pause all sync" switch that persists across restarts. Status SHALL be conveyed by icon and text, not colour alone, and SHALL update within 1 second of the underlying change. On mobile the activity panel SHALL be a bottom sheet opened from the status chip. The save-state indicator of the editor is owned by capability `projects` and consumes these states. [CAPCUT CC-265] [NEW]

#### Scenario: Status progression
- **WHEN** a user makes an edit online
- **THEN** the status shows "Syncing" and returns to "Synced" within 2 seconds of the server accepting the operation

#### Scenario: Pause all
- **WHEN** the user turns on "Pause all sync"
- **THEN** no operation is pushed and no media transfers until it is turned off, and every synced document shows "Sync paused"

#### Scenario: Cancel one upload
- **WHEN** the user cancels one media upload
- **THEN** that transfer stops within 1 second, its received chunks remain resumable for 7 days, and other transfers continue

#### Scenario: Host storage full
- **WHEN** a media upload is refused with `QUOTA_EXCEEDED`
- **THEN** the project shows "Sync error — host storage is full" with "Manage storage", its edits keep syncing, and other devices show "Host storage full" on the affected clips

### Requirement: Deletion, trash and removal from the Gateway
Deleting a synced document on a device that holds the lease or when the lease is free SHALL move it to the host "Trash" and to the local trash, and every other device SHALL show it as "Deleted on <device name>" and move its local copy to local trash on next sync. A document in the host trash SHALL be restorable for 30 days and SHALL then be purged with its operations and snapshots; blobs are purged by `server-api.Host storage accounting and cleanup` when unreferenced. "Remove from host" SHALL delete only the server copy and leave every device's local copy as "On this device only". Deleting while another device holds the lease SHALL be refused with "<device name> is editing this project". A deletion made offline SHALL be recorded as a pending tombstone and applied on reconnect only if `head` equals the device's base revision and no lease is held; otherwise the document is restored locally with the notice "Changed on another device — not deleted". A sync call for a document the server has purged SHALL answer `PROJECT_PURGED`, and the device SHALL convert its copy, including any offline branch, to "On this device only"; a call for a document in the host trash answers `PROJECT_IN_TRASH`. Permanent deletion from the host trash before 30 days requires scope `jagentchill.devices.manage`. Deleting a media asset from a document is an ordinary operation and does not delete the blob while any document, version or trash entry references it. The host trash is typed with the kinds of `projects.Trash`: `project`, `script` and `template` entries are created by this requirement for synced documents and library templates; `workflow-run`, `film` and `film-panel-asset` entries are host-only and are sent to the trash by their owners (`agent-workflows`, `film-production`) by calls inside the server, never by a client RPC; every kind has the same 30-day retention, the same restore and purge methods (`cross-device-sync.Sync RPC surface`) and the same scope rule, and restoring a host-only entry returns it to its owner's store. [CAPCUT CC-264] [NEW]

#### Scenario: Delete propagates
- **WHEN** a project is deleted on the desktop
- **THEN** on its next sync the phone moves its copy to local trash and shows a one-time notice "Deleted on <desktop name>" with "Restore"

#### Scenario: Delete while another device edits
- **WHEN** device A tries to delete a project device B is editing
- **THEN** the deletion is refused with the message naming device B

#### Scenario: Offline delete of a project that changed
- **WHEN** a laptop deletes a project offline at base revision 80 and reconnects when `head` is 85
- **THEN** the project is restored on the laptop at revision 85 with the notice "Changed on another device — not deleted"

#### Scenario: Return after purge
- **WHEN** a device with an offline branch reconnects 40 days after the project was trashed on the host
- **THEN** its sync call answers `PROJECT_PURGED` and the project becomes "On this device only" with the offline changes kept

#### Scenario: Purge after retention
- **WHEN** a trashed project is 31 days old
- **THEN** it is absent from "Trash" and cannot be restored

### Requirement: Named versions
The single "Version history" panel is owned by `project-storage.Version snapshots`; this requirement defines its host side. For a synced document, "Save version" (name 1 to 80 characters; scope `jagentchill.projects.write`) SHALL create a host named version at the current revision in addition to the local snapshot, and named versions created on other devices SHALL be listed with a device badge. Users with `jagentchill.projects.write` SHALL be able to rename, restore and delete host versions. Restoring a version of a synced document SHALL require the lease and SHALL be recorded as a new revision whose state equals the version (history is never truncated). Versions created by conflict resolution SHALL expire after 30 days unless the user renames them, which makes them permanent. The list SHALL show name, revision, time, author name and a thumbnail. [NEW]

#### Scenario: Restore
- **WHEN** the lease holder restores "Rough cut v1" (revision 120) while `head` is 300
- **THEN** `head` becomes 301 with the state of revision 120, and viewers update within 1 second

#### Scenario: Restore without the lease
- **WHEN** a view-only device chooses Restore
- **THEN** the action is disabled with "Request to edit to restore a version"

#### Scenario: Version from another device
- **WHEN** a version is saved on the desktop
- **THEN** the phone's version history lists it with the desktop's device badge within 5 seconds of being connected

### Requirement: Remote export hand-off
The remote-export contract — the methods `jagentchill.export.create`, `.get`, `.list`, `.cancel` and `.delete`, the job kind `export.remote`, progress through `jagentchill.job.updated`, the download route, retention, settings and the "Exports" section content — is owned by capability `export-share` (`export-share.Remote export contract`, `export-share.Gateway export hand-off`, `export-share.Gateway export progress and control`, `export-share.Gateway export download`) and is not restated here. This capability defines only the sync pre-conditions a client SHALL satisfy before it calls `jagentchill.export.create`: (1) all pending operations are pushed and the client's revision equals `head`; a document on a conflicted or schema-blocked branch SHALL be refused with the conflict flow instead; (2) every referenced original, font, LUT and other asset blob is complete (stored or linked) on the server, with missing ones uploaded first under visible progress ("Uploading n files before export"); (3) the request names the exact `revision`, which the job renders even if the document changes afterwards. The option SHALL be offered only while the server advertises the feature `remote-export` (`server-api.Feature flag registry`); otherwise it is disabled with the reason "This host cannot export" and the cause reported by health. [NEW]

#### Scenario: Missing originals uploaded first
- **WHEN** two originals exist only on the phone and the user chooses "Export on host" with the target "Host: <name>"
- **THEN** the sheet shows "Uploading 2 files before export" with progress, and `jagentchill.export.create` is called only after both blobs are complete

#### Scenario: Unpushed operations
- **WHEN** the client has 3 unpushed operations when the user confirms the remote export
- **THEN** the operations are pushed first and the request carries the resulting `head` as `revision`

#### Scenario: Conflicted project
- **WHEN** the project is in the "Sync paused — conflict" state
- **THEN** the remote export option opens the conflict dialog and no job is created

#### Scenario: Host cannot export
- **WHEN** the feature `remote-export` is false because the render host is unavailable
- **THEN** the "Export on host" option is disabled with the reason "This host cannot export: the render host is not available"

### Requirement: Continuity across devices
For each synced project the server SHALL store, outside the op log, a per-device continuity record `{ deviceId, sceneId, playhead_ticks, updated_ms }` written at most once every 5 seconds while the project is open and on close. When a project is opened on a device and another device's record is newer than this device's own by more than 60 seconds, the editor SHALL show a dismissible chip "Continue where you left off on <device name>" for 10 seconds; activating it SHALL switch to that scene and move the playhead to that tick. The project list on every device SHALL show the same last-modified time and last author for a synced project. [CAPCUT CC-265] [NEW]

#### Scenario: Continue from the desktop position
- **WHEN** a user stops at 00:42:10 on desktop and opens the project on a phone 5 minutes afterwards
- **THEN** the chip appears, and tapping it moves the phone's playhead to the same tick in the same scene

#### Scenario: Chip ignored
- **WHEN** the user does not interact for 10 seconds
- **THEN** the chip disappears and the playhead stays at this device's last position

### Requirement: Library item sync
User-created reusable items — saved presets, text templates, project templates, script formats, imported LUT files, imported fonts and imported sticker packs — SHALL sync through the server as an index of `{ itemId, kind, name, updated_ms, serverUpdated_ms, blobSha256?, payload }` plus blobs. Conflicts are resolved last-writer-wins per item by `serverUpdated_ms`, the time assigned by the server when it accepts a write (device clocks are not compared); deletion is a tombstone retained 30 days. A write whose `baseServerUpdated_ms` is older than the stored value SHALL be accepted as the new value and the replaced value SHALL be kept as "<name> (conflict <device name>)". Library sync SHALL be controlled by one per-device setting "Sync my library" (default on) and requires scope `jagentchill.media.write` to upload. Bundled library content SHALL NOT be uploaded. Imported fonts sync only between the user's own devices and host, under the redistribution rule of capability `text-and-titles`. [NEW]

#### Scenario: Preset appears on another device
- **WHEN** a user saves a colour preset on desktop
- **THEN** it is available in the phone's preset list within 5 seconds of the phone being connected

#### Scenario: Concurrent rename offline
- **WHEN** two devices rename the same preset differently while offline and then sync, the phone second
- **THEN** the phone's name is kept and an item "<desktop's name> (conflict <desktop name>)" exists

#### Scenario: Skewed device clock
- **WHEN** a device whose clock is one day behind renames an item after another device renamed it
- **THEN** its rename wins because it reached the server last

### Requirement: Review comments
Any paired device with scope `jagentchill.comments.write` (roles `viewer`, `editor`, `admin`) SHALL be able to add review comments to a synced project, a synced script or an entry under "Exports", without holding the edit lease. A comment SHALL have `{ commentId, targetType (project | script | export), targetId, revision?, time_ticks?, anchor?, point? { x, y } in normalised canvas coordinates 0–1, body (1 to 2000 characters), authorDeviceId, authorName, created_ms, edited_ms?, resolved, parentId? }`, where `anchor` is the script anchor defined by capability `script-studio` for target type `script` (comment target types are exactly `project`, `script` and `export`; workflows have no review comments); replies SHALL nest one level. Comments SHALL be stored outside the op log, managed with `jagentchill.comment.list | create | update | delete | resolve`, announced with `jagentchill.comment.changed` to subscribers within 1 second, and shown as markers on the timeline ruler and on the export player's scrubber; selecting a comment SHALL seek to its time and, when it has a point, draw a pin on the canvas. The author SHALL be able to edit or delete their own comment; devices holding `jagentchill.projects.write` SHALL be able to resolve, reopen and delete any comment. A comments panel SHALL filter by Open, Resolved and All, and show an empty state "No comments yet". The author name SHALL be the device name unless the user set a display name in preferences. [CAPCUT CC-271] [NEW]

#### Scenario: Viewer leaves a timed comment
- **WHEN** a `viewer` adds "Trim this pause" at 00:12:04 with a canvas pin
- **THEN** the editing device shows a marker at that time within 1 second, and selecting it seeks there and shows the pin

#### Scenario: Resolve
- **WHEN** the editor resolves the comment
- **THEN** it moves to the Resolved filter on every device and its timeline marker is hidden while the filter is Open

#### Scenario: Comment too long
- **WHEN** the body exceeds 2000 characters
- **THEN** the Send control is disabled and the counter shows the excess in the error colour

#### Scenario: Comment made offline
- **WHEN** a comment is written while disconnected
- **THEN** it is shown locally with a "Pending" label and is sent on reconnect without duplication

#### Scenario: Comment on a script
- **WHEN** a `viewer` comments on a line of a synced script
- **THEN** the comment is stored with `targetType` `script` and appears in the script's comment margin on other devices within 1 second

### Requirement: Presence
There SHALL be one presence mechanism for the whole product, owned here and consumed by capability `notifications` (attention routing) and capability `chat-agent`: each connected client calls `jagentchill.presence.heartbeat { deviceType, appVisible, focusedSessionId?, openDoc?: { kind, id }, mode?: "editing" | "viewing", sceneId?, playhead_ticks?, visibleRange?, supportedSchemaVersion, lastActivity_ms }` every 10 000 ms and immediately on a change of any field other than the playhead fields (which are sent at most 4 times per second while another device follows); an entry is stale 30 000 ms after its last heartbeat. Changes are announced with `jagentchill.presence.changed` on stream `presence:<kind>:<id>` for an open document and `presence:host` for attention routing. While a synced document is open, each present device SHALL appear in a presence strip in the editor header as an avatar (initial of the device name on a colour derived from `deviceId`) with a tooltip of device name, role and "Editing" or "Viewing"; a host principal holding the lease appears as an agent avatar labelled "Editing". Up to 5 avatars SHALL be shown, with a "+n" overflow that opens the full list. Presence data SHALL NOT be persisted. [NEW]

#### Scenario: Second device joins
- **WHEN** a phone opens a project the desktop is editing
- **THEN** both devices show two avatars within 2 seconds, the desktop's labelled "Editing" and the phone's "Viewing"

#### Scenario: Device leaves
- **WHEN** the phone closes the project
- **THEN** its avatar disappears from the desktop within 30 seconds

#### Scenario: Single heartbeat
- **WHEN** traffic of a client with a project and a chat session open is captured for 60 seconds
- **THEN** exactly one kind of periodic presence call is present, `jagentchill.presence.heartbeat`, at 10-second intervals

### Requirement: Sync access control
Sync RPCs and blob routes SHALL require these scopes of `server-api.JAgentChill scope registry`: reading documents, operations, snapshots, versions and comments — `jagentchill.projects.read`; pushing operations, acquiring or transferring leases, versions, deletion and enablement — `jagentchill.projects.write`; blob download — `jagentchill.media.read`; blob upload and library items — `jagentchill.media.write`; comments — `jagentchill.comments.write`; forced takeover and permanent deletion from the host trash — `jagentchill.devices.manage`. A host is one trust domain for synced documents: there SHALL be no per-project access lists, and every paired device sees all synced documents within its role. Agent sessions are not synced documents and are governed by `server-api.Session ownership and visibility`; biometric indexes are never synced (`security-privacy.Biometric grouping is opt-in`). Invitation of another person SHALL be done by pairing that person's device with a chosen role (`device-pairing-signing.Approval, role assignment and decline`). [CAPCUT CC-267, CC-268] [NEW]

#### Scenario: Viewer pulls operations
- **WHEN** a `viewer` device calls `jagentchill.sync.ops.pull`
- **THEN** the call succeeds

#### Scenario: Viewer requests the lease
- **WHEN** the same device calls `jagentchill.sync.lease.acquire`
- **THEN** the response is `SCOPE_DENIED` with `details.requiredScope` `jagentchill.projects.write`

#### Scenario: Editor purges trash
- **WHEN** an `editor` chooses "Delete permanently" in the host trash
- **THEN** the action is disabled with the role tooltip, and calling the RPC directly returns `SCOPE_DENIED`

### Requirement: Sync RPC surface
The channel P methods and events of the domains `sync`, `blob`, `trash`, `comment` and `presence` (`server-api.RPC domain ownership`) SHALL be exactly those listed in this requirement; media bytes use the blob routes of `server-api.Signed HTTP route surface` and are not RPCs. Every method that names a document takes `doc: { kind, id }` with `kind` `project` or `script`. **`sync`** — reads (scope `jagentchill.projects.read`): `jagentchill.sync.project.list` (synced video projects of the host space), `jagentchill.sync.doc.list { kind }`, `jagentchill.sync.project.get` and `jagentchill.sync.doc.get` (head revision, `schemaVersion`, `minReaderSchemaVersion`, lease, snapshot reference), `jagentchill.sync.ops.pull`, `jagentchill.sync.version.list`, `jagentchill.sync.subscribe` and `jagentchill.sync.unsubscribe`; writes (scope `jagentchill.projects.write`): `jagentchill.sync.doc.enable` and `jagentchill.sync.doc.disable { doc, removeHostCopy }` (`cross-device-sync.Per-project sync enablement`), `jagentchill.sync.ops.push`, `jagentchill.sync.snapshot.commit`, `jagentchill.sync.lease.acquire`, `.sync.lease.heartbeat`, `.sync.lease.release`, `.sync.lease.requestTakeover`, `.sync.lease.answerTakeover { accept }`, `.sync.lease.transfer { toDeviceId }`, `jagentchill.sync.applyRemote.result`, `jagentchill.sync.conflict.resolve` (`cross-device-sync.Conflict resolution choices`), `jagentchill.sync.version.create`, `.sync.version.rename`, `.sync.version.restore`, `.sync.version.delete`, `jagentchill.sync.library.list`, `.sync.library.put` and `.sync.library.delete` (the last three with scope `jagentchill.media.write`, `cross-device-sync.Library item sync`); and `jagentchill.sync.lease.forceTake` (scope `jagentchill.devices.manage`). **`blob`** — `jagentchill.blob.list` (the "Media" section; paginated, with `variants[]`, `linked`, `refCount`) and `jagentchill.blob.get { sha256 }` (scope `jagentchill.media.read`), `jagentchill.blob.variant.request { sha256, variant }` (asks for a proxy or thumbnail to be produced; scope `jagentchill.media.read`; returns `jobId`), and `jagentchill.blob.delete { sha256 }` (scope `jagentchill.media.write`; refused with `CONFLICT` and `details.refCount` while anything references the blob). **`trash`** — `jagentchill.trash.list { kind? }` (scope `jagentchill.projects.read`), `jagentchill.trash.restore { kind, id }` (scope `jagentchill.projects.write`) and `jagentchill.trash.purge { kind, id }` (scope `jagentchill.devices.manage`). **`comment`** — `jagentchill.comment.list` (scope `jagentchill.projects.read`), `jagentchill.comment.create`, `.comment.update`, `.comment.delete`, `.comment.resolve` (scope `jagentchill.comments.write`, with the author and write-scope rules of `cross-device-sync.Review comments`), `jagentchill.comment.subscribe` and `.comment.unsubscribe`. **`presence`** — `jagentchill.presence.heartbeat`, `jagentchill.presence.list { doc? }`, `jagentchill.presence.subscribe` and `.presence.unsubscribe` (scope `jagentchill.projects.read`). Events: `jagentchill.sync.ops`, `jagentchill.sync.lease` and `jagentchill.sync.snapshot` on stream `sync:<kind>:<id>` (pull RPC `jagentchill.sync.ops.pull`); `jagentchill.sync.applyRemote`, sent only to the connection that holds the lease; `jagentchill.comment.changed` on stream `comment:<targetType>:<targetId>` (pull RPC `jagentchill.comment.list`); `jagentchill.presence.changed` on streams `presence:<kind>:<id>` and `presence:host` (pull RPC `jagentchill.presence.list`). Methods that create a resource (`doc.enable`, `snapshot.commit`, `version.create`, `comment.create`, `library.put`) require an `idempotencyKey`; operation pushes are idempotent by `opId`. Workflow documents use the `workflow` domain of capability `agent-workflows` and none of the methods above except the `blob`, `trash` and `presence` ones. No other method SHALL exist in these five domains. [NEW]

#### Scenario: Viewer reads but cannot push
- **WHEN** a `viewer` device calls `jagentchill.sync.ops.pull` and then `jagentchill.sync.ops.push`
- **THEN** the first succeeds and the second is refused with `SCOPE_DENIED` and `details.requiredScope` `jagentchill.projects.write`

#### Scenario: Restore from the host trash
- **WHEN** an `editor` calls `jagentchill.trash.restore { kind: "script", id }` for a script deleted 3 days ago
- **THEN** the script is back in the "Scripts" section at its last revision and other devices list it within 1 second of their next sync event

#### Scenario: Purge needs the device-management scope
- **WHEN** an `editor` calls `jagentchill.trash.purge` on an entry 2 days old
- **THEN** the response error code is `SCOPE_DENIED` with `details.requiredScope` `jagentchill.devices.manage`

#### Scenario: Deleting a referenced blob
- **WHEN** an `editor` calls `jagentchill.blob.delete` for a blob referenced by one project
- **THEN** the response error code is `CONFLICT` with `details.refCount` 1 and the blob is kept

#### Scenario: Method outside the list
- **WHEN** server code adds a handler `jagentchill.sync.project.subscribe`
- **THEN** the contract test `rpc-ownership` fails and names the method

### Requirement: Sync error codes
Sync SHALL use these domain codes, referenced by the registry of `server-api.RPC error envelope`, each with a localised message in `en`, `vi` and `ja`:

| Code | Raised when | Retryable | Client reaction |
|---|---|---|---|
| `LEASE_HELD` | acquire on a held lease | no | open view-only; show holder |
| `LEASE_NOT_HELD` | push, heartbeat or restore without the current lease | no | switch to view-only; keep ops as an offline branch |
| `REVISION_CONFLICT` | `baseRevision` differs from `head` | no | pull, then fast-forward or raise the conflict flow |
| `SNAPSHOT_REQUIRED` | pull from before the oldest retained operation | no | fetch the named snapshot |
| `PATCH_INVALID` | a patch does not apply | no | keep ops; show "Sync error"; offer "Keep this device's version" |
| `PROJECT_NOT_SYNCED`, `SCRIPT_NOT_SYNCED` | the document has no host copy | no | offer "Sync with <host name>" |
| `PROJECT_IN_TRASH` | the document is in the host trash | no | offer "Restore" |
| `PROJECT_PURGED` | the document was purged | no | convert to "On this device only" |
| `SCHEMA_TOO_NEW` | document or batch schema above what the receiver supports | no | update notice per `cross-device-sync.Schema version skew` |
| `BLOB_HASH_MISMATCH` | assembled bytes do not hash to the address | yes (once) | restart the upload |
| `BLOB_INCOMPLETE` | `complete` with chunks missing | yes | send missing chunks |
| `BLOB_TOO_LARGE` | size above 64 GiB | no | "Too large to sync" |
| `BLOB_UNAVAILABLE` | a linked file is missing or changed | no | "Not uploaded yet" |
| `CHUNK_OUT_OF_RANGE` | chunk index beyond the declared size | no | restart with a fresh `init` |
| `VARIANT_UNAVAILABLE` | variant not produced yet (`details.jobId` when queued) | yes | wait for the job |
| `TAKEOVER_DECLINED` | the holder chose "Keep editing" | no | show "<device name> is still editing" |
| `TAKEOVER_COOLDOWN` | a request within 60 s of a decline | yes (`details.retryAfter_ms`) | disable "Request to edit" for the remainder |

Any sync failure that is not resolved by an automatic retry within 30 seconds SHALL be visible as "Sync error" on the affected document with the message and a "Retry" action; a silent failure is not acceptable. [NEW]

#### Scenario: Variant not ready
- **WHEN** a client requests a proxy that has not been generated
- **THEN** the response is HTTP 404 `VARIANT_UNAVAILABLE` with `details.jobId` when a proxy job is queued, and the client waits for that job instead of failing the clip

#### Scenario: Revision conflict
- **WHEN** a holder pushes with `baseRevision` 41 while `head` is 43
- **THEN** the response is `REVISION_CONFLICT` with `details.head` 43 and no operation is stored

#### Scenario: Project in trash
- **WHEN** a device pushes to a project another device moved to the host trash
- **THEN** the response is `PROJECT_IN_TRASH` and the device offers "Restore"

#### Scenario: Chunk out of range
- **WHEN** a client sends chunk index 300 for a blob declared as 256 chunks
- **THEN** the response is `CHUNK_OUT_OF_RANGE` and nothing is stored

#### Scenario: Persistent push failure
- **WHEN** pushes fail with `INTERNAL` for more than 30 seconds
- **THEN** the document shows "Sync error" with "Retry" and the local operations remain intact
