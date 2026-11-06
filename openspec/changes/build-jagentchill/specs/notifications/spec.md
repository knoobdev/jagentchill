## ADDED Requirements

### Requirement: Notification model
A notification SHALL be a record validated by a Zod schema in `packages/protocol` with the fields `id`, `kind` (one of the kinds of `notifications.Notification event catalogue`), `category`, `severity` (`info`, `success`, `warning`, `error`), `requiresAction` (boolean), `title` (at most 80 characters), `body` (at most 240 characters), `subject` (`{ type, id, hostId? }` with `type` one of `session`, `agent-run`, `script`, `workflow-run`, `film`, `project`, `export`, `device`, `automation`, `workspace`, `terminal`, `provider`, `host`, `app`), `route` (a route path of `app-shell-navigation.Route map`, including its query parameters, from which the deep link of `app-shell-navigation.Deep links and file types` is built; host-scoped subjects always use the `h/<hostId>/…` form), optional `actions` (at most 2, each `{ id, label, intent }`), optional `automationId` (set when the event was raised by a step of an automation run), optional `requestId` (the id of the waiting request — approval, question, plan, proposal, sign-off, pairing request, prompt — set for every `requiresAction` kind, so that one notification corresponds to exactly one request), optional `targetDeviceIds` (when present, the notification is stored for, delivered to and listed for those devices only; set by `sync.edit_requested` and `sync.edit_taken`, which concern the device holding the edit lease, and by any kind raised about one device's own state), `created_ms`, optional `read_ms`, optional `resolved_ms`, `source` (`device` for events produced on this device, `host` for events produced by the server) and `dedupeKey` (constructed as `<kind>:<subject.type>:<subject.id>`, with `:<requestId>` appended when `requestId` is set). Titles and bodies are produced from localisation keys plus parameters and rendered in the receiving device's language; user content such as project or session names is inserted verbatim. Host notifications are stored on the server and delivered, as targeted channel-P events (`jagentchill.notification.created`), to every device paired with that host that passes all three filters: (1) it holds the scope the kind requires; (2) it is in `targetDeviceIds` when that field is present; (3) when the subject is a session, or a request raised inside a session, the device is permitted to read that session — sessions are private by default, so only the owner's devices receive its notifications until the session is shared with the host (`chat-agent` session access, `jagentchill.session.access.set`), and notifications of a workspace-class session reach `admin` devices and the owning device only. The same three filters apply to `jagentchill.notification.list`, to counts and to push. Device notifications exist only on the device that produced them and work without a host. All notification traffic uses channel P; no device holds an OpenClaw scope, and the action buttons of a notification call the server's `jagentchill.*` methods, which check the device's role and the session's ownership before resolving the request. [JAD] [NEW]

#### Scenario: Localised on the receiving device
- **WHEN** a host notification "session finished" is delivered to a phone set to Vietnamese and a desktop set to English
- **THEN** each device renders the title and body in its own language with the same session name

#### Scenario: Device notification without a host
- **WHEN** an on-device export finishes in local-only mode
- **THEN** a notification with `source: device` is created and shown on that device

#### Scenario: Route is host-scoped
- **WHEN** a session of host `abc` finishes
- **THEN** the notification's `route` is `h/abc/sessions/<sessionId>` and its `dedupeKey` is `agent.finished:session:<sessionId>`

#### Scenario: Private session
- **WHEN** a turn finishes in a session that its owner has not shared with the host, while another editor's tablet is paired
- **THEN** only the owner's devices receive `agent.finished`, and the tablet's inbox, counts and push show nothing for it

#### Scenario: Notification for one device
- **WHEN** a phone asks to take over the edit lease held by the desktop
- **THEN** `sync.edit_requested` carries `targetDeviceIds` with the desktop's id only and no other device lists it

#### Scenario: Unknown kind is rejected
- **WHEN** a component tries to raise a notification whose `kind` is not in the catalogue
- **THEN** schema validation fails, nothing is delivered and the attempt is logged

### Requirement: Notification event catalogue
The system SHALL raise notifications for exactly the kinds of this table, which is the only list of notification kinds in the product; every other capability raises a notification only by naming one of these kinds. "Action" marks kinds with `requiresAction: true`. "Scope" is the `jagentchill.*` scope a device must hold to receive the kind (`device-pairing-signing.Device roles and scopes`); a `requiresAction` kind is delivered with its action buttons only to devices that are permitted to resolve the request — the scope needed to act and, for requests inside a session, the ownership rule of the server (an `editor` resolves file-edit and tool approvals only in sessions it owns; host command execution and terminal-key approvals are resolved by `admin` devices only) — and without buttons to the others. "Push class" is the closed class from which a device picks the fixed title and action set of a push or locked-screen notification (`notifications.Mobile push delivery`); it is derived from the kind on the device and is not sent.

| Category | Kind | Action | Push class | Raised when | Raised by | Scope |
|---|---|---|---|---|---|---|
| Agent | `agent.approval_required` | yes | attention | a tool call, permission or human approval-policy card waits | `chat-agent`, `multi-agent-orchestration` | `projects.read` |
| Agent | `agent.question` | yes | attention | an agent asks the user a question, needs a brief clarified, or mentions a person in a room; also raised once when a team run becomes `waiting_human` with reason `stalled` (the watchdog of `multi-agent-orchestration.Team run state machine`), with the body "<role> stopped without finishing — choose what to do" | `chat-agent`, `multi-agent-orchestration` | `projects.read` |
| Agent | `agent.plan_ready` | yes | attention | a plan waits for approval, including a plan of an unattended `plan`-mode session that parked its run | `chat-agent` | `projects.read` |
| Agent | `agent.proposal_ready` | yes | attention | a project edit proposal waits for accept or reject, including a proposal of an unattended `edit`-mode session that parked its run | `chat-agent` | `projects.read` |
| Agent | `agent.handoff_pending` | yes | attention | a conversation hand-off between agents waits for the user's decision | `multi-agent-orchestration` | `projects.read` |
| Agent | `agent.dissent_escalated` | yes | attention | a team dissent is escalated to a person | `multi-agent-orchestration` | `projects.read` |
| Agent | `agent.finished` | no | finished | a turn, team run, loop or autonomous run completed | `chat-agent`, `multi-agent-orchestration` | `projects.read` |
| Agent | `agent.failed` | no | failed | a turn, team run, loop or autonomous run failed or was stopped by loop prevention | `chat-agent`, `multi-agent-orchestration` | `projects.read` |
| Script | `script.review_required` | yes | attention | a script version waits for a person's review, or an agent review is escalated | `script-studio` | `projects.read` |
| Script | `script.changes_requested` | no | finished | a reviewer requested changes | `script-studio` | `projects.read` |
| Script | `script.approved` | no | finished | a script version was approved (by a person, a reviewer agent or the automatic policy) | `script-studio` | `projects.read` |
| Script | `script.proposal_ready` | yes | attention | an agent's script proposal waits for the user | `script-studio` | `projects.read` |
| Workflow and film | `workflow.approval_required` | yes | attention | a workflow sign-off waits for a person: an `approval` node, a `human_input` node, a candidate selection, a step review, an agent's hand-off to a person, or a run parked because nobody was available to sign off | `agent-workflows`, `prompt-to-video-workflow` | `projects.read` |
| Workflow and film | `workflow.paused` | yes | attention | a workflow run, a team run or a film run paused on a budget, a missing route of a required role or a provider account problem (`pauseReason` `budget_exceeded`, `no_route` or `provider_account` of `agent-workflows.Run state machine`; a missing provider consent is not a pause — it is a consent card on the waiting node, announced by `workflow.approval_required` —; team runs pause with the same reasons per `multi-agent-orchestration.Team run state machine`) | `agent-workflows`, `multi-agent-orchestration`, `film-production`, `generation-providers` | `projects.read` |
| Workflow and film | `workflow.finished` | no | finished | a run succeeded (raised again, as a new notification, each time a reopened run reaches `succeeded`, `agent-workflows.Run state machine`) | `agent-workflows` | `projects.read` |
| Workflow and film | `workflow.failed` | no | failed | a run failed (raised again when a reopened run fails) | `agent-workflows` | `projects.read` |
| Workflow and film | `workflow.notify` | by `level` | notice or attention (by `level`) | a `notify` node ran; title, body, level (`info` → no action, `attention` → action) and target come from the node | `agent-workflows` | `projects.read` |
| Workflow and film | `film.step_review_required` | yes | attention | a film step waits for review | `film-production` | `projects.read` |
| Workflow and film | `film.step_finished` | no | finished | a film step finished | `film-production` | `projects.read` |
| Workflow and film | `film.step_failed` | no | failed | a film step failed | `film-production` | `projects.read` |
| Generation | `generation.batch_finished` | no | finished | all jobs of one batch (a session turn, a workflow run, a film step or a Film Studio batch action) reached a final state; the body states the succeeded and failed counts | `generation-providers` | `projects.read` |
| Generation | `generation.failed` | no | failed | a generation job outside a batch failed | `generation-providers` | `projects.read` |
| Export | `export.finished` | no | finished | an export finished (`target: "device"` or `"gateway"`) | `export-share` | `projects.read` |
| Export | `export.failed` | no | failed | an export failed (`target: "device"` or `"gateway"`) | `export-share` | `projects.read` |
| Devices and sync | `pairing.request` | yes | device | a new device asks to pair | `device-pairing-signing` | `devices.manage` |
| Devices and sync | `pairing.lockout` | no | device | repeated failed pairing attempts from one address triggered the abuse limit | `device-pairing-signing` | `devices.manage` |
| Devices and sync | `device.revoked` | no | device | a device was revoked (sent to the remaining admin devices) | `device-pairing-signing` | `devices.manage` |
| Devices and sync | `device.key_rotated` | no | device | a paired device replaced its signing key (`device-pairing-signing` key rotation, signed by the old key); delivered to `admin` devices with the device name, the time and the one action "Review device", which opens the device's row where "Revoke this device" is offered | `device-pairing-signing` | `devices.manage` |
| Devices and sync | `host.tailnet_expired` | yes | device | the node key of the host's tailnet ingress bridge expired or the bridge needs sign-in again (`server-api.Tailnet ingress bridge`); action "Open Network access"; resolved when the bridge is `ready` again or the tailnet level is turned off | `server-api` | `config.write` |
| Devices and sync | `sync.conflict` | yes | device | an offline branch conflicts with the host revision | `cross-device-sync` | `projects.write` |
| Devices and sync | `sync.edit_requested` | yes | device | another device asks to take over the edit lease this device holds | `cross-device-sync` | `projects.write` |
| Devices and sync | `sync.edit_taken` | no | device | the edit lease this device held was taken | `cross-device-sync` | `projects.write` |
| Usage and storage | `usage.threshold_reached` | no | notice | spending crossed a budget's warning threshold | `generation-providers`, `usage-tracking` | `config.read` |
| Usage and storage | `usage.limit_reached` | yes | notice | a hard-stop budget blocked work | `generation-providers` | `config.read` |
| Usage and storage | `storage.low_space` | no | notice | host storage is low | `server-api` | `config.read` |
| Usage and storage | `storage.quota_exceeded` | no | notice | a host write was refused for quota or disk space | `server-api` | `config.read` |
| Automations | `automation.run_finished` | no | finished | an automation run succeeded and its `notify` setting is `always` | `automations` | `projects.read` |
| Automations | `automation.run_failed` | no | failed | an automation run failed | `automations` | `projects.read` |
| Automations | `automation.waiting` | yes | attention | an automation run is waiting for a person: raised once per parked run, in addition to the parked sign-off's own kind (`automations.Unattended run safety`), and once per run that waits on a cost, consent or tool-permission prompt | `automations` | `projects.read` |
| Automations | `automation.disabled` | no | notice | an automation was disabled: after repeated failures, or because the device that owned it was revoked (the body states the reason, `repeated_failures` or `device_revoked`) | `automations` | `projects.read` |
| Workspaces and terminal | `workspace.archive_pending` | yes | attention | a workspace will be archived in 10 minutes after its pull request was merged (actions "Keep", "Archive now") | `workspaces-terminal` | `config.write` |
| Workspaces and terminal | `terminal.finished` | no | finished | a watched terminal command finished | `workspaces-terminal` | `host.exec` |
| Workspaces and terminal | `terminal.needs_input` | yes | attention | a terminal waits for input | `workspaces-terminal` | `host.exec` |
| Providers | `provider.auth_expiring` | no | notice | a provider sign-in (an OAuth, device-code or setup-token auth profile of `agent-runtimes.Auth profile health`) will expire within 72 hours and cannot be renewed without the user; raised once per profile per expiry; body "Your <vendor> sign-in (<account>) expires <relative time>"; action button "Sign in again" | `agent-runtimes` | `config.write` |
| Providers | `provider.auth_refresh_failed` | yes | attention | the silent refresh of a provider sign-in failed 3 times in a row or was rejected by the vendor (revoked, password changed, plan ended); the profile is skipped by rotation until fixed; action "Sign in again" starts `agent-runtimes.OAuth login through the admin proxy` with the hand-off of `agent-runtimes.Login hand-off per platform`, so it can be completed from a phone or the web app; resolved when the profile is healthy again or removed | `agent-runtimes` | `config.write` |
| Providers | `provider.auth_expired` | yes | attention | a provider credential of any access method expired or was rejected and cannot be refreshed: an OAuth sign-in ("Sign in to <vendor> again"), an API key refused by the vendor ("Replace the <vendor> API key"), or an installed CLI that reports it is signed out ("Sign in to the <vendor> CLI on the host"); the title names the vendor, the account or key label and the access method | `agent-runtimes` | `config.write` |
| Providers | `provider.endpoint_unhealthy` | no | notice | an endpoint used by a default route became `auth-failed`, `quota` or `unreachable`, or a custom provider address was turned off by the host because it failed its safety check (at most one per endpoint per hour; the body names the endpoint and the state) | `agent-runtimes` | `config.write` |
| App | `update.available` | no | update | a desktop update is available | `updates-distribution` | device-local |
| App | `update.ready` | no | update | a desktop update is downloaded | `updates-distribution` | device-local |
| App | `host.update_available` | no | notice | a newer host version (JAgentChill Server with its pinned OpenClaw Gateway) is available for a headless host | `updates-distribution` | `config.write` |
| App | `host.stopped` | no | failed | the built-in host entered `failed` | `desktop-app` | device-local |
| App | `changelog.new_version` | no | update | the app first ran a version with release notes | `updates-distribution` | device-local |

Rules that apply to the whole catalogue: individual generation jobs do not notify on success, and jobs belonging to one batch (same session, workflow run or film step) produce one `generation.batch_finished` stating the counts of succeeded and failed items; when a waiting review belongs to a workflow node, only the more specific kind is raised (`script.review_required` instead of `workflow.approval_required`) — exactly one notification per waiting request, identified by its `requestId`; `terminal.*` and `pairing.*` kinds are delivered only to devices with role `admin`; a notification that carries `automationId` obeys that automation's `notify` setting, except `requiresAction` kinds, which are always raised; and no other event produces a notification — progress updates, individual team members finishing, hand-backs, room posts, stage changes and board updates never do. There is one kind for every workflow sign-off, `workflow.approval_required`; the name `workflow.review_required` is not a kind. A hand-off between agents and an escalated dissent have their own kinds (`agent.handoff_pending`, `agent.dissent_escalated`) and are never folded into `agent.question`. The words "lock" and "remote render" are not used in kind names: the edit lease kinds are `sync.edit_*` and host exports report through `export.*`. [NEW] [JAD]

#### Scenario: Catalogue is closed
- **WHEN** the catalogue contract test enumerates the kinds every capability can raise
- **THEN** the set equals the 52 kinds of this table, or the test fails naming the extra or missing kind

#### Scenario: Stalled team run
- **WHEN** a team run becomes `waiting_human` with reason `stalled`
- **THEN** exactly one `agent.question` notification is raised for the run, with `requestId` set to the stall prompt's id

#### Scenario: Key rotation is reported to admins
- **WHEN** an editor's phone rotates its device key
- **THEN** every `admin` device receives `device.key_rotated` naming the phone, with the action "Review device", and the phone itself and other editors receive nothing

#### Scenario: Batch coalescing
- **WHEN** a film step generates 24 panel images and 22 succeed
- **THEN** exactly one `generation.batch_finished` notification is raised with the body stating 22 succeeded and 2 failed

#### Scenario: Approval required
- **WHEN** an agent requests approval for a tool call
- **THEN** an `agent.approval_required` notification with `requiresAction: true` is raised with the actions "Review" and "Deny"

#### Scenario: Script review inside a workflow
- **WHEN** a workflow's `script` node waits for a person to review a script
- **THEN** one `script.review_required` notification is raised and no `workflow.approval_required` for the same request

#### Scenario: Terminal activity is admin only
- **WHEN** a terminal command finishes while an `admin` phone and an `editor` tablet are paired
- **THEN** only the admin phone receives `terminal.finished`

#### Scenario: Automation that never notifies
- **WHEN** an automation with `notify: "never"` runs a workflow that finishes and exports a video
- **THEN** no `workflow.finished`, `export.finished` or `automation.run_finished` is raised for that run, and a waiting approval in that run still raises `automation.waiting`

#### Scenario: No notification for progress
- **WHEN** an export advances from 10% to 90%
- **THEN** no notification is created

#### Scenario: OAuth sign-in about to expire
- **WHEN** an admin's Anthropic sign-in on the host will expire in 48 hours and cannot be refreshed silently
- **THEN** one `provider.auth_expiring` notification naming Anthropic and the account is delivered to `admin` devices with "Sign in again"

#### Scenario: Refresh failure asks for a new sign-in from a phone
- **WHEN** the refresh of an OpenAI sign-in is rejected and the only present device is an admin's phone
- **THEN** `provider.auth_refresh_failed` is delivered to the phone with "Sign in again", which starts the sign-in hand-off on the phone, and the notification resolves when the profile is healthy

### Requirement: Delivery channels
Each notification SHALL be delivered through up to four channels: **in-app toast** (when the app is open and visible on the device), **in-app inbox** (always), **OS notification** (desktop: Electron notifications; web: the Notifications API after permission; mobile: local notifications while the app is in the background and able to run), and **mobile push** (only when the user has enabled push on that device, per `notifications.Mobile push delivery`). A notification appears at most once per channel per device. The toast for a notification follows `design-system.Toast with undo` with the action "View"; notifications with `requiresAction` use a toast that does not dismiss automatically. Channel selection per category follows `notifications.Notification preferences`. The in-app inbox entry is never suppressed by preferences. [JAD] [NEW]

#### Scenario: App in the foreground
- **WHEN** a workflow finishes while the user is on the Projects screen of the focused window
- **THEN** a toast with "View" appears and an inbox entry is added, and no OS notification is shown

#### Scenario: App in the background on desktop
- **WHEN** the same event occurs while no app window is focused
- **THEN** an OS notification is shown and the inbox entry is added

#### Scenario: Web permission not granted
- **WHEN** the web build has no notification permission
- **THEN** OS notifications are skipped, the inbox and toasts still work, and the Notifications settings page shows "Browser notifications are blocked" with instructions

#### Scenario: Push not enabled
- **WHEN** a phone has not enabled push and the app is not running
- **THEN** nothing is delivered to the phone until the app runs again, and the inbox then contains the notification

### Requirement: Attention routing by presence
The server SHALL decide delivery per device, and send its decision with the notification, from the single presence mechanism of `cross-device-sync.Presence` (heartbeat `jagentchill.presence.heartbeat` every 10 s and on change, stale after 30 s; this capability defines no heartbeat of its own). Raising capabilities always emit their event; all suppression is decided here. For each host notification the server decides per device: (1) if the device is focused on the notification's subject, deliver the inbox entry only, already marked read; (2) if the device's app is focused or visible on another screen, deliver inbox plus toast; (3) if the device's app is hidden or its presence is stale, deliver inbox plus OS notification or push. In addition, when any device paired with this host is focused with user input within the last 30 s, OS and push delivery to the other devices for non-action notifications is delayed by 20 s and cancelled if the notification is read in that time; notifications with `requiresAction` are never delayed by more than 5 s. An `agent.finished` notification for a turn that ran for less than 10 s is delivered to the inbox only. The decision travels in the event: `jagentchill.notification.created {notification, delivery, deliverAfter_ms?}` with `delivery` one of `inbox` (list entry only), `toast` (inbox plus toast) or `os` (inbox plus OS notification, or push when the app cannot run), computed for the receiving device, and `deliverAfter_ms` set for a delayed `os` delivery. A client applies its own channel preferences on top and lowers the level where they say so (for example to `inbox` when the category's OS channel is off) and it never raises the level and never re-derives presence. Read state is one value per host notification: case (1) marks the notification read for the host, so it is read on every device — viewing the subject anywhere counts as having seen it. [JAD] [NEW]

#### Scenario: Viewing the subject
- **WHEN** a session finishes while the user is viewing that session in a focused window
- **THEN** no toast, OS notification or push is sent for it and the inbox entry is created as read

#### Scenario: Active on desktop, phone in pocket
- **WHEN** an export finishes while the user is active on the desktop and reads the toast within 20 s
- **THEN** the phone receives no push for that export

#### Scenario: Nobody present
- **WHEN** an approval is required and all devices are hidden or stale
- **THEN** each device with the channel enabled receives an OS notification or push within 5 s of the event

#### Scenario: Stale presence
- **WHEN** a device sent its last presence heartbeat 31 s ago
- **THEN** it is treated as not present and receives OS or push delivery

#### Scenario: Short turn
- **WHEN** an agent turn finishes after 6 s while no device is focused on the session
- **THEN** the `agent.finished` notification is in the inbox and no toast, OS notification or push is sent

#### Scenario: The decision is carried, not re-derived
- **WHEN** a turn of 6 s finishes and the server sends `jagentchill.notification.created` with `delivery: "inbox"`
- **THEN** every receiving device adds the inbox entry and shows no toast, although each has toasts enabled for the Agent category

#### Scenario: Client lowers but never raises
- **WHEN** the event carries `delivery: "os"` and the device has OS notifications off for that category
- **THEN** the device shows a toast if its app is visible, or only the inbox entry otherwise

### Requirement: Mobile push delivery
Mobile push SHALL be opt-in per device, content-light, and listed as outbound traffic. It is off on every device until the user turns on "Push notifications" on that device in Personal ▸ Notifications and grants the OS permission; the row states, before enabling, that the server will then contact the push service named in the "External hosts" table of `security-privacy.Network egress control` (default off; direction host → push host; data sent `{kind, opaqueId}` and the device's push token). Enabling registers a push token with the server (`jagentchill.notification.push.register`), stored in the server's database bound to the device id; while at least one device of a host has a token, the push host is in the server's effective egress allow-list with purpose `push`, and it is removed when no token remains. The token is deleted when the user turns push off, in the same transaction as device revocation (`device-pairing-signing.Revocation`), on "Forget this host", and when the push service reports it invalid.

A push payload SHALL contain exactly two product fields: `kind` (the notification kind of the catalogue, for example `agent.approval_required`) and `opaqueId` (a random 128-bit id that maps to the notification only on the server; it is not the notification id, the subject id or the request id). It contains no title or body text from the product, no subject, no project, session, script, device or file name, no prompt and no amount; for `workflow.notify` the payload kind is `workflow.notify.attention` or `workflow.notify.info`, the only two payload values that are not a catalogue kind. From `kind` the device derives the push class of the catalogue and shows the fixed localised title of that class — `attention` "Your agent needs you", `finished` "A task finished", `failed` "A task failed", `device` "Device request", `notice` "Storage or usage notice", `update` "Update" — and registers the fixed action set of the kind at delivery time: every kind has "Open"; `agent.approval_required` and `pairing.request` additionally have "Deny"; no kind has an approving action. Choosing "Deny" on the locked screen opens the signed channel-P connection in the background and resolves the request through the owning capability's method; when the host is not reachable within 20 s the action opens the app at the request instead and nothing is resolved. The app fetches the full notification (`jagentchill.notification.get {opaqueId}`) over the signed connection when it wakes or is opened. A kind unknown to an older app version falls back to the title "Update from your host" with "Open" only. There is no setting that adds content to push payloads. Push behaves identically on iOS and Android: the same payload, the same fixed titles, the same opt-in and the same token lifecycle, with the platform's own push transport reached only through the one push service of the egress table. The server sends pushes in batches of at most 100 messages; a failed batch is retried 3 times, after waits of 2 s, 8 s and 30 s, and is then re-queued every 60 s; a notification's push is dropped 600 000 ms after it was raised, and its inbox entry is kept. Push is the only notification path that contacts a service outside the user's own hosts. When `network.offlineMode` is on, or the server cannot reach the push host, push is reported as "unavailable" on the settings row and the other channels continue. The build-time prerequisites (the publisher's push project and platform push credentials) are stated by `updates-distribution.Mobile store distribution`. [JAD] [NEW]

#### Scenario: Off by default
- **WHEN** a phone is paired and the user has not enabled push
- **THEN** the server holds no push token for that device, the push host is absent from the effective egress allow-list and the Network activity view of Personal ▸ Privacy shows no push traffic

#### Scenario: Enabling lists the egress
- **WHEN** the user enables push on a phone
- **THEN** a token is registered, the push host appears in the egress table as enabled with purpose `push`, and the first push request is visible in Network activity

#### Scenario: Content-light payload
- **WHEN** an approval is required for a session named "Client X launch"
- **THEN** the push payload contains only `kind: "agent.approval_required"` and an opaque id, the OS shows "Your agent needs you" with the actions "Open" and "Deny", and neither the payload nor the OS notification contains the session name
- **AND** opening it loads the full notification from the server

#### Scenario: Retry and drop
- **WHEN** the push host is unreachable for 11 minutes after a notification is raised
- **THEN** the batch was attempted at 0 s, 2 s, 10 s and 40 s, re-queued every 60 s afterwards, dropped at 600 000 ms, and the inbox entry exists

#### Scenario: Invalid token
- **WHEN** the push service reports a device token as unregistered
- **THEN** the server deletes that token and sends no further pushes to it until the device registers again

#### Scenario: Revoked device
- **WHEN** a device is revoked
- **THEN** its push token is deleted in the same transaction and it receives no further pushes

#### Scenario: Offline mode
- **WHEN** `network.offlineMode` is on
- **THEN** no request is sent to the push host and the settings row reads "unavailable"

#### Scenario: Outcome-specific title
- **WHEN** pushes arrive for `export.failed` and for `export.finished`
- **THEN** the first shows "A task failed" and the second "A task finished", each with "Open" only

#### Scenario: Deny while the host is unreachable
- **WHEN** the user chooses "Deny" on a locked phone and the host cannot be reached within 20 s
- **THEN** nothing is resolved, the app opens at the request and states that the host is unreachable

#### Scenario: Same behaviour on both mobile systems
- **WHEN** the same `pairing.request` push is delivered to an iPhone and an Android phone
- **THEN** both show "Device request" with "Open" and "Deny" and neither shows the requesting device's name

### Requirement: Notification inbox
The app SHALL provide an inbox opened from the sidebar footer bell (the `wide` popover variant of `design-system.Popover, dropdown menu and context menu`, 380 px, anchored to the bell on medium and wide form factors; the full-screen route `/notifications` on compact ones). It lists notifications newest first, grouped under "Needs your attention" (unresolved `requiresAction` items, always on top) and by day (Today, Yesterday, then dates), each row with a category icon, title, body truncated to 2 lines, relative time, an unread dot, and inline action buttons where defined. Controls: filter tabs (All, Unread, Needs attention), "Mark all as read", per-row "Mark as read/unread" and "Dismiss", and a settings shortcut. Activating a row navigates to its `route` (a route of `app-shell-navigation.Route map`) and marks it read. The list loads 30 items at a time. The inbox retains at most 500 notifications or 30 days per host and per device, whichever is reached first; unresolved `requiresAction` items are retained until resolved. The empty state reads "You're all caught up". Read and dismissed state of host notifications is stored on the server and is the same on all paired devices within 2 s. A merged entry (`notifications.Deduplication and rate limiting`) shows its count; entries of `requiresAction` kinds are never merged, so each row's action buttons act on exactly one request. [NEW]

#### Scenario: Open a notification
- **WHEN** the user activates an "Export finished" row
- **THEN** the app navigates to `/exports/history?job=<jobId>`, which selects that job, the row becomes read and the unread badge decreases by one

#### Scenario: Read state across devices
- **WHEN** the user marks all as read on the desktop
- **THEN** the phone's badge clears within 2 s while connected

#### Scenario: Retention
- **WHEN** a host notification is 31 days old and not awaiting action
- **THEN** it is no longer listed in the inbox

#### Scenario: Empty inbox
- **WHEN** there are no notifications
- **THEN** the inbox shows "You're all caught up"

### Requirement: Action resolution fan-out
When a `requiresAction` notification's underlying request (its `requestId`) is resolved — approved, denied, answered, cancelled or expired — on any device or by the system, the server SHALL mark the notification resolved and send the resolution as a targeted channel-P event to every paired device that received it, so that every device clears its toast, withdraws its OS notification or delivered push where the platform allows, updates the inbox row to its resolved outcome ("Approved on Studio Mac", "Expired") and removes it from "Needs your attention" within 2 s. Acting on an already-resolved notification shows "This request was already handled" and performs nothing. Actions invoked directly from an OS notification or push (for example "Deny") are sent over the signed connection and are limited to non-destructive, non-approving intents: approvals that grant an agent permission always open the app to the request for review. [JAD] [NEW]

#### Scenario: Resolved elsewhere
- **WHEN** an approval is granted on the phone while the desktop shows the same request's toast and OS notification
- **THEN** the desktop toast disappears, the OS notification is withdrawn and the inbox row reads that it was approved on the phone

#### Scenario: Stale action
- **WHEN** the user taps "Review" on a notification whose request expired
- **THEN** the app opens the session, shows "This request was already handled" and no approval is sent

#### Scenario: Approve needs the app
- **WHEN** a push for `agent.approval_required` is shown on the lock screen
- **THEN** it offers "Open" and "Deny" and no direct "Approve" action

#### Scenario: Two approvals in one session
- **WHEN** one session raises two tool approvals 10 s apart and the user approves the first on the desktop
- **THEN** the first notification is resolved on every device and the second stays under "Needs your attention" with its own buttons

### Requirement: Notification preferences
The Notifications settings page (`settings-preferences.Notification preferences entry`) SHALL provide, per device: a master switch "Allow notifications" (default on; when off, only the inbox receives entries and no toast, OS notification, push or sound is produced, except the toasts named at the end of this requirement); a matrix with one row per category of `notifications.Notification event catalogue` (eleven rows: Agent, Script, Workflow and film, Generation, Export, Devices and sync, Usage and storage, Automations, Workspaces and terminal, Providers, App) and one switch per applicable channel (Toast, OS notification, Push), with these defaults — Toast on for all categories; OS notification on for Agent, Script, Workflow and film, Export, Devices and sync, Usage and storage, Workspaces and terminal, Providers, and off for Generation, Automations and App; Push following the OS notification defaults once push is enabled on the device; "Only notify when action is needed" (default off), which limits OS and push delivery to `requiresAction` kinds; Quiet hours (off by default; start and end time in the device's time zone, days of week) during which OS notifications and pushes are held and delivered as one summary when quiet hours end, except `requiresAction` kinds when "Allow urgent during quiet hours" is on (default on); Sound (on by default; a choice of the three bundled sounds "Chime", "Pulse" and "Knock" — project-authored, CC0, shipped in `packages/ui` — or None, separately for "Task finished" (default Chime) and "Needs attention" (default Knock)); "Play a sound when an export completes" (default on; desktop and web); "Push notifications" (iOS and Android; default off; the opt-in of `notifications.Mobile push delivery`); badge count toggle (default on); and a "Send test notification" button that exercises each enabled channel. The page shows the OS permission state and a button to open the OS notification settings when permission is denied. `pairing.request`, `device.revoked` and `device.key_rotated` toasts cannot be turned off. Quiet-hours start and end use the TimeField and the days the WeekdayPicker of `design-system.Date, time and weekday fields`. [NEW]

#### Scenario: Category channel off
- **WHEN** the user turns off OS notifications for Export
- **THEN** a finished export produces a toast when the app is visible and an inbox entry, and no OS notification

#### Scenario: Master switch off
- **WHEN** "Allow notifications" is off and a workflow finishes
- **THEN** the inbox gains the entry and no toast, OS notification, push or sound is produced

#### Scenario: Only when action is needed
- **WHEN** "Only notify when action is needed" is on, the app is hidden, and an export finishes and then an approval is required
- **THEN** no OS notification is shown for the export and one is shown for the approval

#### Scenario: Quiet hours
- **WHEN** quiet hours are 22:00–07:00 and three workflow notifications arrive at 23:00
- **THEN** no OS notification or push is delivered at 23:00, and at 07:00 one summary notification "3 updates while you were away" is delivered

#### Scenario: Urgent during quiet hours
- **WHEN** an approval is required at 23:30 with "Allow urgent during quiet hours" on
- **THEN** the OS notification or push is delivered immediately

#### Scenario: Sound choices
- **WHEN** the user opens the "Task finished" sound select
- **THEN** it offers exactly Chime, Pulse, Knock and None

#### Scenario: Test notification
- **WHEN** the user activates "Send test notification" with Toast and OS notification enabled
- **THEN** a test toast and a test OS notification appear within 3 s

#### Scenario: Permission denied
- **WHEN** the OS permission is denied
- **THEN** the page states that notifications are blocked by the system and offers "Open system settings"

### Requirement: Export completion signal
When an export finishes or fails — on this device or on the host — the app SHALL raise `export.finished` or `export.failed` with `target: "device"` or `target: "gateway"`, carrying the project name, output name, duration and file size on success and the localised reason for the failure code on failure; play the "Task finished" sound once when "Play a sound when an export completes" is on and the device is not muted; set desktop attention per `desktop-app.Desktop notifications and attention`; and offer the actions "Show in folder" (desktop, device exports), "Open" and, on mobile, "Share". Its `route` is `exports/history?job=<jobId>` (`exports/queue?job=<jobId>` for a failure, where "Retry" is offered); the `job` query is registered in `app-shell-navigation.Route map`. This requirement is the single definition of export notifications; `export-share.Export completion notification` references it. On web, where the tab is in the background, the document title is prefixed with "(n)" where n is the number of unread attention items, and the favicon shows a badge dot. [NEW]

#### Scenario: Export finished in the background
- **WHEN** an on-device export finishes while the desktop window is minimised
- **THEN** an `export.finished` notification with `target: "device"` and "Show in folder" appears as an OS notification, the sound plays once and the application icon requests attention (Dock bounce on macOS, taskbar flash on Windows, urgency hint on Linux)

#### Scenario: Host export
- **WHEN** an export on the host finishes
- **THEN** one `export.finished` with `target: "gateway"` is raised and no other kind is raised for that job

#### Scenario: Export failed
- **WHEN** an export fails because the disk is full
- **THEN** the notification has severity `error`, states "Not enough disk space" and its action opens `/exports/queue?job=<jobId>` with "Retry"

#### Scenario: Sound disabled
- **WHEN** "Play a sound when an export completes" is off
- **THEN** no sound plays and the other channels behave as configured

### Requirement: Badges and counts
The unread count SHALL be the number of unread notifications across the active host and the device, and the attention count the number of unresolved `requiresAction` notifications. The sidebar bell shows the unread count (hidden at zero, "99+" above 99); primary navigation rows show per-section attention counts per `app-shell-navigation.Primary navigation`; the desktop application-icon badge (Dock badge on macOS, taskbar overlay badge on Windows, launcher count on Linux desktops that support it) and the mobile app icon badge on iOS and Android show the attention count when the badge toggle is on. Counts update within 1 s of a change on the same device and within 2 s across devices, and are recomputed from the server on reconnect so that they never drift. Switching host shows the counts of the newly active host; a small dot on the host switcher indicates unread items on other paired hosts. [NEW]

#### Scenario: Count after reconnect
- **WHEN** a phone reconnects after two notifications were read on the desktop
- **THEN** its badge reflects the reduced count within 2 s of reconnecting

#### Scenario: Other host has unread items
- **WHEN** host B has an unresolved approval while host A is active
- **THEN** the host switcher shows a dot and host B's entry shows its attention count

### Requirement: Deduplication and rate limiting
Notifications without a `requestId` that share a `dedupeKey` (`<kind>:<subject.type>:<subject.id>`) and are raised within 60 s SHALL be merged into the existing notification, updating its body and time and incrementing a visible count, instead of creating a new entry. Notifications of `requiresAction` kinds carry a `requestId` in their `dedupeKey` and are therefore **never merged in the inbox**: each waiting request has its own entry, its own action buttons and its own resolution, and the attention count equals the number of unresolved requests. Only their OS and push delivery is coalesced: at most one OS notification or push per subject per 60 s, whose fixed text for the second and following requests in that window is "<n> requests need you" and which opens the subject. Failures of the same kind for the same subject are limited to one OS notification or push per 5 minutes; further ones go to the inbox only. A device receives at most 10 OS notifications or pushes per minute from a host; beyond that the server sends one summary ("<n> more updates") per minute. `requiresAction` kinds are exempt from the per-minute cap. `usage.threshold_reached` is raised once per budget scope per period per threshold; `provider.endpoint_unhealthy` at most once per endpoint per hour; `provider.auth_expiring` once per auth profile per expiry and `provider.auth_refresh_failed` once per auth profile until it is healthy again; `terminal.finished` and `terminal.needs_input` at most once per terminal per 30 s; `workflow.notify` at most 20 times per run (the limit of `agent-workflows`). [NEW]

#### Scenario: Repeated failure
- **WHEN** an automation fails 6 times in 5 minutes
- **THEN** one OS notification is delivered and the inbox entry shows the count 6

#### Scenario: Same key within a minute
- **WHEN** `agent.failed` is raised twice for the same session within 60 s
- **THEN** one inbox entry exists with the count 2 and the newer body

#### Scenario: Distinct requests are never merged
- **WHEN** two agents of one session each ask a question within 60 s
- **THEN** the inbox holds two `agent.question` entries with different `requestId` values, the attention count is 2, and a hidden device receives one OS notification followed by none for the second within the window, its text reading "2 requests need you" when the first is still displayed

#### Scenario: Burst
- **WHEN** 40 informational notifications are raised within one minute
- **THEN** the device receives at most 10 OS notifications plus one summary, and all 40 are in the inbox

### Requirement: Offline queueing and catch-up
Host notifications raised while a device is disconnected SHALL be kept on the server and delivered to the device's inbox on reconnect through a paged catch-up request ordered by `created_ms`, 100 per page, until the device is current. On catch-up, toasts are not replayed individually: if more than one unread notification arrived, one toast "<n> new notifications" with "View" is shown; if `requiresAction` items are pending, one toast per pending item up to 3 is shown, followed by a summary. Device notifications raised while the app was closed (for example an export that finished just before the app was terminated) are shown in the inbox at next launch. If the server is restarted, undelivered notifications persist because they are stored in its database. [JAD] [NEW]

#### Scenario: Catch-up after a day offline
- **WHEN** a laptop reconnects after 12 notifications were raised
- **THEN** all 12 appear in the inbox in order and a single toast reads "12 new notifications"

#### Scenario: Pending approval on reconnect
- **WHEN** a device reconnects while one approval is still pending
- **THEN** a persistent toast for that approval is shown in addition to the inbox entry

### Requirement: Privacy and content rules for notifications
Notification titles and bodies SHALL NOT contain secret values, API keys, device tokens, verification codes, full prompts, terminal input or output, file contents or file-system paths outside the project. The pairing verification code is shown only inside the app on already trusted devices through the targeted event of `device-pairing-signing.Six-digit verification code`; the `pairing.request` notification says only that a device is requesting to pair. Push payloads follow `notifications.Mobile push delivery` (`kind` and an opaque id only), and local OS notifications on mobile use the same fixed class titles while the device is locked. OS notifications on a locked desktop follow the OS preview setting. Notification payloads sent over the host connection are covered by the signed transport of `device-pairing-signing`, and a device receives only the kinds its scopes permit per the "Scope" column of `notifications.Notification event catalogue`. No notification data is sent to any analytics or third-party service; the only outbound path is the opt-in push path, which is listed in the egress table of `security-privacy.Network egress control`. [NEW]

#### Scenario: Verification code is in-app only
- **WHEN** a new device requests pairing
- **THEN** trusted devices show the 6-digit code inside the app, and the OS notification or push says only that a device is requesting to pair

#### Scenario: Scope filtering
- **WHEN** a device lacks `jagentchill.config.read`
- **THEN** it does not receive `usage.*` or `storage.*` notifications

#### Scenario: Terminal content never leaves the terminal
- **WHEN** a terminal command that printed a password finishes
- **THEN** the `terminal.finished` notification names the terminal tab only and contains no command text or output

### Requirement: Notification accessibility and interaction
Toasts and inbox updates SHALL be announced through live regions (polite for `info` and `success`, assertive for `warning`, `error` and `requiresAction`), remain on screen at least 8 s when they carry an action, and every toast action is also reachable from the inbox by keyboard. The inbox popover traps focus, closes with Escape and restores focus to the bell; rows are navigable with Up/Down, opened with Enter, toggled read with `U` and dismissed with Delete. Severity is conveyed by icon and text, not colour alone. On mobile, rows support swipe left to dismiss and swipe right to toggle read, with equivalent actions in a long-press menu. Sounds have no information that is not also shown visually. [NEW]

#### Scenario: Keyboard use of the inbox
- **WHEN** the inbox is open and the user presses Down then Enter
- **THEN** the second row is focused and then opened, and focus moves to the destination screen's main heading

#### Scenario: Screen reader announcement
- **WHEN** an approval-required toast appears
- **THEN** a screen reader announces its title and body immediately through the assertive live region

### Requirement: Changelog and update notices
`changelog.new_version` SHALL be raised once per device after the app first runs a version that has a release-notes entry, appear only in the inbox and as the card placed by `app-shell-navigation.What's new card`, and never as an OS notification or push. `update.available` and `update.ready` are raised by the desktop app per `updates-distribution.Desktop automatic update`, shown in the inbox, as the sidebar update card and, for `update.ready`, as one toast per app session with "Restart". `host.update_available` is raised by the server for a headless host per `updates-distribution.Headless Gateway distribution and update` and delivered to admin devices only. `host.stopped` is raised by the desktop supervisor when the built-in host enters `failed` per `desktop-app.Gateway crash restart`. [PORT SH-008, SH-010] [NEW]

#### Scenario: New version notice
- **WHEN** the app first runs version 1.3.0 after updating
- **THEN** one inbox entry "What's new in 1.3.0" exists and no OS notification is shown for it

#### Scenario: Host stopped
- **WHEN** the built-in host enters `failed`
- **THEN** a `host.stopped` notification with severity `error` and the action "Open diagnostics" is raised on that desktop

#### Scenario: Headless host update
- **WHEN** a newer host version is available for a headless host
- **THEN** admin devices receive `host.update_available` and editor and viewer devices do not

### Requirement: Notification RPC surface
The `notification` domain of `server-api.RPC domain ownership` SHALL consist of exactly these 10 channel P methods and 2 events, all for host notifications (device notifications never use them):

| Method | Parameters → result | Scope | Used by |
|---|---|---|---|
| `jagentchill.notification.list` | `{filter?: "all" \| "unread" \| "attention", since_ms?, cursor?, limit (1–100, default 30)}` → `{items[], nextCursor}`, ordered by `created_ms`; only kinds whose scope the device holds | `jagentchill.projects.read` | `notifications.Notification inbox`, `notifications.Offline queueing and catch-up` (pull RPC of the stream) |
| `jagentchill.notification.get` | `{id}` or `{opaqueId}` → the notification record (subject to the delivery filters of `notifications.Notification model`) | `jagentchill.projects.read` | `notifications.Mobile push delivery` (fetch after a push wakes the app) |
| `jagentchill.notification.counts.get` | `{}` → `{unread, attention}` | `jagentchill.projects.read` | `notifications.Badges and counts` |
| `jagentchill.notification.markRead` | `{ids[] (1–200) \| all: true, read: boolean}` | `jagentchill.projects.read` | `notifications.Notification inbox` |
| `jagentchill.notification.dismiss` | `{ids[] (1–200)}`; refused with `CONFLICT` for an unresolved `requiresAction` item | `jagentchill.projects.read` | `notifications.Notification inbox` |
| `jagentchill.notification.push.register` | `{token, platform: "ios" \| "android"}`; one token per device, replaced on a repeated call | `jagentchill.projects.read` | `notifications.Mobile push delivery` |
| `jagentchill.notification.push.unregister` | `{}`; deletes the calling device's token | `jagentchill.projects.read` | `notifications.Mobile push delivery` |
| `jagentchill.notification.push.preferences.set` | `{categories {<category>: boolean}, actionOnly: boolean, quietHours?: {start, end, days[], timeZone, allowUrgent}}` — the subset of `notifications.Notification preferences` the server needs in order to decide whether to send a push to that device; stored per device, deleted with its token | `jagentchill.projects.read` | `notifications.Mobile push delivery`, `notifications.Notification preferences` |
| `jagentchill.notification.subscribe`, `jagentchill.notification.unsubscribe` | `{}`; stream `notification` | `jagentchill.projects.read` | `notifications.Delivery channels` |

Events on stream `notification`, each sent only to devices that pass the delivery filters of `notifications.Notification model`: `jagentchill.notification.created {notification, delivery: "inbox" | "toast" | "os", deliverAfter_ms?}` (the per-device decision of `notifications.Attention routing by presence`) and `jagentchill.notification.updated {id, read_ms?, dismissed_ms?, resolved_ms?, outcome?, resolvedByDeviceName?}`, which carries the read, dismissed and resolved changes of `notifications.Notification inbox` and `notifications.Action resolution fan-out`. Acting on a notification is not a method of this domain: an action button calls the method of the capability that owns the underlying request. A handler under `jagentchill.notification.` that this table does not name MUST fail the contract test `rpc-ownership`. [NEW]

#### Scenario: Ownership test is exact
- **WHEN** the contract test `rpc-ownership` compares the server's handlers under `jagentchill.notification.` with this table
- **THEN** the two sets are equal

#### Scenario: Read state reaches the other device
- **WHEN** the desktop calls `jagentchill.notification.markRead {all: true, read: true}` while a phone is subscribed to stream `notification`
- **THEN** the phone receives `jagentchill.notification.updated` for each changed notification within 2 s and its badge clears

#### Scenario: Kind outside the device's scopes
- **WHEN** an `editor` device calls `jagentchill.notification.list` on a host that holds a `pairing.request` notification
- **THEN** the result does not contain that notification

#### Scenario: Dismissing a pending approval
- **WHEN** a device calls `jagentchill.notification.dismiss` for an unresolved `agent.approval_required` notification
- **THEN** the response error code is `CONFLICT` and the item stays under "Needs your attention"
