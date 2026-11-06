## ADDED Requirements

### Requirement: Workspace root record
The server SHALL keep a **workspace root** for every host directory an admin has opened: `{id, rootPath, kind: git | non_git, displayName, customName?, icon?, rootKey, createdAt_ms, archivedAt_ms?}`. `id` is `wsr_` followed by 20 random lowercase base32 characters and is never derived from the path. `rootPath` is the exact absolute path the admin selected, normalised lexically (no trailing separator, `.` and `..` segments removed) and never replaced by its resolved symbolic-link target. `kind` is an observation refreshed whenever the root is listed (a directory that gains or loses a `.git` entry changes kind without changing id). `displayName` is the last path segment; `customName` (1–80 characters) overrides it in every list; `icon` is one of the 48 icon names of `design-system.Icon tokens` or an emoji of at most 2 grapheme clusters. `rootKey` is the SHA-256 hex of the lower-cased `origin` remote URL with credentials and a trailing `.git` removed, or of `rootPath` when there is no remote, and groups the same repository across Gateways in client lists. Removing a root is a soft delete (`archivedAt_ms` set, record kept, nothing on disk touched). The UI term for a root is "Folder". **Server data directory is off limits.** The server SHALL refuse to register a root, to create or re-open a workspace, to place a worktree and to clone a repository at a directory that contains `<dataDir>` (the server's data directory of `server-api.Host data store`), equals it or lies inside it, with the single exception of directories strictly below `<dataDir>/workspaces/` (the managed project workspaces of "Default project workspace directory" and the managed worktrees); the comparison is made on both the lexically normalised path and the path with symbolic links resolved, case-insensitively on case-insensitive file systems, and is repeated when a turn or a terminal starts in the workspace. The refusal is `fs/protected-path` with `details.reason: "server_data_directory"`, the file browser shows such directories as not openable with the text "This folder holds JAgentChill's own data", and an audit record is written; this keeps the Gateway state, the secrets directory, the database and the blob store out of every agent's and terminal's working directory. [JAD JD-WS-001]

#### Scenario: Exact selected path is kept
- **WHEN** an admin opens `/srv/work/films/` where `/srv/work` is a symbolic link to `/mnt/data/work`
- **THEN** the root is stored with `rootPath` `/srv/work/films` and `displayName` `films`
- **AND** its id matches `^wsr_[a-z2-7]{20}$`

#### Scenario: Kind follows the directory
- **WHEN** `git init` is run inside a root of kind `non_git` and the roots list is refreshed
- **THEN** the same root id is listed with kind `git`

#### Scenario: Remove keeps files
- **WHEN** an admin removes a root that has no active workspace
- **THEN** the root disappears from the Workspaces index, its record has `archivedAt_ms` set, and every file under `rootPath` is unchanged

#### Scenario: Remove blocked by active workspaces
- **WHEN** an admin removes a root that has 2 active workspaces
- **THEN** a dialog reads "Archive the 2 workspaces in this folder first" and the root is unchanged

#### Scenario: Data directory and its ancestors are refused
- **WHEN** the server's data directory is `/srv/jagentchill/data` and an admin tries to open `/srv/jagentchill/data`, `/srv/jagentchill/data/gateway-state`, `/srv/jagentchill` and a symbolic link `/tmp/jc` that resolves to `/srv/jagentchill/data/secrets`
- **THEN** each of the four requests fails with `fs/protected-path` and `details.reason` `server_data_directory`, no root or workspace record is created, and an audit record is written

#### Scenario: Managed workspaces stay allowed
- **WHEN** the server creates the default workspace of a project at `<dataDir>/workspaces/<projectId>/`
- **THEN** the workspace is created and an agent session can be bound to it

### Requirement: Workspace record and kinds
A **workspace** SHALL be the record `{id, rootId, cwd, kind: directory | local_checkout | worktree, displayName, title?, branch?, baseBranch?, worktreeRoot?, mainRepoRoot?, ownedWorktree: boolean, managed: boolean, labels[], pinnedAt_ms?, archivedAt_ms?, autoArchivedChangeRequestUrl?, createdAt_ms, updatedAt_ms, createdBy}`. `id` is `ws_` followed by 20 random lowercase base32 characters, opaque, never a path. `cwd` is the exact execution directory inside the root. Kinds: `directory` — a directory that is not inside a git work tree (no branch fields); `local_checkout` — the root's own git work tree or a sub-directory of it (`branch` is the checked-out branch observed live, empty when detached); `worktree` — a git worktree; `ownedWorktree` is true only for worktrees created by `workspaces-terminal.Managed worktree location and naming`, and only those are ever removed by the product. `managed` is true only for default project workspaces (`workspaces-terminal.Default project workspace directory`). `displayName` is generated (branch name for git kinds, directory name otherwise); `title` (1–80 characters) is the user override and wins wherever a name is shown. Creation SHALL always create a new record and SHALL never de-duplicate by directory. `createdBy` is a device id or `agent:<sessionId>`. [JAD JD-WS-002, JD-WS-004]

#### Scenario: Local workspace on a repository
- **WHEN** an admin creates a workspace with isolation "Local" on a root of kind `git` whose checked-out branch is `main`
- **THEN** a workspace of kind `local_checkout` exists with `cwd` equal to the root path, `branch` `main`, `ownedWorktree` false

#### Scenario: Creation never de-duplicates
- **WHEN** an admin creates two "Local" workspaces on the same root
- **THEN** two workspaces with different ids and the same `cwd` are listed

#### Scenario: Title overrides the generated name
- **WHEN** a workspace with `displayName` `feature/intro-cut` is given the title "Intro recut"
- **THEN** the sidebar, tab titles and window title show "Intro recut" and the branch chip still shows `feature/intro-cut`

### Requirement: Shared directories and state split
Several workspaces SHALL be able to share one `cwd`. State keyed by `(Gateway, cwd)` — file tree, file contents and revisions, git status, diff, commit list, script definitions — SHALL be identical in every workspace that shares the directory and SHALL update in all of them from one watcher. State owned by one workspace SHALL stay separate: tab and pane layout, agent sessions, terminals, script runs, setup log, title, labels, pin, review-comment drafts, attachments, explorer expansion and scroll state, video project bindings. [JAD JD-WS-003]

#### Scenario: Directory state is shared
- **WHEN** workspaces A and B share `/srv/work/films` and a file is saved from a file panel in A
- **THEN** the Changes list in B shows the same modified file within 1 s without a manual refresh

#### Scenario: Workspace state is separate
- **WHEN** a terminal is opened in workspace A
- **THEN** workspace B, which shares the directory, lists no terminal

### Requirement: Workspace to video project binding
A workspace SHALL be bound to zero or more video projects (`projects`) through link records `{workspaceId, projectId, role: default | linked, createdAt_ms}`. A video project has at most one `default` workspace and at most 8 `linked` workspaces; a workspace has at most 50 bound projects. Binding and unbinding need device role `admin` for workspaces with `managed: false`; the `default` link of a managed workspace is created by the server and cannot be removed while the project exists. A bound project appears in the workspace header as a chip (project thumbnail 20 × 20 px and name) that opens the editor panel (`workspaces-terminal.Panel kinds`); the project's editor header lists its workspaces under "Workspaces" with "Open workspace". Deleting a video project to trash keeps its links; purging it deletes its links, archives its managed workspace and leaves non-managed workspaces and their directories untouched. A workspace with no bound project is fully usable. [NEW]

#### Scenario: Link an external workspace to a project
- **WHEN** an admin chooses "Link video project…" in a workspace header and picks "Vlog 12"
- **THEN** the header shows a "Vlog 12" chip and the "Vlog 12" editor header lists the workspace under "Workspaces"

#### Scenario: Link limit
- **WHEN** a project already has 8 linked workspaces and an admin links a ninth
- **THEN** the call fails with `workspace/limit-reached` and the dialog reads "A project can be linked to at most 8 workspaces"

#### Scenario: Purging the project
- **WHEN** a project with a managed default workspace and one linked external workspace is purged from trash
- **THEN** the managed workspace is archived and its directory deleted, the external workspace stays active with no project chip, and no file in the external directory changes

### Requirement: Default project workspace directory
Every video project that is synced to or created on a Gateway SHALL have one default workspace of kind `directory` with `managed: true` and `cwd` `<dataDir>/workspaces/<projectId>/` (the directory named in `server-api.Host data store`). The server SHALL create the directory (mode `0700`) and the workspace record the first time any of these happens: an agent session is bound to the project, a device opens the project's Files tab, or a tool of the `jc_workspace_*` family runs. Creative agents (design D25) are confined to this directory through the `jc_workspace_*` tools (`agent-editing-tools.Tool naming and families`) and never receive another `cwd`. The directory is counted in host storage accounting, is included in host backup, and is limited to 20 GiB and 100 000 entries by default (`workspaces.managedQuotaBytes` 1 GiB–500 GiB); a write that would exceed the quota fails with `QUOTA_EXCEEDED`. A managed workspace cannot be re-pointed, converted to a worktree, or archived by a user. On a client with no Gateway a video project has no workspace and the Files tab shows the requires-host state. [NEW]

#### Scenario: Created on first use
- **WHEN** an `editor` device opens the Files tab of a project that never had an agent session
- **THEN** the directory `<dataDir>/workspaces/<projectId>/` exists with mode `0700`, a managed workspace record exists, and the tree shows "This folder is empty"

#### Scenario: Quota
- **WHEN** an upload would bring a managed workspace from 19.9 GiB to 20.3 GiB
- **THEN** the upload is refused with `QUOTA_EXCEEDED` before any chunk is materialised and the toast reads "Workspace storage is full (20 GiB)"

#### Scenario: Managed workspace cannot be archived
- **WHEN** an admin opens the menu of a managed workspace
- **THEN** "Archive" is absent and "Open video project" is present

### Requirement: Workspace to agent session binding
An agent session SHALL reference its workspace by `workspaceId`; ownership, listing and visibility SHALL be derived from the session record of `server-api.Session ownership and visibility` and from `workspaceId`, never from `cwd`, which is only the execution directory. A workspace SHALL be able to exist with no session. Sessions of **workspace agents** (design D25: a CLI/ACP runtime, or the built-in runtime with file and exec tools) are created through the one session-creation method of the product, `jagentchill.session.create {workspaceId, runtime?, model?, thinkingLevel?, mode?, message?, worktree? {baseBranch?, branchName?, refName?}}` of `chat-agent.Session and chat RPC surface`, relayed by `server-api.Agent session relay`; this capability has no session method of its own and defines what that method checks for a workspace: the caller's role (`admin`, or `editor` while the host setting `agents.allowWorkspaceAgentsForEditors` is on), the caller's access to the workspace under `workspaces-terminal.Role and permission matrix`, that the workspace is active and its directory exists, and — when `worktree` is present — scope `jagentchill.host.exec`, the creation of the worktree workspace first (`workspaces-terminal.Worktree targets and limits`) and the binding of the session to it, a failure of either step rolling both back. The server then creates the OpenClaw session over its gateway link with `sessions.create {cwd, model, agentRuntime, thinkingLevel, permissionMode}`, where `permissionMode` is never omitted and is the value `agent-runtimes.Runtime modes catalogue` maps from the requested product mode (Ask and Plan `read-only`, Edit — the default — `guarded`, Auto `workspace`; `full` only through the unattended grant, after creation; `server-api.Agent session relay`); the session is workspace-class, owned by the creating device and always `private`. Every subsequent prompt, steer, abort, control change and approval of that session reaches the host only through the relay, under the owner rule of that record: an `editor` never reads or drives a workspace-class session it does not own, and an `editor` whose permission was turned off keeps read access to the ones it owns and cannot send, steer or approve in them. No device can create or patch a session into a workspace runtime by any other path, because no device reaches a Gateway method (`server-api.Native Gateway port isolation`); a session found on a workspace runtime without a server record is handled by `server-api.Run initiator attribution and host-execution gating`. A runtime published with `nativeToolCoverage: false` is offered for workspace sessions only to `admin` owners, and its creation dialog and the terminal warning dialog state "This runtime runs its own tools without host approval prompts". Creative-agent sessions bind to the managed workspace of their project automatically. Moving a session to another workspace is not offered. [JAD JD-WS-023, JD-WS-008]

#### Scenario: Visibility follows the workspace id
- **WHEN** workspaces A and B share a directory and a session is created in A
- **THEN** the session is listed under A only

#### Scenario: Editor without the host setting
- **WHEN** an `editor` device calls `jagentchill.session.create` with a `workspaceId` of an external workspace while "Allow workspace agents for editors" is off
- **THEN** the response is `SCOPE_DENIED` with `details.requiredRole` `admin` and no OpenClaw session is created

#### Scenario: Editor and another owner's session
- **WHEN** the setting is on and an `editor` device lists the sessions of an external workspace in which an `admin` device created a session
- **THEN** that session is not listed for the editor, and a send naming its key answers `NOT_FOUND`

#### Scenario: Agent and worktree in one request
- **WHEN** an admin submits the new-workspace form with isolation "New worktree", base `main` and a first prompt
- **THEN** one request creates the worktree, the workspace and the session, and the workspace opens with the agent panel streaming

#### Scenario: Rollback
- **WHEN** worktree creation succeeds and session creation fails because the selected model is unavailable
- **THEN** the worktree directory and branch are removed, no workspace record remains, and the form shows "Select a model"

#### Scenario: Workspace session gets a permission mode
- **WHEN** an `admin` creates a workspace session without choosing a mode and another in "Auto"
- **THEN** the two Gateway sessions are created with `permissionMode` `guarded` and `workspace`, and neither is created without the field

### Requirement: Host registry and storage
Workspace state SHALL live only on the Gateway host in the server database `<dataDir>/jagentchill.sqlite`, in tables `workspace_roots`, `workspaces`, `workspace_project_links`, `workspace_labels`, `workspace_trust`, `terminal_records`, `script_runs` and `workspace_recents`, created by the server's schema migrations (`server-api.Host schema migrations`). Managed worktrees live under `<worktreeRoot>/<first 12 hex of SHA-256 of the root path>/<slug>/` with `worktreeRoot` defaulting to `<dataDir>/worktrees` (`workspaces.worktreeRoot`, admin-configurable to any absolute path on the same host). Script and setup logs are files under `<dataDir>/workspace-logs/<workspaceId>/<runId>.log`, each capped at 10 MiB (first 1 MiB and last 9 MiB kept, with a line `… <n> bytes omitted …` between), retained for the 50 most recent runs per workspace and at most 14 days. Limits: 200 active roots, 500 active workspaces, 1 000 archived workspaces per Gateway (the oldest archived record is purged when the limit is exceeded). All records are included in host backup and restore; restore never recreates directories. [JAD JD-WS-001, JD-WS-002] [NEW]

#### Scenario: Registry survives a restart
- **WHEN** the Gateway is restarted with 3 roots and 7 workspaces registered
- **THEN** the same 3 roots and 7 workspaces with unchanged ids, titles, pins and labels are listed

#### Scenario: Log cap
- **WHEN** a script writes 40 MiB of output
- **THEN** its log file is at most 10 MiB plus the omission line, and the log view shows "30 MiB omitted" between head and tail

#### Scenario: Workspace limit
- **WHEN** 500 active workspaces exist and an admin creates another
- **THEN** the call fails with `workspace/limit-reached` and nothing is created on disk

### Requirement: Client-visible and host-only data
Clients SHALL receive workspace data only through channel P RPCs and events and SHALL never be given a host file descriptor, mount or unauthenticated URL. A web or mobile client sees: root and workspace records (paths shown as text; home-directory prefixes abbreviated to `~`), directory listings, file contents on request, diffs, script and setup logs, terminal output while attached, and service ports. Data that exists only on the host and is never transmitted: the server and Gateway process environments, the Gateway token and the server's gateway device identity, secret files, forge CLI credentials, git credential helpers, the SSH agent socket, terminal scrollback of terminals the device is not attached to, and files outside the workspace unless an admin explicitly opens them. A client SHALL cache on the device at most: the workspace list, the per-workspace layout, the last 200 tree entries per expanded directory, and unsaved editor buffers; cached file content is held in memory only and is dropped when its panel closes. "Reveal in file manager" and "Open in external editor" SHALL be offered only in the desktop app when it supervises the Gateway on the same machine and is paired with it over the loopback address — on macOS (Finder), Windows (File Explorer) and Linux (the desktop's default file manager) alike. [NEW]

#### Scenario: Phone sees paths as text only
- **WHEN** a phone paired as `admin` opens a workspace whose cwd is `/home/op/films`
- **THEN** the header shows `~/films`, and no action on the phone opens a local file manager

#### Scenario: Reveal only on the host machine
- **WHEN** the same workspace is open in the desktop app that supervises the Gateway
- **THEN** the file context menu contains "Reveal in file manager" and choosing it opens the OS file manager with the file selected

#### Scenario: Unsaved buffer stays on the device
- **WHEN** a user types in a file panel and the connection drops before saving
- **THEN** the buffer is kept on the device and no bytes of it reach the host until "Save" succeeds

### Requirement: OpenClaw reuse, channel P domains and spike gates
All workspace, file and terminal traffic SHALL use channel P in three RPC domains added to the domain list of `server-api.RPC naming and schema ownership`: `jagentchill.workspace.*`, `jagentchill.fs.*` and `jagentchill.terminal.*`, with events `jagentchill.workspace.updated`, `jagentchill.workspace.setup.progress`, `jagentchill.workspace.script.updated`, `jagentchill.fs.changed`, `jagentchill.workspace.git.updated`, `jagentchill.terminal.data`, `jagentchill.terminal.exit` and `jagentchill.terminal.updated`. No device ever calls an OpenClaw method: devices connect only to the server's channel and hold no OpenClaw scope (design D7, `server-api.Single client channel`). The server SHALL reuse OpenClaw through Gateway RPCs over its gateway link (`server-api.Gateway link`; administrator-scope methods gated by spike S12) and build the remainder itself, without editing or adding any file of OpenClaw; while the Gateway is not linked, the rows of the table that reuse an OpenClaw piece answer `GATEWAY_UNAVAILABLE` and the rows built entirely by the server (file tree, git, PTY) keep working. The terminal is entirely the server's own: OpenClaw `terminal.*`, `sessions.catalog.startTerminal` and the Gateway `terminal` tool are not used by any path of this product, and `gateway.terminal.enabled` stays false in the run profile at all times (`gateway.cliAgents.enabled` is not a terminal switch and follows CLI runtime enablement, `platform-skeleton.Gateway run profile`):

| Behaviour | OpenClaw piece reused | Built by the server | Gate → fallback |
|---|---|---|---|
| Session in a workspace cwd | `sessions.create {cwd}` | role check, workspace binding | S12 → none: workspace sessions are not offered on a host where the server cannot create them over the gateway link (`UNSUPPORTED_FEATURE`) |
| Host directory picker | `fs.listDir` (directories) | browse roots, files in listings, protected paths | S12 → Node `fs.readdir` in the server |
| Worktrees | `worktrees.branches`, `worktrees.create`, `worktrees.remove`, `worktrees.restore` | naming, location, setup/teardown, PR checkout | S12 → `git worktree` commands run by the server with Node `child_process` |
| File tree, read, write, rename, delete, move, search, watch | none (`sessions.files.*` is session-scoped and has no concurrency guard) | all, with Node `fs` in a server service | none |
| Diff and git actions | `sessions.diff` for a session's own changes | status, base diff, commits, commit/pull/push, forge CLI calls | none; `git` binary required |
| PTY | none | all: PTY worker, emulator, profiles, cwd, environment stripping, binary frames, limits, sharing (`workspaces-terminal.Terminal backend and worker process`) | S15 (PTY worker on each host OS) → terminal not advertised on a host OS where it fails |
| Real CLI TUI | none | profile-launched CLI command in the server PTY, tab, role check | S15 |

Spike ids are those of design D18. The chosen path per row SHALL be recorded in `docs/decisions/` and reported by `jagentchill.workspace.hostInfo` as `backends {session, browse, worktree, terminal, cliTui}`, where `terminal` and `cliTui` are always `server-pty`; the channel P contract is identical on either path of the other rows. [NEW]

#### Scenario: Gateway terminal is not reachable
- **WHEN** the terminal is enabled and an `admin` device has a terminal open
- **THEN** the Gateway configuration reads `gateway.terminal.enabled: false`, no method named `terminal.open` is accepted on the server's channel, and `jagentchill.workspace.hostInfo` reports `backends.terminal` `server-pty`

#### Scenario: Fallback keeps the contract
- **WHEN** the recorded decision for `worktree` is the `git worktree` fallback
- **THEN** creating a worktree workspace returns the same result shape as on the reuse path and `hostInfo.backends.worktree` names the fallback

#### Scenario: Domain registration
- **WHEN** the server contract test enumerates channel P methods
- **THEN** every method of this capability starts with `jagentchill.workspace.`, `jagentchill.fs.` or `jagentchill.terminal.` and has exported request and response schemas in `packages/protocol`

### Requirement: Role and permission matrix
Every handler SHALL check the calling device's current role and scopes (`device-pairing-signing.Device roles and scopes`) before acting, and SHALL answer `SCOPE_DENIED` with `details.requiredRole` otherwise. "Managed" means a default project workspace; "external" means every other workspace. "Setting on" means the host setting "Allow workspace agents for editors" (`agents.allowWorkspaceAgentsForEditors`, default off; defined once in `multi-agent-orchestration.Agent classes and creation privileges`, design D25).

| Action | viewer | editor | admin |
|---|---|---|---|
| List managed workspaces, read their files, download | yes | yes | yes |
| Create, edit, rename, move, delete, upload files in a managed workspace | no | yes | yes |
| List external workspaces, read their files, diffs, commit list, script and setup logs, download | no | yes | yes |
| Write files inside an external workspace cwd | no | only with the setting on | yes |
| Create a workspace-agent session in an existing external workspace | no | only with the setting on | yes |
| Read a workspace-class session (timeline, files it changed, diff) | no | only sessions it owns, also after the setting was turned off | yes |
| Send, steer or interrupt a prompt in a workspace-class session; change its mode, model or runtime | no | only in sessions it owns and only with the setting on; never in another owner's session | yes |
| Answer a host-execution approval of a workspace-class session (command, terminal keys, script start or stop, git mutation, file write outside the cwd, any native approval of the runtime) | no | no | yes (`jagentchill.host.exec`) |
| Open folder, host file browser, create directory, clone, new workspace, worktree create/remove, archive, restore, pin, rename, labels, link project | no | no | yes |
| Read or write any path outside a workspace cwd | no | no | yes |
| Edit `jagentchill.json`, trust a repository's commands, run or stop scripts, re-run setup | no | no | yes |
| Stage, commit, discard, pull, push, merge, switch or rename branch, create or merge a pull request | no | no | yes |
| Enable the terminal, open, type into, resize, rename, close, capture or take over a terminal, manage profiles, start a CLI TUI | no | no | yes |
| Watch a terminal that an admin shared read-only | no | yes | yes |
| Add a review comment to a draft, attach it to a turn | no | yes | yes |

Admin-only rows that execute on the host — terminals (enable, open, type, resize, close, capture, take over, profiles, CLI TUI), running or stopping workspace scripts and setup, trusting a repository's commands, and every git mutation (stage, commit, discard, pull, push, merge, branch switch or rename, worktree create or remove, pull-request create or merge) — are enforced as scope `jagentchill.host.exec` (role `admin` only; the scope `device-pairing-signing.Device roles and scopes` adds for host execution); the remaining admin-only rows (open folder, host file browser, workspace create, archive, restore, pin, rename, labels, link project, edit `jagentchill.json`, paths outside a workspace cwd) as scope `jagentchill.config.write`; read rows of managed workspaces as `jagentchill.projects.read`; read rows of external workspaces as `jagentchill.projects.write` (a scope viewers do not hold); managed-workspace writes as `jagentchill.projects.write`. The three session rows are enforced by the relay and the resolver rule (`server-api.Session ownership and visibility`, `server-api.Approval and question resolution`, `multi-agent-orchestration.Device access to agent sessions`), not by a client convention: the server records the initiator of every turn and blocks host-execution tool calls of a run without a permitted initiator (`server-api.Run initiator attribution and host-execution gating`). `jagentchill.config.write` alone never authorises a terminal, a script or a git mutation. Controls a role cannot use SHALL be hidden when the whole surface is unavailable and disabled with the tooltip "Your role on this host does not allow this" otherwise. Agents act with the class limits of design D25: creative agents have only `jc_workspace_*` on their managed workspace; workspace agents act inside their workspace cwd under the session's permission mode. Which sessions are workspace-class — every session on a CLI or ACP runtime except under the single carve-out — is decided by `agent-runtimes.Creative sessions on CLI and ACP runtimes`; a creative session under that carve-out receives no workspace cwd other than its project's managed workspace. [JAD JD-TRM-016] [NEW]

#### Scenario: Editor reads an external workspace
- **WHEN** an `editor` device opens an external workspace
- **THEN** Files and Changes are browsable, the file panel has no "Edit" control, and the Terminal entry of the new-tab page is absent

#### Scenario: Editor write with the setting on
- **WHEN** "Allow workspace agents for editors" is on and an `editor` saves a file inside an external workspace cwd
- **THEN** the write succeeds and an audit record `fs.write` with the editor's device id is appended

#### Scenario: Viewer cannot see external workspaces
- **WHEN** a `viewer` device calls `jagentchill.workspace.list`
- **THEN** only managed workspaces of projects are returned

#### Scenario: Config scope does not open a terminal
- **WHEN** the server contract test calls `jagentchill.terminal.open`, `jagentchill.workspace.script.start` and a git commit method with a device record that holds `jagentchill.config.write` and not `jagentchill.host.exec`
- **THEN** each call fails with `SCOPE_DENIED` and `details.requiredScope: "jagentchill.host.exec"`

#### Scenario: Editor cannot approve its own agent's command
- **WHEN** the setting is on, an `editor` prompts the workspace-class session it owns, and the agent's command needs approval
- **THEN** the editor's card reads "Waiting for an admin device", its direct answer fails with `SCOPE_DENIED` and `details.requiredScope: "jagentchill.host.exec"`, and the command runs only after an `admin` device allows it

#### Scenario: Viewer and external workspaces by scope
- **WHEN** a `viewer` device, which holds `jagentchill.projects.read`, calls `jagentchill.fs.read` on a file of an external workspace
- **THEN** the call fails with `SCOPE_DENIED` and `details.requiredScope: "jagentchill.projects.write"`

#### Scenario: Role change takes effect immediately
- **WHEN** a device attached to a terminal is changed from `admin` to `editor`
- **THEN** its terminal stream stops within 2 s with `SCOPE_DENIED`, the tab shows "Your role on this host does not allow this", and the terminal keeps running for other admins

### Requirement: Workspaces index and start tiles
The app SHALL have a host-scoped "Workspaces" destination (routes `/h/[hostId]/workspaces`, `/h/[hostId]/workspaces/new`, `/h/[hostId]/workspaces/open`, `/h/[hostId]/workspaces/[workspaceId]`, registered in `app-shell-navigation.Route map` and `app-shell-navigation.Primary navigation`; deep link `jagentchill://h/<hostId>/workspaces/<workspaceId>`). The index shows, in order: four start tiles — "Open a folder" ("Open a folder on the host"), "Import session" (opens the session import defined by `agent-runtimes.Session import from a CLI's native history`), "Set up providers" (opens host settings → Providers), "Pair a device" (opens the pairing flow) — then "Recent" (the 12 workspaces most recently opened on this device for this host, each with name, folder, branch and relative time), then all folders as collapsible groups with their workspaces. A search field filters by workspace name, folder name, branch and label. With no folder registered the index shows only the tiles and "No folders yet". Tiles a role cannot use are disabled with the role tooltip. Recents are stored per device and mirrored to `workspace_recents` so that a newly paired device of the same role starts with the host's 12 most recently used workspaces. [JAD JD-WS-024] [NEW]

#### Scenario: Empty host
- **WHEN** an admin opens Workspaces on a Gateway with no folder
- **THEN** the four tiles and the text "No folders yet" are shown and "Recent" is absent

#### Scenario: Recent order
- **WHEN** a user opens workspaces A, B, then A again
- **THEN** "Recent" lists A before B

#### Scenario: Editor sees disabled creation
- **WHEN** an `editor` opens the index
- **THEN** "Open a folder" is disabled with the tooltip "Your role on this host does not allow this" and existing external workspaces are listed

### Requirement: Open folder with the host file browser
"Open a folder" SHALL open a host file browser (modal 720 × 560 px on wide and medium, full-height sheet on compact) driven by `jagentchill.fs.browse {path?, showHidden?}` → `{path, parent?, home, roots[], entries[{name, path, kind: dir | file, hidden, isRepository, readable}]}`. It shows a path field with completion, breadcrumb, shortcuts (Home, the configured browse roots, recent folders), directories first in natural name order, a "Show hidden folders" toggle (default off), repository directories marked with a branch icon, and the actions "New folder", "Clone repository…" and "Open". Browse roots default to the Gateway OS user's home directory and are set by `workspaces.browseRoots` (1–16 absolute paths); a path outside every browse root is refused with `fs/outside-browse-roots`. "New folder" creates a directory (name 1–255 bytes, no `/`, `\` or NUL) in the listed directory. "Clone repository…" takes a URL (`https://`, `ssh://` or `user@host:path`), a target name and runs `git clone` with a 30-minute limit, streaming progress; URL credentials typed in the field are never stored or logged and the clone uses the host's own git credentials. "Open" registers the root (if new) and creates a `directory` or `local_checkout` workspace, then navigates to it. The browser needs device role `admin` and every `Open`, `New folder` and `Clone` appends an audit record. [JAD JD-WS-024, JD-WS-004]

#### Scenario: Open a repository
- **WHEN** an admin browses to `~/code/promo`, which contains `.git`, and presses "Open"
- **THEN** a root of kind `git` and a `local_checkout` workspace are created and the workspace screen opens

#### Scenario: Outside the browse roots
- **WHEN** the browse roots are `["/home/op"]` and an admin types `/etc` in the path field
- **THEN** the listing is refused with `fs/outside-browse-roots` and the field shows "This location is outside the folders this host allows"

#### Scenario: Unreadable directory
- **WHEN** the listing contains a directory the Gateway OS user cannot read
- **THEN** the row is shown dimmed with a lock icon and cannot be entered or opened

#### Scenario: Clone failure
- **WHEN** a clone fails with an authentication error
- **THEN** the partially created target directory is removed, the dialog shows "Authentication failed. Sign in to the git host on the host." and the URL field keeps its value

### Requirement: New workspace screen
The "New workspace" screen SHALL contain: "Folder" (picker of registered folders plus "Open a folder…"); "Isolation" segmented control `Local | New worktree` (remembered per device as a form preference, not stored on the workspace; "New worktree" disabled with "Not a git repository" for `non_git` folders); "Start from" reference picker for worktrees with search "Search branches and pull requests" (local branches, remote branches, open pull or merge requests when a forge CLI is available; "Not applicable" for Local); "Base" (default: the repository default branch); "Title (optional)"; "Link video project (optional)"; and a first-prompt composer with the runtime and model controls of `chat-agent.Composer layout and controls` (data from `agent-runtimes.Unified model browser data contract`). "Create" with an empty prompt creates the workspace with no agent and opens it on a draft panel. With a prompt, the workspace is created and the session started in one request, and when no title or branch name was entered they are generated from the prompt (`workspaces-terminal.Metadata generation`). Inline errors: "Select a folder", "Select a model", "Failed to create worktree: <reason>", "Host is not connected". "Create" is disabled while a request is in flight and the form keeps all values on failure. [JAD JD-WS-007, JD-WS-008, JD-WS-004]

#### Scenario: Workspace without an agent
- **WHEN** an admin selects a folder, isolation "Local", leaves the prompt empty and presses "Create"
- **THEN** the workspace opens with one draft panel and no session exists for it

#### Scenario: Generated title and branch
- **WHEN** an admin chooses "New worktree", types the prompt "Add a 10 s intro sting with the logo" and presses "Create"
- **THEN** the workspace gets a generated title of at most 60 characters and a branch `jc/<slug>` derived from it, both visible in the header within 20 s

#### Scenario: Non-git folder
- **WHEN** the selected folder has kind `non_git`
- **THEN** "New worktree" is disabled with "Not a git repository" and "Start from" shows "Not applicable"

#### Scenario: Disconnected
- **WHEN** the connection drops while the form is open and the user presses "Create"
- **THEN** the form shows "Host is not connected", nothing is created, and every field keeps its value

### Requirement: Sidebar workspace list with status, pin, rename and labels
In the Workspaces section the sidebar secondary list (`app-shell-navigation.Sidebar secondary list`) SHALL show "Pinned" and then one collapsible group per folder with its active workspaces ordered by last activity. A row shows the workspace name, a meta line and trailing indicators. The meta line shows, in priority order: "Needs approval" or "Needs input" (a session or an agent hook waits for the user), "Setup failed", "Setting up…", "Working" (a session turn is running), "Script running" / "<n> services running", "Terminal finished" (unseen attention), git state `↑<ahead> ↓<behind> · <n> changed`, otherwise the branch name and the relative time of the last activity. Trailing indicators: a pull-request state chip (open, draft, merged, closed, checks failing), a terminal count when above zero, and the unseen dot. Row menu (admin): Pin / Unpin (`pinnedAt_ms`), Rename… (sets `title`; an empty value restores the generated name), Labels ▸ (assign up to 5 of the Gateway's labels; "Manage labels…" edits the label set: name 1–24 characters, one of 8 colour tokens, at most 50 labels), Link video project…, Copy path, Archive. Pin, title and labels are host-scoped and appear on every paired device within 2 s. A label filter in the list options narrows the list to workspaces carrying every selected label. [JAD JD-WS-021] [JAD]

#### Scenario: Status priority
- **WHEN** a workspace has a running script and a session waiting for a permission
- **THEN** its meta line reads "Needs approval"

#### Scenario: Pin syncs across devices
- **WHEN** an admin pins a workspace on the desktop
- **THEN** within 2 s the phone paired with the same Gateway lists it under "Pinned"

#### Scenario: Label filter
- **WHEN** labels "client" and "urgent" are selected in the filter
- **THEN** only workspaces carrying both labels are listed, and clearing the filter restores the full list

#### Scenario: Empty section
- **WHEN** the Gateway has folders but no active workspace
- **THEN** the list shows "No workspaces yet" and the "+" button opens the New workspace screen

### Requirement: Archive workspace
"Archive" SHALL be a host-wide action on a non-managed workspace that, after a confirmation naming what will be closed ("2 sessions, 3 terminals, 1 running service"), performs in order: stop the workspace's running scripts and services; close its terminals; archive its agent sessions (running turns are stopped first); run the teardown commands of `jagentchill.json` when the workspace has `ownedWorktree: true` (`workspaces-terminal.Worktree setup and teardown execution`); set `archivedAt_ms`; and, for an owned worktree, remove the worktree directory with `git worktree remove` only when no other active workspace references the same `worktreeRoot`. Directories of `directory` and `local_checkout` workspaces and non-owned worktrees are never deleted. An owned worktree with uncommitted changes or commits not contained in any remote branch requires a second confirmation listing the counts ("3 uncommitted files, 2 unpushed commits will be lost") with the choices "Archive and discard", "Keep the folder on disk" and "Cancel"; "Keep the folder on disk" archives the record and marks `ownedWorktree` false. The archived workspace disappears from every device's sidebar within 2 s and its open tabs close with "This workspace was archived". The branch is never deleted. [JAD JD-WS-021, JD-WS-006, JD-WS-010]

#### Scenario: Last reference removes the worktree
- **WHEN** the only active workspace of an owned, clean worktree is archived
- **THEN** teardown runs, the worktree directory no longer exists, `git worktree list` in the main repository no longer contains it, and the branch still exists

#### Scenario: Shared worktree is kept
- **WHEN** two workspaces reference the same owned worktree and one is archived
- **THEN** the directory stays and teardown does not run

#### Scenario: Unpushed work
- **WHEN** an owned worktree has 2 commits not on any remote branch and the admin archives it
- **THEN** the second confirmation lists "2 unpushed commits", and "Keep the folder on disk" archives the record and leaves the directory in place

#### Scenario: Local checkout is never deleted
- **WHEN** a `local_checkout` workspace is archived
- **THEN** no file under its cwd is changed or removed

### Requirement: Recovery of an archived workspace
A "History" view under Workspaces SHALL list archived workspaces (name, folder, branch, archive time, reason `manual | auto-archived after merge`, link to the merged pull request when recorded) with search and the actions "Restore" and "Delete permanently" (admin). `jagentchill.workspace.recovery.inspect {workspaceId}` SHALL report `{directoryExists, mainRepoExists, branchExists, headCommit?, sessions[{sessionId, title, lastActivity_ms}]}`. "Restore" opens a dialog showing that report and a checklist of the workspace's archived sessions (none selected by default); confirming clears `archivedAt_ms`, and for an owned worktree whose directory is gone recreates it from `mainRepoRoot` at the recorded branch, or at the recorded head commit on a new branch `<branch>-restored` when the branch no longer exists, re-runs setup, and un-archives the selected sessions in the same action. Restore fails with `workspace/root-missing` when `mainRepoRoot` or the directory of a non-worktree workspace no longer exists, and with `git/ref-not-found` when neither the branch nor the commit exists; a failed restore leaves the workspace archived. "Delete permanently" removes the record and its logs and never touches a directory. [JAD JD-WS-022]

#### Scenario: Restore recreates the worktree
- **WHEN** an archived owned worktree whose branch still exists is restored with one session selected
- **THEN** the worktree directory exists again on that branch, setup runs in a setup panel, the workspace is listed as active and the selected session is un-archived

#### Scenario: Branch was deleted
- **WHEN** the recorded branch no longer exists and the recorded commit does
- **THEN** the dialog states "The branch no longer exists. A new branch <branch>-restored will be created from the last commit." and restore creates it

#### Scenario: Repository is gone
- **WHEN** `mainRepoRoot` no longer exists
- **THEN** "Restore" fails with `workspace/root-missing`, the dialog reads "The original repository folder no longer exists", and the workspace stays in History

### Requirement: Per-repository configuration file
A file named `jagentchill.json` at the repository (or folder) root SHALL configure a workspace. Schema (unknown keys preserved on write and ignored on read):

```
{ "version": 1,
  "worktree": {
    "setup":    string | string[],          // run once after an owned worktree is created
    "teardown": string | string[],          // run during archive before the directory is removed
    "servicePorts": { "range": "<low>-<high>" } | { "portScript": "<executable path relative to the repository root>" },
    "terminals": [ { "name": string, "command"?: string, "args"?: string[] } ]   // ≤ 8, opened after setup succeeds
  },
  "scripts": { "<name>": { "command": string, "type"?: "task" | "service", "port"?: integer 1024–65535,
                           "cwd"?: "<path relative to the workspace cwd>", "env"?: { "<NAME>": string }, "autoStart"?: boolean } },
  "metadataGeneration": { "instructions": string }     // ≤ 4 000 characters
}
```

Script names match `^[a-z0-9][a-z0-9:_-]{0,39}$`; at most 50 scripts; `type` defaults to `task`; `autoStart` applies to services only. For `worktree` workspaces the configuration is read from the **committed version on the base branch** (`git show <baseBranch>:jagentchill.json`); for `local_checkout` and `directory` workspaces it is read from the working file. A missing file means no setup, no scripts and default port policy. An invalid file disables all of its sections and shows the banner "jagentchill.json is invalid: <first error with JSON path>" with "Open file". Because the file makes the Gateway run commands from the repository, commands SHALL run only after an admin has confirmed "Trust commands from this folder" for the exact content hash (SHA-256 of the command-bearing sections); a changed hash asks again and shows a unified diff of the commands; trust is stored per root in `workspace_trust`. [JAD JD-WS-009] [NEW]

#### Scenario: Read from the committed base branch
- **WHEN** a worktree workspace is created from base `main`, and the working copy of the main checkout has an uncommitted edit to `jagentchill.json` adding a setup command
- **THEN** the setup that runs is the one committed on `main`, without the uncommitted command

#### Scenario: Untrusted commands do not run
- **WHEN** a worktree is created in a folder whose `jagentchill.json` hash has not been trusted
- **THEN** setup does not start, the setup panel shows the commands and the buttons "Trust and run" and "Skip setup", and the workspace status is "Setup needs confirmation"

#### Scenario: Invalid file
- **WHEN** `scripts.dev.port` is `80`
- **THEN** the banner reads "jagentchill.json is invalid: scripts.dev.port must be between 1024 and 65535" and no script is listed as runnable

#### Scenario: Changed commands ask again
- **WHEN** a trusted file gains a new `scripts.deploy` entry and an admin presses "Run" on any script
- **THEN** a dialog shows the added command as a diff and nothing runs until "Trust and run" is confirmed

### Requirement: Configuration editor with stale-write guard
Admins SHALL be able to edit `jagentchill.json` in a form ("Workspace settings" in the workspace header menu) with sections Setup, Teardown, Scripts (table: name, command, type, port, auto-start), Service ports, Startup terminals and "Naming and commit messages" (the metadata-generation instructions), plus a "Source" toggle showing the JSON. `jagentchill.workspace.config.read {workspaceId, source: working | base}` returns `{content, revision, valid, errors[]}`; `jagentchill.workspace.config.write {workspaceId, content, expectedRevision}` writes the working file atomically (formatted with 2-space indentation and a trailing newline, unknown keys preserved) and fails with `fs/conflict` when the file's revision differs, in which case the form shows "Config changed on disk" with "Reload" (discards form edits after confirmation) and "Compare" (side-by-side of the form's JSON and the file). For worktree workspaces the form states "Changes take effect for new worktrees after they are committed to <base branch>". Saving never commits. [JAD JD-WS-009]

#### Scenario: Stale write
- **WHEN** an admin has the form open, the file is changed by a terminal command, and the admin presses "Save"
- **THEN** nothing is written, the form shows "Config changed on disk" with "Reload" and "Compare", and the form's edits are still present

#### Scenario: Unknown keys survive
- **WHEN** the file contains a top-level key `"x-team": {"owner": "video"}` and an admin adds a script through the form
- **THEN** the saved file still contains `"x-team": {"owner": "video"}` unchanged

#### Scenario: Editor role
- **WHEN** an `editor` opens the workspace header menu
- **THEN** "Workspace settings" opens the form read-only with no "Save" button

### Requirement: Scripts with logs
The workspace header SHALL have a "Scripts" button with a badge counting running scripts; it opens a list of the scripts in `jagentchill.json` with name, command (one line, truncated in the middle), type, state (`idle | starting | running | exited <code> | failed | stopped`), port for services, and the actions Run / Stop / Restart and "Open log". `jagentchill.workspace.script.list|start|stop|logs {workspaceId, name}` back it; the host CLI offers `jagentchill workspace script list|start|stop <workspaceId> [name]`; workspace agents have the tools `jc_workspace_script_list`, `jc_workspace_script_start` and `jc_workspace_script_stop` (names registered in `agent-editing-tools.Tool naming and families`), where start and stop follow the approval rules of `workspaces-terminal.Agent terminal tools`. A run executes `command` with the host's default shell (`sh -c` on macOS and Linux hosts, `cmd.exe /d /s /c` on Windows hosts) in `cwd` (default: workspace cwd), with the environment of `workspaces-terminal.Shell environment` plus `env`, `JAGENTCHILL_WORKSPACE_ID`, `JAGENTCHILL_WORKSPACE_PATH`, `JAGENTCHILL_BRANCH` and `JAGENTCHILL_SOURCE_CHECKOUT_PATH`. Each run has a log panel (kind `script-log`) that streams output with ANSI colours, at most 20 updates per second, with follow-tail, search, "Copy all", "Download log" and "Clear view"; reopening a run loads the stored log. Tasks are limited to 6 h (`workspaces.scriptTimeoutMinutes`, 1–1 440) and are then stopped with state `failed` reason `timeout`. Stop sends SIGTERM to the process tree on macOS and Linux hosts (`taskkill /T` on Windows hosts) and SIGKILL (`taskkill /T /F`) after 5 s. Limits: 8 running scripts per workspace, 32 per Gateway (`workspace/limit-reached`); one run per script name per workspace (`workspace/script-already-running`). Script runs do not survive a Gateway restart: on start-up interrupted runs are marked `stopped` reason `host-restarted` and services with `autoStart` are started again. [JAD JD-WS-012]

#### Scenario: Run a task and read its log
- **WHEN** an admin presses "Run" on script `lint` that prints 30 lines and exits with code 1
- **THEN** the log panel shows the 30 lines, the state becomes `exited 1` in danger colour, and the badge returns to its previous count

#### Scenario: Same script twice
- **WHEN** `dev` is running and `jagentchill.workspace.script.start` is called for `dev` in the same workspace
- **THEN** the call fails with `workspace/script-already-running` and the existing run is unaffected

#### Scenario: Stop escalates
- **WHEN** a script ignores SIGTERM and the admin presses "Stop"
- **THEN** the process tree is killed 5 s after the request and the state is `stopped`

#### Scenario: Agent starts a script in Edit mode
- **WHEN** a workspace agent in `edit` mode calls `jc_workspace_script_start {name: "test"}`
- **THEN** a permission card "Run script test: <command>" is shown and the script starts only after "Allow once" or "Allow for this session"

### Requirement: Services, ports and local proxy
A script of type `service` SHALL be supervised: it is restarted after an unexpected exit with delays of 1 s, 5 s and 30 s, and after the third consecutive failure within 5 minutes it stays `failed` with "Restart". Each service run is assigned a TCP port exported as `JAGENTCHILL_PORT` (and `PORT` when the script's `env` does not set it), chosen as: the script's explicit `port`; else the output of `worktree.servicePorts.portScript` (called with arguments script name, workspace id, branch, worktree path; it has 5 s to print one integer); else the first free port of `worktree.servicePorts.range`; else the first free port of the host default range `workspaces.servicePorts.range` (default `3000-3999`). A project block replaces the host default. A port that is already bound makes the start fail with `workspace/port-unavailable` naming the port. The server SHALL run one reverse-proxy listener bound to `127.0.0.1` only (`workspaces.serviceProxy.port`, default 18990; never bound to another interface regardless of the desktop "Network access" setting) that routes requests by `Host` `<script>--<branch-slug>--<folder-slug>.localhost` (the branch label omitted on the default branch) to the service port and supports WebSocket upgrades. The script list shows the port, the proxy URL and "Open in browser" (shown only in the desktop app running on the Gateway machine; other devices see the text "Reachable on the host machine only"). The proxy is not a signed route and carries no product data. [JAD JD-WS-011] [NEW]

#### Scenario: Assigned port and deterministic host name
- **WHEN** script `dev` of type `service` starts in folder `promo` on branch `feature/intro` with range `3000-3999` and port 3000 free
- **THEN** the process sees `JAGENTCHILL_PORT=3000` and `http://dev--feature-intro--promo.localhost:18990/` returns the service's response on the Gateway machine

#### Scenario: Explicit port in use
- **WHEN** `scripts.dev.port` is 5173 and another process holds 5173
- **THEN** the start fails with `workspace/port-unavailable` and the list shows "Port 5173 is already in use"

#### Scenario: Proxy is loopback only
- **WHEN** the Gateway's network access is "Local network (encrypted)" and another machine on the network requests port 18990
- **THEN** the connection is refused

#### Scenario: Crash loop
- **WHEN** a service exits with a non-zero code three times within 5 minutes
- **THEN** it is not restarted a fourth time, its state is `failed`, and the workspace row meta reads "Service dev failed"

### Requirement: Metadata generation
Workspace titles, branch names, commit messages and pull-request titles and descriptions SHALL be generated on request by the model route `metadata` resolved through `orc-model-routing.Route resolution and fallback`, with the repository's `metadataGeneration.instructions` and the host setting `workspaces.metadataInstructions` (≤ 4 000 characters each) appended to the request. Inputs: the first prompt (≤ 4 000 characters) for titles and branch names; the staged diff (truncated to 200 KiB, with a per-file stat for the remainder) for commit messages; the branch's commit subjects and base diff stat for pull requests. Outputs are constrained: title ≤ 60 characters on one line; branch `jc/<slug>` with slug `^[a-z0-9][a-z0-9-]{0,47}$`; commit subject ≤ 72 characters plus an optional body; pull-request title ≤ 100 characters and a Markdown body ≤ 8 000 characters. Generation sends repository content to a provider and therefore follows the consent and budget rules of `generation-providers.Data leaving the machine` and `generation-providers.Budgets with hard stop`. Each generated value is placed in an editable field with a "Regenerate" button and is never applied to a commit or pull request without the user pressing the action button. When no route is configured, consent is declined, or generation exceeds 20 s, the field stays empty with "Generation failed — type a value", the title falls back to the branch or directory name and the branch to `jc/workspace-<n>` (the lowest unused positive integer). [JAD] [NEW]

#### Scenario: Commit message from the staged diff
- **WHEN** an admin presses the generate button in the commit box with 3 staged files
- **THEN** within 20 s the subject field holds at most 72 characters and the message is not committed until "Commit" is pressed

#### Scenario: No route configured
- **WHEN** no `metadata` route exists and a worktree workspace is created with a prompt
- **THEN** the branch is `jc/workspace-1`, the title equals the branch name, and no provider request is made

#### Scenario: Consent declined
- **WHEN** the consent card for sending the diff to the provider is answered "Cancel"
- **THEN** no content leaves the Gateway and the field shows "Generation failed — type a value"

### Requirement: Worktree targets and limits
"New worktree" SHALL create a git worktree in one of three shapes: **branch-off** (a new branch `branchName` created from `baseBranch`; the base is fetched from its remote first when the remote is reachable within 30 s, otherwise the local ref is used and the workspace shows "Base is possibly out of date"); **checkout-branch** (an existing local or remote branch `refName`; a remote-only branch gets a local tracking branch of the same name); **checkout-PR** (a pull or merge request number or URL on the repository's forge, resolved with the forge CLI of `workspaces-terminal.Pull-request panel and forge integration` to head branch and fork remote; the local branch is `pr/<number>-<head-branch-slug>` tracking the head). `baseBranch` is recorded on the workspace in every shape (for a PR: its target branch). Limits: 20 active owned worktrees per folder and 100 per Gateway (`workspace/limit-reached`); creation is serialised per repository and limited to 10 minutes (`git/timeout`). Failure states, each leaving no directory, no branch created by the attempt and no workspace record: `git/unavailable` (no `git` binary ≥ 2.30), `git/branch-exists`, `git/ref-not-found`, `git/branch-checked-out` (git refuses a branch already checked out in another worktree; the message names that worktree and offers "Open that workspace"), `git/forge-unavailable`, `git/pr-not-found`, `git/auth-failed`, `fs/no-space`. [JAD JD-WS-005] [NEW]

#### Scenario: Branch-off
- **WHEN** an admin creates a worktree with base `main` and branch name `jc/intro-sting`
- **THEN** a worktree directory exists on a new branch `jc/intro-sting` whose first parent is the tip of `main`, and the workspace has `baseBranch` `main` and `ownedWorktree` true

#### Scenario: Check out a pull request
- **WHEN** an admin picks pull request #42 whose head branch is `fix/audio-drift` targeting `main`
- **THEN** the worktree is on local branch `pr/42-fix-audio-drift` at the pull request's head commit, `baseBranch` is `main`, and the pull-request chip shows "#42"

#### Scenario: Branch already checked out
- **WHEN** `feature/a` is checked out in another worktree and an admin chooses checkout-branch `feature/a`
- **THEN** creation fails with `git/branch-checked-out`, the message names the other worktree's path, and no directory is left behind

#### Scenario: Per-folder limit
- **WHEN** a folder has 20 active owned worktrees
- **THEN** creating another fails with `workspace/limit-reached` and the form reads "This folder has reached 20 worktrees. Archive one to continue."

### Requirement: Managed worktree location and naming
An owned worktree SHALL be created at `<worktreeRoot>/<first 12 hex of SHA-256 of the root path>/<slug>/` (`workspaces-terminal.Host registry and storage`). `slug` is taken from the request's `worktreeSlug`, else derived from the branch name by lower-casing, replacing every run of characters outside `[a-z0-9]` with `-`, trimming `-` and truncating to 48 characters; a slug whose directory exists gets the suffix `-2`, `-3`, … up to `-99` (then `workspace/limit-reached`). Default branch names are `jc/<slug>`; a user-typed branch name is validated with `git check-ref-format --branch` and rejected inline with "Not a valid branch name". The directory is removed only by `workspaces-terminal.Archive workspace` after the last referencing workspace is archived. A reconciliation pass at server start-up and every 24 h SHALL list directories under `worktreeRoot` that no workspace record references and report them in host settings → Workspaces as "Orphaned worktrees" with size and the admin actions "Adopt" (creates a workspace record) and "Delete"; nothing is deleted automatically. [JAD JD-WS-006] [NEW]

#### Scenario: Location
- **WHEN** a worktree with branch `jc/Intro Sting!` is created for root `/home/op/promo`
- **THEN** its directory is `<worktreeRoot>/<12 hex of SHA-256("/home/op/promo")>/jc-intro-sting/`

#### Scenario: Slug collision
- **WHEN** `jc-intro-sting` already exists under the same hash directory
- **THEN** the new worktree is created at `jc-intro-sting-2`

#### Scenario: Orphan is reported, not deleted
- **WHEN** a directory exists under `worktreeRoot` with no workspace record
- **THEN** host settings lists it under "Orphaned worktrees" with its size, and it still exists after the reconciliation pass

### Requirement: Worktree setup and teardown execution
After an owned worktree is created, the `worktree.setup` commands SHALL run exactly once, sequentially (a multi-line string is one script; an array runs element by element and stops at the first non-zero exit), with cwd = the worktree, the environment of `workspaces-terminal.Shell environment` plus `JAGENTCHILL_SOURCE_CHECKOUT_PATH` (the original checkout), `JAGENTCHILL_WORKSPACE_ID`, `JAGENTCHILL_WORKTREE_PATH` and `JAGENTCHILL_BRANCH`, and a limit of 30 minutes (`workspaces.setupTimeoutMinutes`, 1–240). Progress is pushed as `jagentchill.workspace.setup.progress {workspaceId, state: pending | awaiting-trust | running | succeeded | failed | skipped, commandIndex, commandCount, exitCode?, elapsed_ms}` and shown in a **setup panel** that opens automatically: one collapsible section per command with its text, state icon, duration and live log (ANSI colours, follow-tail), and the buttons "Cancel" while running, "Retry" (re-runs from the first command) and "Skip setup" after a failure. The first prompt of a workspace created with an agent is held until setup reaches `succeeded` or `skipped`; on `failed` the draft is preserved and the agent panel shows "Setup failed — retry or skip to start the agent". Startup terminals (`worktree.terminals`) open only after `succeeded`. `worktree.teardown` runs during archive with the same environment and a limit of 10 minutes; a teardown failure is shown in the archive dialog with "Archive anyway" and "Cancel". Setup and teardown never run for `local_checkout` or `directory` workspaces. [JAD JD-WS-010]

#### Scenario: Setup log is visible
- **WHEN** a worktree is created with `setup: ["pnpm install", "pnpm build"]`
- **THEN** a setup panel opens showing two sections, the first streaming output, and the workspace row meta reads "Setting up…"

#### Scenario: Failure stops the sequence
- **WHEN** the first command exits with code 1
- **THEN** the second command does not run, the state is `failed` with `exitCode` 1, the row meta reads "Setup failed", and "Retry" and "Skip setup" are offered

#### Scenario: First prompt waits for setup
- **WHEN** a workspace is created with a prompt and setup takes 90 s
- **THEN** the agent panel shows "Waiting for setup…" and the turn starts within 2 s after setup succeeds

#### Scenario: Setup runs once
- **WHEN** a second workspace is created on the same already set-up worktree directory
- **THEN** setup does not run again and no setup panel opens

### Requirement: Auto-archive after merge
The host setting "Archive workspaces after their pull request is merged" (`workspaces.autoArchiveAfterMerge`, default off, admin) SHALL make the server check, every 5 minutes and on every pull-request status refresh, each active owned-worktree workspace that has an associated pull or merge request. When the request is merged and the workspace has no uncommitted change, no commit missing from the merged head, no running session turn, no terminal with a foreground process other than its shell, and no running script, the server SHALL notify ("<workspace> will be archived in 10 minutes — its pull request was merged", actions "Keep" and "Archive now"; notification kind `workspace.archive_pending` of `notifications.Notification event catalogue`) and, unless "Keep" is chosen within 10 minutes, archive it through `workspaces-terminal.Archive workspace` (without the interactive confirmations), recording `autoArchivedChangeRequestUrl`. "Keep" exempts the workspace permanently. A workspace that fails any condition is not archived and is checked again at the next interval. [JAD] [NEW]

#### Scenario: Clean merged workspace
- **WHEN** the setting is on and a clean worktree's pull request is merged
- **THEN** a notification is created within 5 minutes and, with no response, the workspace is archived 10 minutes after the notification with reason "auto-archived after merge" and the pull-request URL recorded

#### Scenario: Uncommitted work blocks it
- **WHEN** the merged workspace has one modified file
- **THEN** it is not archived and its row keeps the "merged" chip

#### Scenario: Keep
- **WHEN** the user presses "Keep" on the notification
- **THEN** the workspace is never auto-archived for that pull request

### Requirement: File tree with lazy loading, sorting and search
The explorer "Files" tab SHALL show the workspace cwd as a tree (`design-system.Tree`) loaded one directory at a time by `jagentchill.fs.list {workspaceId, path, cursor?, showHidden, sort}` → `{entries[{name, kind: file | dir | symlink, size, modified_ms, hidden, ignored, gitStatus?, linkTarget?}], nextCursor?}` in pages of 500; a directory with more entries ends with "Load 500 more". Expansion state, scroll position and selection are kept per workspace per device. Sorting: folders first, then natural case-insensitive name (default), or modified time, or size, each ascending or descending. "Show hidden files" (default off) reveals entries whose name starts with `.` (the `.git` directory stays hidden in every setting); git-ignored entries are shown at 50 % opacity. Rows show a type icon, the name, and a git status letter (`M`, `A`, `D`, `R`, `U`, `?`) in the diff colour tokens. Expanded directories are watched on the host (changes debounced 200 ms, at most 2 000 watched directories per workspace; beyond that the tree shows a "Refresh" button and the note "Live updates paused for some folders") and pushed as `jagentchill.fs.changed`. A search field offers two modes: **file name** (fuzzy match over at most 200 000 indexed paths, honouring `.gitignore` unless hidden files are shown, first 200 results, results within 300 ms after the index is built) and **in files** (literal or regular expression, case and whole-word toggles, include/exclude globs, files ≤ 1 MiB, binary files skipped, first 500 matches grouped by file, 10 s limit after which partial results are shown with "Search stopped after 10 s"). States: loading skeleton rows, "This folder is empty", "Failed to load folder" with "Retry". [JAD JD-WS-015] [NEW]

#### Scenario: Lazy loading
- **WHEN** a workspace with 40 000 files in nested directories is opened
- **THEN** only the entries of the root directory are requested, and a sub-directory's entries are requested when it is first expanded

#### Scenario: Large directory
- **WHEN** a directory with 1 800 entries is expanded
- **THEN** 500 rows are shown followed by "Load 500 more"

#### Scenario: Hidden toggle
- **WHEN** "Show hidden files" is turned on
- **THEN** `.env` and `.github` appear and `.git` does not

#### Scenario: Live update
- **WHEN** a terminal command creates `out/final.mp4` in an expanded directory
- **THEN** the row appears within 1 s with status `?`

#### Scenario: Content search limit
- **WHEN** an in-files search for `FIXME` matches 3 000 lines
- **THEN** the first 500 matches are listed with "Showing the first 500 matches"

### Requirement: File viewer by type with live reload
Opening a file SHALL create a file panel whose viewer is chosen by content type (sniffed from the first 8 KiB, then by extension):

| Type | Viewer | Limit |
|---|---|---|
| UTF-8 text and source code | monospace viewer with line numbers, word-wrap toggle, find, go-to-line, syntax highlighting for at least: TypeScript, JavaScript, JSON, YAML, TOML, Markdown, HTML, CSS, Python, Rust, Go, Java, Kotlin, Swift, C, C++, shell, SQL, XML, Dockerfile, diff, SRT, VTT | view ≤ 5 MiB; highlighting ≤ 1 MiB (plain above) |
| Markdown | rendered (headings, lists, tables, code, images relative to the file, task lists) with a Rendered / Source toggle; raw HTML in Markdown is shown as text | ≤ 5 MiB |
| HTML | Preview / Source toggle; preview in a sandboxed frame with scripts, forms and network access disabled (only inline styles and `data:` images) | ≤ 5 MiB |
| Image (PNG, JPEG, GIF, WebP, AVIF, BMP, SVG rendered as an image) | fit / 100 % / zoom 10–800 %, checkerboard for transparency, pixel dimensions | ≤ 50 MiB |
| Video and audio | player streaming by HTTP range with play, seek, volume, duration and, for video, dimensions and frame rate; "Add to project media…" when a video project is bound | no size limit; formats the platform cannot decode fall back to metadata |
| Anything else or over the limit | metadata (size, modified, type) and "Download" | — |

States: "Loading file…", "No preview available", "Binary preview unavailable", "Failed to load file" with "Retry", "This file no longer exists". An open file SHALL be subscribed (`jagentchill.fs.subscribe`) and reloaded within 1 s when it changes on the host, keeping scroll position and zoom; a panel with unsaved edits is not reloaded and instead shows the conflict banner of `workspaces-terminal.File editing with optimistic concurrency`. Each file panel has "Copy path", "Copy contents" (text ≤ 1 MiB) and "Download". [JAD JD-WS-017]

#### Scenario: Markdown
- **WHEN** the user opens `notes/brief.md`
- **THEN** a panel "brief.md" shows rendered Markdown with a toggle to the source

#### Scenario: Video preview by range
- **WHEN** the user opens a 6 GiB `.mp4` the platform can decode and seeks to the middle
- **THEN** playback starts from the middle using ranged requests and fewer than 64 MiB are transferred before the first frame

#### Scenario: Live reload
- **WHEN** an agent rewrites `script.md` while its panel is open without unsaved edits
- **THEN** the panel shows the new content within 1 s at the same scroll position

#### Scenario: Binary file
- **WHEN** the user opens a 3 MiB `.sqlite` file
- **THEN** the panel shows "Binary preview unavailable", the file size and "Download"

#### Scenario: HTML preview is inert
- **WHEN** an HTML file containing a `<script>` that requests a remote URL is previewed
- **THEN** the script does not run and no network request leaves the device

### Requirement: File editing with optimistic concurrency
Text files up to 2 MiB encoded as UTF-8 (with or without BOM) SHALL be editable in the file panel by roles allowed in `workspaces-terminal.Role and permission matrix`, when `jagentchill.workspace.hostInfo.features.fileEditing` is true. The editor provides undo/redo (200 steps per panel), find and replace, multi-cursor on web/desktop, indentation detection, bracket matching, and preserves the file's line endings, BOM and trailing-newline state. Edits are saved explicitly (action `file.save`, the "Save" button, or "Save all") through `jagentchill.fs.write {workspaceId, path, content, expectedRevision}` where `revision` is the SHA-256 hex of the file bytes last read; the host compares it with the current file under a per-path lock, writes atomically (temporary file in the same directory, `fsync`, rename, original mode preserved) and returns the new `revision`. A mismatch returns `fs/conflict` with `details {currentRevision, modified_ms}` and writes nothing; the panel then shows the conflict banner "This file changed on the host" with "Compare" (side-by-side diff of the buffer against the host version), "Overwrite" (repeats the write with the current revision), "Reload" (discards the buffer after confirmation) and "Save as…". An unsaved panel shows a dot on its tab; closing it, archiving the workspace or leaving the screen asks "Save changes to <name>?" (Save / Don't save / Cancel). Unsaved buffers are kept on the device (at most 20 files, 2 MiB each) and restored after an app restart with "Restored unsaved changes". Files that are not valid UTF-8 open read-only with "Unsupported encoding"; files above 2 MiB open read-only with "Too large to edit (2 MiB limit)". On mobile the editor is the same component with the software keyboard and an accessory row (Tab, undo, redo, find, save). [JAD JD-WS-018]

#### Scenario: Clean save
- **WHEN** a user edits `script.md` and saves while the host file is unchanged
- **THEN** the file on the host holds the new bytes, the tab dot disappears and the returned revision equals the SHA-256 of the saved bytes

#### Scenario: Conflict
- **WHEN** an agent changes the file after the user opened it and the user saves
- **THEN** the write fails with `fs/conflict`, the host file is unchanged by the user's save, and the banner offers Compare, Overwrite, Reload and Save as…

#### Scenario: Line endings preserved
- **WHEN** a file with CRLF line endings and no trailing newline is edited and saved
- **THEN** every line ending in the saved file is CRLF and the file still has no trailing newline

#### Scenario: Buffer survives a restart
- **WHEN** the app is quit with unsaved edits in two files and reopened
- **THEN** both panels reopen with their edits and the notice "Restored unsaved changes"

#### Scenario: Read-only role
- **WHEN** an `editor` opens a file in an external workspace with the host setting off
- **THEN** the panel is a viewer with no editing caret and no "Save" control

### Requirement: File operations within the workspace
Roles allowed to write SHALL be able to, from the tree context menu, the tree toolbar and the keyboard: **New file** and **New folder** (inline name field; name 1–255 bytes, not `.` or `..`, no `/`, `\` or NUL; `fs/exists` shown inline as "A file or folder with that name already exists"); **Rename** (inline; same rules); **Move** by drag and drop onto a folder (desktop/web) or "Move to…" with a folder picker (all platforms), for a multi-selection of up to 500 entries; **Duplicate** (`name copy.ext`, then `name copy 2.ext`); **Delete** with the confirmation "Delete <name>?" or "Delete <n> items?" — deleted entries of a managed workspace go to `<cwd>/.jagentchill-trash/` for 30 days and are restorable from "Recently deleted"; in external workspaces deletion is permanent and the dialog says "This cannot be undone" — and **Copy path** / **Copy relative path**. A move or rename onto an existing name asks Replace / Keep both / Cancel. Operations are RPCs `jagentchill.fs.create|rename|move|copy|delete {workspaceId, …}`, each atomic per entry, each refusing a path that resolves outside the workspace (`workspaces-terminal.Path confinement and limits`), and each reported to all attached clients through `jagentchill.fs.changed` within 1 s. A batch reports per-entry results; a partial failure lists the failed entries with their reasons and leaves the succeeded ones applied. Open panels follow renames and moves of their file; a panel whose file was deleted shows "This file no longer exists" and keeps any unsaved buffer with "Save as…". [JAD] [NEW]

#### Scenario: Rename follows open panels
- **WHEN** `draft.md` is open in a panel and is renamed to `script-v2.md`
- **THEN** the panel title becomes "script-v2.md" and subsequent saves write to the new path

#### Scenario: Name collision on move
- **WHEN** `a/clip.mov` is dragged into `b/`, which already contains `clip.mov`
- **THEN** a dialog offers Replace, Keep both and Cancel, and "Keep both" produces `b/clip copy.mov`

#### Scenario: Delete in a managed workspace is restorable
- **WHEN** an `editor` deletes `notes.txt` in a managed workspace
- **THEN** it disappears from the tree, appears under "Recently deleted", and "Restore" puts it back at its original path

#### Scenario: Partial batch failure
- **WHEN** 10 files are deleted and one is locked by the host OS
- **THEN** 9 are deleted and a dialog lists the tenth with "Permission denied by the host"

### Requirement: Upload and download between device and host
**Upload** (button "Upload", drag and drop onto the tree or a folder on desktop/web, share-sheet and document picker on mobile) SHALL transfer files with the signed, content-addressed, 4 MiB-chunked, resumable protocol of `cross-device-sync.Chunked resumable upload`, then materialise them with `jagentchill.fs.commitUpload {workspaceId, path, sha256, size, onConflict: fail | replace | keep-both}`, which moves the verified bytes to the target path atomically; staged bytes not committed within 24 h are deleted and do not count as project media. Folders are uploaded recursively with their relative structure (at most 10 000 files per drop). **Download** of a file uses the signed, range-capable route `GET /jagentchill/v1/fs/{workspaceId}/content?path=<percent-encoded relative path>` (added to the route table of `server-api.Signed HTTP route surface`; signed per `device-pairing-signing.Per-request HTTP signature`; `ETag` = revision; credentials never in the query), resumed with `Range` after an interruption and retried up to 5 times at 1, 2, 4, 8 and 16 s; the same route feeds the media viewers. Download of a folder or a multi-selection produces a ZIP stream built on the host (at most 20 GiB and 100 000 entries, symbolic links stored as links, not followed). Limits: 20 GiB per uploaded file (`workspaces.maxUploadBytes`, 1 MiB–100 GiB), 2 concurrent transfers per device with 3 chunks in flight each. A transfers popover in the workspace header lists each transfer with name, direction, progress, rate, and Pause / Resume / Cancel / Retry; completed entries stay for the session of the app. On web, downloads above 2 GiB use the File System Access API when available and otherwise show "This browser cannot save files this large — use the desktop app". On mobile, downloads go to the OS share sheet or Files provider. [JAD] [NEW]

#### Scenario: Resumed upload
- **WHEN** a 3 GiB upload is interrupted at 40 % by a connection loss and the connection returns
- **THEN** only missing chunks are sent, the file appears in the tree after commit, and its SHA-256 equals the source file's

#### Scenario: Conflict on commit
- **WHEN** an uploaded `logo.png` targets a folder that already has `logo.png`
- **THEN** a dialog offers Replace, Keep both and Cancel before anything is materialised

#### Scenario: Ranged download resume
- **WHEN** a 900 MiB download stops at 500 MiB and is resumed
- **THEN** the client requests `Range: bytes=524288000-` and the completed file's SHA-256 equals the host file's

#### Scenario: Oversized upload
- **WHEN** a 25 GiB file is dropped with the default limit
- **THEN** the transfer is refused before the first chunk with "This file is larger than the 20 GiB upload limit"

#### Scenario: Unsigned download
- **WHEN** the content route is requested without signature headers
- **THEN** the response is HTTP 401 and no bytes are returned

### Requirement: Path confinement and limits
Every `jagentchill.fs.*` and content-route path SHALL be given relative to the workspace cwd; the host resolves it with symbolic links followed and refuses the request with `fs/outside-workspace` when the resolved path is not inside the resolved cwd — including `..` segments, absolute paths, symbolic links on macOS, Linux and Windows hosts (junctions included), and Windows drive or UNC prefixes. Access outside a workspace exists only for device role `admin` through an explicit host scope: the tree action "Open host path…" (the host file browser) and RPC parameter `scope: "host"` with an absolute path. Each host-scope read of a file, write, delete or upload appends an audit record, and a host-scope panel shows a persistent "Outside workspace" chip in warning colour. A symbolic link inside a workspace that points outside is listed with a link icon and its target text, and opening it is a host-scope action. Regardless of role and scope, the proxies SHALL refuse with `fs/protected-path`: `<dataDir>/secrets/`, the server database and its journal files, OpenClaw credential stores and agent auth databases under the Gateway state directory, and device key stores of the desktop app. Limits enforced by the host: path length 4 096 bytes; 100 000 entries returned per directory in total; request rate 50 `fs` RPCs per second per device (`RATE_LIMITED`); 16 concurrent file reads per device. Agent tools keep the confinement and error code of `security-privacy.Agent tool sandbox`. [NEW]

#### Scenario: Traversal
- **WHEN** an `editor` calls `jagentchill.fs.read` with path `../../.ssh/id_ed25519`
- **THEN** the response is `fs/outside-workspace` and no bytes are returned

#### Scenario: Symlink escape
- **WHEN** a workspace contains `link -> /etc` and an `editor` lists `link/`
- **THEN** the response is `fs/outside-workspace`

#### Scenario: Admin host scope is audited
- **WHEN** an `admin` opens `/etc/hosts` through "Open host path…"
- **THEN** the panel shows the "Outside workspace" chip and an audit record `fs.read.host` with the path and the device id exists

#### Scenario: Protected path
- **WHEN** an `admin` requests `<dataDir>/secrets/FAL_KEY` with `scope: "host"`
- **THEN** the response is `fs/protected-path` and an audit record with outcome `denied` exists

### Requirement: Changes view with uncommitted and base diff
For workspaces of a git kind the explorer "Changes" tab SHALL show the working diff, pushed live through the stream `git:<workspaceId>` (`jagentchill.workspace.git.subscribe`; event `jagentchill.workspace.git.updated`; pull RPC `jagentchill.workspace.git.status`), recomputed at most once per 500 ms after file-system or index changes. A segmented control selects **Uncommitted** (index and work tree against `HEAD`, split into "Staged" and "Changes" groups, untracked files included) or **Against <base>** (the merge base of `HEAD` and `baseBranch` against the work tree, i.e. everything the workspace would contribute). The header shows the branch, ahead/behind counts against the upstream, and totals `<files> files · +<added> −<removed>`. Files are listed as a tree or a flat list (toggle, remembered per device) with status letter, path, per-file `+`/`−` counts, and row actions Open diff, Open file, Stage / Unstage, Discard (admin). Below the files a collapsible **Commits** section lists the commits of `<base>..HEAD` (newest first, 50 per page; short hash, subject, author, relative time, pushed/unpushed mark); selecting a commit lists its files, and selecting one opens a commit-diff panel (`jagentchill.workspace.git.commits`, `.commitDiff`). States: non-git workspace — "This folder is not a git repository" with "Initialize repository" (admin); no changes — "No changes"; `git` missing — "Git is not installed on the host"; detached `HEAD` — a "Detached at <short hash>" chip and the base view disabled; a merge or rebase in progress — a banner naming it with the conflicted files grouped first. A diff with more than 2 000 files or 50 MiB of patch text shows the too-large state "This diff is too large to display (<n> files)" with the file list only. [JAD JD-WS-019]

#### Scenario: Live update
- **WHEN** an agent modifies two tracked files and creates one new file
- **THEN** within 1 s the Uncommitted view lists 3 files and the totals change accordingly without a manual refresh

#### Scenario: Base diff
- **WHEN** the workspace has 2 commits ahead of `main` and one uncommitted change, and "Against main" is selected
- **THEN** the list contains every file changed by the 2 commits and by the uncommitted change, compared with the merge base

#### Scenario: Commit diff
- **WHEN** the user selects a commit and then one of its files
- **THEN** a commit-diff panel opens titled "<file> @ <short hash>" showing that commit's change to the file

#### Scenario: Too large
- **WHEN** the working diff contains 2 500 changed files
- **THEN** the too-large state is shown with the file list, and opening a single file's diff still works

#### Scenario: Not a repository
- **WHEN** the Changes tab of a `directory` workspace is opened
- **THEN** it shows "This folder is not a git repository" and, for an admin, "Initialize repository"

### Requirement: Per-file diff presentation
A diff panel SHALL render one file's change in **side-by-side** (default at the wide form factor) or **unified** (default below, and the only mode on compact) layout, switchable from the panel toolbar and remembered per device. It shows old and new line numbers, hunk headers, added and removed lines in the `diff/added` and `diff/removed` tokens of `design-system.Colour tokens` together with `+` / `−` gutter marks (never colour alone), intra-line change highlighting for hunks up to 500 lines, syntax highlighting for files up to 1 MiB, collapsed unchanged regions with "Show 20 more lines" / "Show all", and toggles for word wrap and "Hide whitespace changes". Toolbar: previous / next change, previous / next file of the list, Open file, Copy path, and for admins on the Uncommitted view Stage file, Unstage file, Discard file, plus per-hunk Stage / Unstage / Discard buttons in the hunk header. Special cases: renamed files show "old → new" and only content changes; binary files show "Binary file changed" with sizes and, for images, before / after previews with a swipe comparison; mode-only changes show the old and new mode; a file with more than 20 000 changed lines or 5 MiB of patch shows "This file's diff is too large to display" with "Open file". The panel updates live while its file changes and keeps the scroll position anchored to the first visible hunk. [JAD JD-WS-019] [NEW]

#### Scenario: Layout by width
- **WHEN** a diff panel is 1 100 px wide and then its pane is resized to 600 px
- **THEN** it renders side-by-side first and unified afterwards unless the user chose a layout explicitly on this device

#### Scenario: Stage a hunk
- **WHEN** an admin presses "Stage" on the second of three hunks
- **THEN** that hunk moves to the staged diff of the file, the other two stay unstaged, and the Changes list shows the file in both groups

#### Scenario: Image change
- **WHEN** a modified PNG is opened in a diff panel
- **THEN** before and after images are shown with their pixel dimensions and file sizes

#### Scenario: Whitespace-only change
- **WHEN** "Hide whitespace changes" is on and a file differs only by indentation
- **THEN** the panel shows "Only whitespace changes" and no hunks

### Requirement: Git actions
Admins SHALL have a split button in the Changes header whose primary action is chosen by state — "Commit" when there are staged or unstaged changes, "Push" when ahead, "Pull" when behind, "Pull and push" when both, "Create pull request" when pushed with no request, "View pull request" otherwise — and whose menu lists all of: Commit, Pull, Push, Pull and push, Create pull request, View pull request, Merge pull request ▸ (Squash / Merge commit / Rebase), Merge locally into <base>, Update from <base>, Switch branch…, Rename branch…, Discard all changes…, Refresh, Archive workspace. Each action shows a pending label ("Committing…", "Pushing…"), then a success label for 2 s ("Committed", "Pushed"), and on failure a toast with the first line of git's message and "Show details". Behaviour: **Commit** opens a box with subject (required) and body, the generate button of `workspaces-terminal.Metadata generation`, and "Stage all and commit" when nothing is staged; it uses the host's git identity and fails with "Set user.name and user.email in git on the host" when none is configured; hooks run, and a hook failure shows its output. **Pull** is `git pull --ff-only`; a diverged branch offers "Rebase onto upstream" and "Merge upstream". **Push** sets the upstream on first push and never forces; a rejected push reports `git/non-fast-forward` with "Pull and push". **Update from <base>** fetches and merges `baseBranch` (or rebases when `workspaces.updateStrategy` is `rebase`). **Merge locally** fast-forwards or merges the workspace branch into `baseBranch` in the main checkout and is refused with `git/dirty-worktree` when that checkout has uncommitted changes. **Switch branch** (branch switcher with search over local and remote branches and "Create branch") is refused with `git/dirty-worktree` listing the files when the switch would overwrite changes, offering "Stash and switch". **Rename branch** validates the name and updates the upstream when one exists. **Discard** restores tracked files and deletes untracked ones after a confirmation listing counts; discarded tracked content is first saved as a stash named `jagentchill-discard-<timestamp>` and the toast offers "Undo" for 30 s. Conflicts leave the repository in git's in-progress state with the banner of `workspaces-terminal.Changes view with uncommitted and base diff`, the conflicted files listed, and the actions "Abort merge" / "Abort rebase" and "Continue" (enabled when no conflict marker file remains unstaged). Every network action is limited to 5 minutes (`git/timeout`), uses only credentials already available to git on the host (`git/auth-failed` otherwise, with "Sign in to the git host on the host"), and one git mutation runs at a time per repository (`workspace/busy` for a second). [JAD JD-WS-020]

#### Scenario: Primary action follows state
- **WHEN** the branch has no local changes and is 2 commits ahead of its upstream
- **THEN** the primary button reads "Push"

#### Scenario: Push rejected
- **WHEN** the remote has new commits and the admin presses "Push"
- **THEN** nothing is forced, the toast reads "Push rejected — the remote has new commits" and offers "Pull and push"

#### Scenario: Discard is undoable
- **WHEN** an admin discards changes to 4 tracked files and presses "Undo" within 30 s
- **THEN** the 4 files hold their discarded content again

#### Scenario: Switch with local changes
- **WHEN** a switch to `release` would overwrite 2 modified files
- **THEN** the switch is refused with `git/dirty-worktree`, the dialog lists the 2 files and offers "Stash and switch" and "Cancel"

#### Scenario: No git identity
- **WHEN** `user.email` is not configured on the host and an admin commits
- **THEN** no commit is created and the message reads "Set user.name and user.email in git on the host"

#### Scenario: Editor role
- **WHEN** an `editor` opens the Changes tab
- **THEN** the split button is absent and row actions are limited to Open diff and Open file

### Requirement: Pull-request panel and forge integration
The server SHALL detect the forge from the `origin` remote URL — GitHub hosts through the `gh` CLI, GitLab hosts through the `glab` CLI — and SHALL use only those CLIs with the login already present on the Gateway machine; it stores no forge token. `jagentchill.workspace.hostInfo` reports `forge {kind: github | gitlab | none, cli: {available, authenticated, version}}`. Without a usable CLI the pull-request actions are disabled with "Install and sign in to <gh|glab> on the host", and git actions keep working. **Create pull request** opens a form: title and Markdown description (generated per `workspaces-terminal.Metadata generation`, editable), target branch (default `baseBranch`), "Draft" toggle, and a push of unpushed commits as its first step. A workspace whose branch has a request shows a state chip in the header and a **pull-request panel** (kind `pull-request`, also the third explorer tab "Pull request"): number, title, state (open / draft / merged / closed), author, target ← head, description rendered as Markdown, review decision (approved / changes requested / review required), mergeability (clean / conflicts / blocked), checks grouped by status with name, duration and "View details" opening the check URL in the OS browser, the 50 most recent review comments and comments, and the buttons "Open on <forge>", "Refresh", "Merge" with strategy (Squash / Merge commit / Rebase; strategies the repository disallows are disabled), "Enable auto-merge" where the forge supports it, and "Attach to chat". Status is refreshed when the panel opens, after every push, and every 60 s while the panel or the workspace row is visible (120 s otherwise; never while disconnected). Errors: `git/forge-unavailable`, `git/pr-not-found`, `git/auth-failed`, `RATE_LIMITED` with the forge's reset time shown. [JAD JD-WS-020, JD-WS-013]

#### Scenario: Create a draft pull request
- **WHEN** an admin with `gh` signed in submits the form with "Draft" on for a branch with 1 unpushed commit
- **THEN** the commit is pushed, a draft pull request targeting `main` is created, and the header chip shows "#<number> Draft"

#### Scenario: Failing checks
- **WHEN** 2 of 9 checks fail
- **THEN** the chip is in danger colour with "Checks failing", the panel lists the 2 failed checks first, and "Merge" is enabled only if the forge reports the request as mergeable

#### Scenario: Merge with squash
- **WHEN** an admin chooses Merge ▸ Squash on a mergeable request
- **THEN** the request state becomes merged within the next refresh and the chip reads "Merged"

#### Scenario: CLI missing
- **WHEN** the remote is on GitHub and `gh` is not installed on the host
- **THEN** "Create pull request" is disabled with "Install and sign in to gh on the host" and Commit, Pull and Push remain usable

### Requirement: Review comments attached to a chat turn
Users with role `editor` or `admin` SHALL be able to add review comments on any diff panel (working, base or commit) and on file panels: selecting one line or a range of up to 200 lines (click or drag in the gutter, long-press on touch) opens an inline box; a comment is `{id, workspaceId, path, side: old | new, startLine, endLine, quote (the selected lines, ≤ 8 000 characters), body (1–4 000 characters), diffContext: uncommitted | base | commit:<hash>, createdAt_ms}`. Comments accumulate in a per-workspace **review draft** (at most 100 comments) stored on the host so that every device shows the same draft; a "Review (n)" chip in the Changes header opens the draft list with edit, delete and jump-to-line. "Add to chat" attaches the whole draft, or selected comments, to the composer of the workspace's focused agent session as one **review attachment** (`chat-agent.Attachment types`), which is sent as structured text listing, per comment, the path, line range, quoted lines and body; sending the turn clears the attached comments from the draft. A comment whose quoted lines no longer match the file is kept and marked "Outdated" with its original quote. The review draft list and the diff panels are a review surface and register the `review` context with these action semantics (ids only; bindings are owned by `keyboard-shortcuts.Default bindings for workspaces, files, diffs and review`): `review.add-comment` opens the inline box on the focused line or selection; `review.next-item` and `review.previous-item` move to the next or previous comment of the draft and scroll its lines into view; `review.accept-item` includes the focused comment in the selection to send and `review.reject-item` excludes it (the comment stays in the draft); `review.submit` performs "Add to chat" with the selected comments, or the whole draft when none is selected. Review drafts never post to the forge. [JAD]

#### Scenario: Comment on a range
- **WHEN** a user drags over lines 12–18 on the new side of a diff and types "Use the 24 fps preset here"
- **THEN** a comment appears under line 18, the chip reads "Review (1)", and the same comment is visible on another device opening that diff

#### Scenario: Attach to a turn
- **WHEN** the user presses "Add to chat" with 3 comments and sends the message
- **THEN** the turn carries one review attachment listing 3 comments with paths, line ranges and quotes, and the draft is empty afterwards

#### Scenario: Outdated comment
- **WHEN** the commented lines are rewritten before the draft is sent
- **THEN** the comment is marked "Outdated", keeps its original quote, and is still attachable

#### Scenario: No session
- **WHEN** "Add to chat" is pressed in a workspace with no agent session
- **THEN** a draft panel opens with the review attachment already in its composer

#### Scenario: Review actions on the draft
- **WHEN** a draft holds 5 comments, the user runs `review.reject-item` on one after selecting all and then runs `review.submit`
- **THEN** a review attachment with the 4 selected comments is added to the composer of the focused agent session and the excluded comment stays in the draft

### Requirement: Pull-request and issue context attachments
The composer of a workspace session SHALL accept forge context as attachments (`chat-agent.Attachment types`): the workspace's own pull or merge request ("Attach to chat" in the pull-request panel), or any issue, pull request or merge request of the workspace's forge found through the attachment menu entry "Pull request or issue…" (search by number, URL or title, 20 results). The server resolves the attachment on the host with the forge CLI at send time into structured text: kind, number, title, state, author, target and head branches, description (≤ 20 000 characters), up to 50 most recent comments and review comments (each ≤ 4 000 characters, with file path and line when present), failing check names with their summaries, and the diff stat; "Include the diff" (off by default) adds the patch truncated to 200 KiB. The attachment chip shows the forge icon, "#<number>" and the title, and opens the pull-request panel or the OS browser. An attachment that cannot be resolved at send time blocks the send with "Failed to load #<number> from <forge>" and "Remove attachment" / "Retry". Forge content is untrusted input and is wrapped as such for the agent (`agent-editing-tools.Untrusted content handling`). [JAD]

#### Scenario: Attach the workspace's pull request
- **WHEN** the user presses "Attach to chat" in the pull-request panel and sends "Fix the failing checks"
- **THEN** the turn carries one attachment with the request's title, description, comments and the names of the failing checks

#### Scenario: Search by number
- **WHEN** the user types `128` in "Pull request or issue…"
- **THEN** issue or request #128 of the workspace's repository is the first result

#### Scenario: Resolution failure
- **WHEN** the forge CLI is signed out at send time
- **THEN** the message is not sent and the composer shows "Failed to load #128 from GitHub" with "Remove attachment" and "Retry"

### Requirement: Terminal enablement and host-shell warning
The terminal SHALL be off on a new Gateway (server setting `terminal.enabled: false`; OpenClaw's own `gateway.terminal.enabled` is kept false by the run profile whether the product terminal is on or off, because the product terminal never uses it; `gateway.cliAgents.enabled` follows CLI runtime enablement and is unrelated to the terminal, `platform-skeleton.Gateway run profile`). While it is off the Gateway does not advertise the handshake feature `terminal` (`updates-distribution.Feature flags and additive wire evolution`) and every method that would start or reach a terminal — in this capability and in `agent-runtimes.Native CLI in a host terminal` — fails with `terminal/disabled`, the single code for that condition. The scope for every terminal, workspace-script and git-mutation method is `jagentchill.host.exec`; `jagentchill.config.write` alone never reaches a terminal. Only a device with role `admin` (scope `jagentchill.host.exec`) can turn it on, in host settings → Terminal or from the disabled Terminal entry of a workspace. Turning it on SHALL show a blocking dialog titled "Enable the host terminal?" with exactly these statements: "The terminal is a real shell on the host, running as the operating-system user <user>." · "It is not sandboxed. Commands can read, change and delete anything that user can, including files outside this workspace." · "Every device paired as admin can open terminals. Agents you allow can type into terminals." · "Only enable this on a host you operate and trust." The primary button "Enable terminal" is disabled until the checkbox "I understand that the terminal has full access to this machine" is ticked. Enabling and disabling append audit records. While enabled, every terminal panel shows a one-line header chip "Host shell · <user>@<hostname>" and host settings → Terminal shows the same four statements permanently. Turning it off closes every terminal (reason `disabled`) after a confirmation that states the number of open terminals. The dialog is shown again whenever the terminal is turned on after having been off. [NEW]

#### Scenario: Default off
- **WHEN** an admin opens the new-tab page of a workspace on a new Gateway
- **THEN** "Terminal" is listed with "Disabled on this host" and "Enable…"

#### Scenario: Acknowledgement required
- **WHEN** the dialog is open and the checkbox is not ticked
- **THEN** "Enable terminal" is disabled, and `jagentchill.terminal.open` still fails with `terminal/disabled`

#### Scenario: Enabling is audited
- **WHEN** an admin ticks the checkbox and presses "Enable terminal"
- **THEN** an audit record `terminal.enabled` with that device id exists and the terminal can be opened

#### Scenario: Non-admin
- **WHEN** an `editor` views host settings → Terminal
- **THEN** the state and the four statements are shown read-only with no toggle

### Requirement: Terminal backend and worker process
PTYs SHALL NOT run in the Gateway's main event loop and SHALL NOT use the Gateway terminal. The server SHALL run a **terminal service**: a separate worker process, started by the server as one of its internal services and supervised by it with restart delays of 1 s, 5 s and 30 s, that itself spawns every PTY and holds for every terminal a headless terminal emulator fed with the terminal's byte stream; the emulator is the source of snapshots, captures, titles, shell-integration marks and activity state. There is one backend, `server-pty`, on every host: the worker spawns PTYs with `@lydell/node-pty`, whose prebuilt binaries are shipped for each supported host — macOS (arm64 and x64; forkpty), Windows 10 version 1809 or newer and Windows 11 (x64 and arm64; ConPTY), Linux (x64 and arm64, glibc; forkpty), the same Linux build being used by the Docker distribution — so no compiler is needed on the host. Because the worker owns the PTY, the launch specification of each terminal — profile command and arguments, working directory, the environment of `workspaces-terminal.Shell environment`, initial size — is applied directly at spawn, and bytes travel between worker and server over a local pipe and on to devices as the frames of `workspaces-terminal.Terminal stream encoding and back-pressure`; no Gateway terminal RPC, no `gateway.terminal.shell` launcher and no OpenClaw scope is involved. The Gateway's own terminal is never an alternative: the run profile keeps `gateway.terminal.enabled` false, and `jagentchill doctor` fails when it reads true. Spike S15 verifies on each of the three desktop host systems and in the Linux container that the worker spawns the default shell, resizes, delivers 100 MiB of output without stalling the Gateway loop, kills the process tree, and survives the disconnect of every device; on a host system where S15 fails the Gateway does not advertise the feature `terminal`, `jagentchill.terminal.*` answers `terminal/backend-unavailable`, and every other part of this capability works unchanged. `hostInfo.backends.terminal` is `server-pty`. Terminals belong to the server, not to a device connection, and a device disconnect never closes one. [JAD JD-TRM-001] [NEW]

#### Scenario: Gateway loop stays responsive
- **WHEN** a terminal prints 100 MiB with `cat` while another device calls `jagentchill.workspace.list`
- **THEN** the list call completes within 500 ms

#### Scenario: Terminal outlives its client
- **WHEN** the only attached device closes the app while `sleep 600` runs in a terminal
- **THEN** the process is still running 60 s afterwards and `jagentchill.terminal.list` reports the terminal with `attached` 0

#### Scenario: Worker crash
- **WHEN** the worker process is killed
- **THEN** it is restarted within 1 s, every terminal it held is reported with exit reason `worker-crashed`, and new terminals can be opened

#### Scenario: Same contract on each host system
- **WHEN** the terminal conformance suite opens the default profile, sets a custom cwd and a profile environment variable, resizes to 120 × 40 and writes the 256 byte values on a macOS, a Windows and a Linux host
- **THEN** on each host the shell starts in that cwd with that variable, reports 120 columns, and the bytes arrive unchanged

#### Scenario: Gateway terminal switched on by hand
- **WHEN** the Gateway configuration is edited by hand to `gateway.terminal.enabled: true`
- **THEN** the server resets it to false at start, a `security` audit record notes the correction, and `jagentchill doctor` reports the finding until it is false

### Requirement: Terminal RPC surface and size ownership
Channel P SHALL provide, for role `admin` unless stated: `jagentchill.terminal.open {workspaceId, profileId?, name?, command?, args?, cwd?, env?, cols, rows}` → `{terminalId, name, shell, cwd, cols, rows, createdAt_ms, owner}`; `.attach {terminalId, cols, rows}` → `{snapshot, seq, cols, rows, claimant?, title, state}` (also for devices with a read-only share); `.detach`; `.input {terminalId, dataB64, inputSeq}`; `.resize {terminalId, cols, rows, claim?}`; `.rename {terminalId, name}` (1–60 characters); `.close {terminalId, force?}`; `.list {workspaceId?}` → `{terminals[{terminalId, workspaceId, name, title, shell, cwd, cols, rows, state: running | exited, exitCode?, owner, attached, activity, shared, createdAt_ms, lastOutput_ms}]}`; `.capture`; `.history.list`; `.share.set`; `.takeover`; `.agentAccess.set {terminalId, allowAgents}`; `.clearAttention {terminalId}`; `.extend {terminalId}` ("Keep for 24 hours"); `.profile.list|upsert|delete`. `terminalId` is `term_` + 20 random base32 characters. A terminal belongs to the workspace that created it and is listed only there, even when another workspace shares the cwd; `owner` is `device:<deviceId>` or `agent:<sessionId>`. `cwd` is relative to the workspace cwd (default `.`). Size limits: 2–500 columns, 1–200 rows, default 80 × 24. **Size ownership:** one connection is the size claimant of a terminal. Focusing or typing in a terminal sends `resize {claim: true}`; subsequent geometry changes from the claimant resize the PTY; `resize` without `claim` from any other connection is ignored (`{applied: false}`). Non-claimant clients render the claimant's grid at its size, letterboxed or scrolled, with a chip "Sized by <device name>" and a "Use my size" button that claims. When the claimant detaches, the next client that focuses the terminal becomes claimant. List changes are pushed as `jagentchill.terminal.updated` on the stream `terminals:<workspaceId>`. [JAD JD-TRM-007, JD-TRM-005]

#### Scenario: Scoped to the creating workspace
- **WHEN** workspaces A and B share a cwd and a terminal is opened in A
- **THEN** `jagentchill.terminal.list {workspaceId: B}` returns no terminal

#### Scenario: Only the claimant resizes
- **WHEN** a desktop holds the claim at 180 × 50 and a phone attached to the same terminal rotates
- **THEN** the PTY stays 180 × 50, the phone's `resize` returns `applied: false`, and the phone shows "Sized by <desktop name>"

#### Scenario: Claim on interaction
- **WHEN** the phone user presses "Use my size"
- **THEN** the PTY is resized to the phone's grid and the desktop shows "Sized by <phone name>"

#### Scenario: Invalid size
- **WHEN** `open` is called with `cols: 0`
- **THEN** the response is `INVALID_PARAMS` and no terminal is created

### Requirement: Terminal stream encoding and back-pressure
Terminal bytes SHALL be carried binary-safe on channel P. Channel P allows binary WebSocket frames for terminal streams only (`server-api.Binary terminal frames`, which owns the frame layout and its negotiation at the handshake; binary frames are optional for both sides); when the connection negotiated them, the `dataB64` field of the event and request below is replaced by the raw bytes of one binary frame and every other field, limit and ordering rule of this requirement is unchanged. The fallback, supported by every client and host and used whenever binary frames were not negotiated, is base64 in JSON: event `jagentchill.terminal.data {terminalId, seq, kind: output | snapshot | restore, dataB64}` on the stream `terminal:<terminalId>`, and request `jagentchill.terminal.input {dataB64}`. The five frame kinds of the reference — output, input, resize, snapshot, restore — map to these three event kinds and the `input` and `resize` requests. The host never decodes, re-encodes or splits a multi-byte sequence into text: any byte sequence, including invalid UTF-8, arrives byte-identical. Output is coalesced with a leading and trailing edge of 5 ms per terminal in the worker and again per connection, and one event carries at most 65 536 raw bytes. Input requests carry at most 65 536 raw bytes (`terminal/input-too-large`); a client splits larger pastes into ordered requests numbered by `inputSeq`, which the host applies strictly in order and de-duplicates on retry. **Back-pressure:** per connection, when more than 262 144 bytes of output have accumulated since that connection's last snapshot **and** the connection has more than 4 194 304 bytes buffered for sending, the host SHALL drop that connection's queued output events and send one `snapshot` event (the emulator's screen and the newest 200 scrollback lines, serialised as escape sequences) with the current `seq`; the client replaces its screen with it. Towards the process, the worker pauses reading the PTY when the emulator's unprocessed input exceeds 8 MiB and resumes below 2 MiB, so a flooding program blocks instead of growing memory. `seq` increases by 1 per event per terminal; a client that sees a gap calls `attach` again. A terminal with no attached client sends nothing and keeps only the emulator state. [JAD JD-TRM-003, JD-TRM-002, JD-TRM-004] [NEW]

#### Scenario: Binary-safe
- **WHEN** a program writes the 256 byte values 0x00–0xFF to the terminal
- **THEN** the concatenated decoded `dataB64` of the output events equals those 256 bytes in order

#### Scenario: Coalescing
- **WHEN** a program writes 1 byte every 1 ms for 1 s
- **THEN** an attached client receives at most 201 output events for that second

#### Scenario: Slow client gets a snapshot
- **WHEN** `yes` runs while a client's connection is throttled so that more than 4 MiB are buffered
- **THEN** that client receives a `snapshot` event instead of the backlog, its screen matches the host emulator's screen, and a second, unthrottled client keeps receiving `output` events

#### Scenario: Large paste keeps order
- **WHEN** a client pastes 300 000 bytes
- **THEN** it sends 5 input requests with `inputSeq` 1–5 and the PTY receives the bytes in the original order exactly once, even if request 3 is retried

#### Scenario: Flood is bounded
- **WHEN** `cat /dev/urandom | base64` runs for 60 s with no attached client
- **THEN** the worker's resident memory grows by less than 64 MiB

### Requirement: Scrollback, attach and replay
The host emulator SHALL keep `terminal.scrollbackLines` lines per terminal (default 5 000, range 1 000–50 000, host setting; the reference value of 1 000 is the minimum). Each client keeps its own display scrollback, set by the personal preference "Terminal scrollback" (default 5 000, range 500–50 000 lines). `attach` returns a `restore` payload consisting of the current screen (including alternate-screen state, cursor position, modes and title) and the newest 200 scrollback lines, so a reattached terminal is usable within one round trip; when the user scrolls above the restored lines the client fetches older lines in pages of 1 000 with `jagentchill.terminal.capture {terminalId, start, end, stripAnsi: false}` until the host scrollback is exhausted, then shows "Start of scrollback". After a connection loss the client SHALL reattach every visible terminal automatically within 2 s of channel P reaching `ready`, and every hidden terminal when its tab is shown; output produced while disconnected is present after the reattach up to the host scrollback size. "Clear scrollback" clears the client buffer and, for admins, the host emulator's scrollback. A terminal whose process exited stays attachable, showing its final screen and the line "Process exited with code <n>" or "Terminated by <signal>", until its tab is closed or 24 h pass. [JAD JD-TRM-006] [NEW]

#### Scenario: Replay after reconnect
- **WHEN** a build prints 800 lines while the client is offline for 40 s and the client reconnects
- **THEN** the terminal shows the current screen immediately and the 800 lines are reachable by scrolling up

#### Scenario: Restore payload size
- **WHEN** a client attaches to a terminal with 5 000 lines of scrollback
- **THEN** the restore payload contains the screen and 200 scrollback lines, and scrolling above them triggers a capture request for the next 1 000

#### Scenario: Full-screen program
- **WHEN** a client attaches while `vim` is open in the alternate screen
- **THEN** the editor's screen and cursor position are drawn correctly without the user pressing a key

#### Scenario: Exited terminal
- **WHEN** a terminal's shell exits with code 2 while no client is attached and a client attaches one hour afterwards
- **THEN** the final screen is shown with "Process exited with code 2" and input is disabled

### Requirement: Terminal tabs, splits and naming
A terminal SHALL be a workspace panel of kind `terminal` (`workspaces-terminal.Panel kinds`); a workspace can hold several, each in its own tab, placed in any pane and split like any other panel so that at least 4 terminals are visible side by side at wide width. New terminals are created from the new-tab page, the "+" menu of a tab strip ("New terminal", then one entry per profile), the action `terminal.new`, and "Split terminal" in a terminal's tab menu (opens a new terminal with the same profile and the source terminal's current working directory when shell integration reports it, else the workspace cwd). The tab title is, in priority: the user's name (Rename…), the title set by the program (OSC 0/2, truncated to 60 characters, control characters removed), the profile name. The tab shows the profile icon, an activity indicator (`workspaces-terminal.Bell, activity and agent hooks`), an agent badge for agent-owned terminals and a lock icon for read-only shares. Tab menu: Rename…, Split right, Split down, Clear scrollback, Share read-only…, Restart (after exit), Close. Closing a tab whose terminal has a foreground process other than the shell asks "Close this terminal? <process name> is still running." (Close / Cancel); closing the tab closes the terminal for every device. Terminal tabs and their layout position are saved in the workspace layout; terminals themselves are not persisted across a Gateway restart (`workspaces-terminal.Terminal limits, kill and restart behaviour`). [JAD JD-TRM-008, JD-TRM-007]

#### Scenario: Several terminals in splits
- **WHEN** an admin opens 4 terminals and splits them right and down in a workspace whose centre area is at least 1 280 px wide
- **THEN** all 4 are visible at once, each with its own prompt and independent input

#### Scenario: Split inherits the directory
- **WHEN** the shell of terminal 1 is in `<cwd>/render` with shell integration active and the admin chooses "Split right"
- **THEN** the new terminal starts in `<cwd>/render`

#### Scenario: Close with a running process
- **WHEN** `ffmpeg` is running in a terminal and its tab is closed
- **THEN** a confirmation names `ffmpeg`, and "Close" terminates the process tree and removes the tab on every device

### Requirement: Terminal profiles
Host settings → Terminal SHALL manage **terminal profiles** `{id, name (1–40 characters), command, args[] (≤ 32, each ≤ 1 024 characters), env {NAME: value} (≤ 64 entries; names `^[A-Za-z_][A-Za-z0-9_]*$`), cwd? (relative to the workspace cwd, or absolute), icon?, isDefault}` stored in the server configuration (at most 32 profiles; admin only). Built-in profiles are generated from the shells found on the host and cannot be deleted: on macOS and Linux the user's login shell (default), plus `zsh`, `bash`, `fish` and `sh` when present; on Windows `pwsh` (default when present), `powershell.exe` and `cmd.exe`. A profile launches `command args` in place of the default shell with `env` applied on top of `workspaces-terminal.Shell environment`. Profile `env` values are configuration, not secrets: the form states "Do not put secrets here — values are visible to every admin device". Profiles are offered in the "+" menu of every tab strip and on the new-tab page; the default profile is used by `terminal.new`. `open` with an unknown `profileId` fails with `terminal/profile-not-found`; a profile whose `command` does not resolve to an executable fails with `terminal/shell-not-found` and the panel shows "<command> was not found on the host" with "Edit profile". The `worktree.terminals` entries of `jagentchill.json` are opened as terminals named by their `name`, running their `command` (default profile when absent), once, after setup succeeds, and only when the terminal is enabled and the configuration is trusted. [JAD JD-TRM-009] [NEW]

#### Scenario: Custom profile
- **WHEN** an admin creates the profile "Node REPL" with command `node` and opens it from the "+" menu
- **THEN** a terminal tab titled "Node REPL" shows the Node prompt

#### Scenario: Missing executable
- **WHEN** a profile's command is `fish` and `fish` is not installed
- **THEN** `open` fails with `terminal/shell-not-found` and the panel offers "Edit profile"

#### Scenario: Startup terminals
- **WHEN** a trusted `jagentchill.json` declares `worktree.terminals: [{"name": "dev", "command": "pnpm", "args": ["dev"]}]` and setup succeeds
- **THEN** a terminal tab "dev" running `pnpm dev` exists in the new workspace

#### Scenario: Built-in profile cannot be deleted
- **WHEN** an admin opens the menu of the login-shell profile
- **THEN** "Delete" is absent and "Duplicate" is present

### Requirement: Shell environment
A terminal, a script, a setup or teardown command and a CLI TUI SHALL start with an environment built by the server, not with the server's or the Gateway's process environment as-is: start from the server process environment (the PTY worker is a child of the server, not of the Gateway); remove every variable whose name matches (case-insensitively) `OPENCLAW_*`, `JAGENTCHILL_*`, `*_API_KEY`, `*_APIKEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `*_CREDENTIALS`, `AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS`, `ANTHROPIC_*`, `OPENAI_*`, `GEMINI_*`, `AZURE_*`, `HF_*`, `NODE_OPTIONS`, `ELECTRON_RUN_AS_NODE`, plus the names in `terminal.env.remove` (≤ 100 patterns); keep `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_*`, `TZ`, `TMPDIR` and `SSH_AUTH_SOCK` on macOS and Linux hosts (plus `XDG_*` and `DISPLAY` / `WAYLAND_DISPLAY` on Linux), and `Path`, `PATHEXT`, `USERPROFILE`, `USERNAME`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`, `ProgramData`, `ProgramFiles*`, `SystemRoot`, `SystemDrive`, `ComSpec`, `TEMP`, `TMP` and `PSModulePath` on Windows hosts; variable names are compared case-insensitively on Windows hosts; set `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=jagentchill`, `TERM_PROGRAM_VERSION`, `JAGENTCHILL_TERMINAL_ID`, `JAGENTCHILL_WORKSPACE_ID`, `JAGENTCHILL_WORKSPACE_PATH`; then apply `terminal.env.set` and the profile's `env`. Secret values held by the server (`security-privacy.Host secret storage`) are files and are never placed in any environment by this capability. A login shell is started as a login shell so the user's own profile files apply; what those files export is the operator's own configuration and is stated as such in host settings ("Variables set by your shell profile are available in the terminal"). The effective removal list is visible in host settings → Terminal → "Environment". [NEW]

#### Scenario: Gateway secrets are stripped
- **WHEN** the server process was started with `OPENCLAW_GATEWAY_TOKEN`, `FAL_API_KEY` and `ANTHROPIC_API_KEY` in its environment and an admin runs `env` in a new terminal
- **THEN** none of the three names appears in the output, and `PATH`, `HOME` and `TERM=xterm-256color` do

#### Scenario: Custom removal pattern
- **WHEN** `terminal.env.remove` contains `STUDIO_*` and the Gateway environment has `STUDIO_LICENSE`
- **THEN** `STUDIO_LICENSE` is absent in terminals, scripts and setup commands

#### Scenario: Scripts use the same environment
- **WHEN** a script runs `printenv OPENCLAW_GATEWAY_TOKEN`
- **THEN** it prints nothing and exits with code 1

### Requirement: Shell integration and command history panel
For `zsh` and `bash` (macOS and Linux hosts, and Git Bash on Windows hosts) and `pwsh` and `powershell.exe` (`pwsh` on all three host systems, Windows PowerShell on Windows hosts) the server SHALL inject shell integration without editing the user's files: zsh through a generated `ZDOTDIR` that sources the user's original (kept in `JAGENTCHILL_ZSH_ZDOTDIR`), bash through `--rcfile` of a generated file that sources the user's `~/.bashrc`, pwsh and Windows PowerShell through `-NoExit -Command` dot-sourcing a generated script after the profile. `cmd.exe`, `fish` and `sh` run without integration. The integration emits OSC 633 marks — `A` prompt start, `B` command start, `C` command executed, `D;<exit code>` command finished, `E;<command line>`, `P;Cwd=<path>` — and sets the title to the `~`-shortened cwd at the prompt and to the command line while a command runs. Other shells run without integration. The host setting `terminal.shellIntegration` (default on) and a per-profile switch disable it. From the marks the emulator worker records, per terminal, the last 500 commands as `{index, commandLine (≤ 4 096 characters), cwd, startedAt_ms, endedAt_ms?, exitCode?, startLine, endLine}`; history lives in memory with the terminal and is never written to disk. A **command history panel** (toggle in the terminal toolbar; side panel 280 px wide on wide and medium, bottom sheet on compact) lists commands newest first with exit status icon (success, failure with code, running spinner), duration and relative time, a filter field, and per-command actions: Jump to output (scrolls and highlights the command's lines for 2 s), Copy command, Copy output (≤ 1 MiB, ANSI stripped), Run again (types the command at the prompt without pressing Enter), and Attach output to chat. The terminal gutter shows a mark at each prompt line coloured by exit status, and the actions `terminal.command.previous` / `terminal.command.next` scroll between prompts. Without integration the panel shows "Command history needs shell integration (zsh, bash or PowerShell)". [JAD JD-TRM-010] [NEW]

#### Scenario: Exit codes are recorded
- **WHEN** a user runs `true` and then `false` in a zsh terminal
- **THEN** the history panel lists `false` with a failure icon and code 1 above `true` with a success icon

#### Scenario: Title follows command and directory
- **WHEN** the user runs `sleep 30` in `~/films`
- **THEN** the tab title is `sleep 30` while it runs and `~/films` when the prompt returns

#### Scenario: Jump to output
- **WHEN** the user chooses "Jump to output" on a command that printed 40 lines 2 000 lines ago
- **THEN** the terminal scrolls so the command line is at the top and those lines are highlighted for 2 s

#### Scenario: User files untouched
- **WHEN** integration is active for zsh
- **THEN** no file under the user's home directory is created or modified by the server, and aliases from the user's `.zshrc` work

#### Scenario: Unsupported shell
- **WHEN** a `fish` terminal's history panel is opened
- **THEN** it shows "Command history needs shell integration (zsh, bash or PowerShell)"

### Requirement: Copy, paste, find, links and file drop
The terminal SHALL support: **selection** by drag, double-click (word), triple-click (line), Shift+click (extend) and Alt+drag (block) on web/desktop, and by long-press with drag handles on touch; **copy** through the action `terminal.copy`, the context menu and, when the preference "Copy on select" (default off) is on, on selection; copied text has soft-wrapped lines rejoined and trailing spaces trimmed; **paste** through `terminal.paste`, the context menu and — on desktop and web clients running on Linux, where it is the platform convention — middle-click (macOS and Windows clients paste through `terminal.paste` and the context menu; iOS and Android through the paste item of the accessory bar), sent as bracketed paste when the program enabled it, with line endings normalised to carriage return; a paste that contains a newline while bracketed paste is off, or that exceeds 5 000 characters, asks "Paste <n> lines into the terminal?" with a 10-line preview (preference "Warn before multi-line paste", default on); **find** (`terminal.find`) with a field, next/previous, case, whole-word and regular-expression toggles, match count "3 of 41" (counting stops at 1 000, shown as "1 000+"), all matches highlighted, searching the client buffer; **links**: `http(s)` URLs open in the OS browser after Cmd/Ctrl+click (tap on touch) with the confirmation "Open <host>?" the first time a host is opened in the app session; file paths (absolute, `~`-relative, or relative to the command's cwd, with optional `:line` or `:line:column`) that exist on the host — verified in batches of at most 50 per screen through `jagentchill.fs.stat` — open in a file panel at that line when inside the workspace, and as a host-scope file (admin) otherwise; OSC 8 hyperlinks are honoured with the same rules; **file drop / attach**: dropping files on a terminal (desktop/web) or choosing "Send file…" (all platforms) uploads them through `workspaces-terminal.Upload and download between device and host` to `<dataDir>/terminal-uploads/<terminalId>/` (10 files and 2 GiB per drop; directory deleted when the terminal closes) and types their shell-quoted absolute paths separated by spaces without pressing Enter; dropping a file from the workspace tree types its relative path. Read-only viewers can select, copy and find, and cannot paste or drop. [JAD JD-TRM-014]

#### Scenario: Multi-line paste warning
- **WHEN** the clipboard holds 3 lines, bracketed paste is off and the user pastes
- **THEN** a dialog shows the 3 lines and nothing is sent until "Paste" is pressed

#### Scenario: Path link opens a file panel
- **WHEN** the output contains `src/render/export.ts:42:7` and that file exists in the workspace
- **THEN** the text is underlined on hover, and Cmd/Ctrl+click opens a file panel at line 42

#### Scenario: Find
- **WHEN** the user searches `error` in a buffer with 41 matches and presses next twice
- **THEN** the counter reads "3 of 41" and the third match is scrolled into view and focused

#### Scenario: File drop
- **WHEN** an admin drops `take 3.mov` on a terminal
- **THEN** the file is uploaded to the terminal's upload directory and `'<path>/take 3.mov'` is typed at the prompt with no Enter

#### Scenario: Read-only viewer
- **WHEN** a device with a read-only share invokes paste
- **THEN** nothing is sent and a hint reads "This terminal is view-only"

### Requirement: Bell, activity and agent hooks
A terminal tab SHALL show one indicator, in priority: **needs input** (warning dot), **bell** (bell icon), **running** (animated accent dot), **finished** (success dot), none. *Running* and *finished* come from shell-integration marks (a command running longer than 2 s that ends while the terminal is not focused on any visible client produces *finished*) and from agent hooks. *Bell* is set by the BEL character when the terminal is not focused; on a focused terminal the bell gives a 150 ms visual flash of the tab icon and, when the personal preference "Terminal bell" is `sound` or `haptic` (default `visual`), a short sound or haptic, rate-limited to one per second. Focusing the terminal on any visible client clears bell and finished for every device (`jagentchill.terminal.clearAttention`). *Finished* and *needs input* raise the notification kinds `terminal.finished` ("Terminal finished: <command or tab name>") and `terminal.needs_input` ("Terminal needs input: <tab name>", `requiresAction`) of `notifications.Notification event catalogue`, delivered only to devices with scope `jagentchill.host.exec` and routed by `notifications.Attention routing by presence` (which withholds them from a client that has that terminal focused); this capability raises at most one per terminal per 30 s. The workspace row shows the highest-priority indicator of its terminals. **Agent hooks** (host setting "Enable terminal agent hooks", default off, admin): when on, the server installs marker-tagged hook entries into the agent CLIs' own configuration on the host (`~/.claude/settings.json`, `~/.codex/hooks.json`, and a generated hook module in OpenCode's own configuration directory), each calling `jagentchill hooks <agent> <event>`; turning it off removes only the entries carrying the marker. Before enabling, a dialog lists the files that will be edited. Each terminal's environment carries `JAGENTCHILL_TERMINAL_ID` and `JAGENTCHILL_ACTIVITY_TOKEN` (32 random bytes, valid for that terminal only); the hook command reports `{terminalId, token, state: running | idle | needs-input}` through the server's host CLI (`jagentchill terminal activity`, which reaches the server over its local owner-only admin route; `server-api.Host command-line surface`) and any failure is a silent no-op with exit code 0. Mapping: prompt submitted or tool activity → running; stop, failure or session end → idle; permission request or idle-prompt notification → needs-input; a transition running → idle produces *finished*. [JAD JD-TRM-012, JD-TRM-011]

#### Scenario: Finished attention
- **WHEN** a 40 s build ends in a terminal whose tab is not focused on any device
- **THEN** the tab shows the finished dot, a notification "Terminal finished: pnpm build" is created, and focusing the tab on the phone clears the dot on the desktop within 2 s

#### Scenario: Bell on an unfocused terminal
- **WHEN** a program prints BEL in a background tab
- **THEN** the tab shows the bell icon until it is focused

#### Scenario: Hooks are opt-in and reversible
- **WHEN** an admin enables agent hooks and then disables them
- **THEN** after enabling, `~/.claude/settings.json` contains entries tagged with the JAgentChill marker, and after disabling those entries are gone while every other entry of the file is byte-identical to before

#### Scenario: Agent CLI needs input
- **WHEN** an agent CLI running in a terminal asks for a permission and its hook reports `needs-input`
- **THEN** the tab shows the warning dot, the workspace row reads "Needs input", and a notification is created

#### Scenario: Invalid token
- **WHEN** the hook command is called with a wrong token
- **THEN** the terminal's state is unchanged and the command exits with code 0 and no output

### Requirement: Terminal limits, kill and restart behaviour
The host SHALL enforce these terminal limits: 16 running terminals per workspace and 64 per Gateway (`terminal/limit-reached`, message "Close a terminal to open another (16 per workspace)"); both are host settings with ranges 1–64 and 1–256. **Idle limit:** a terminal with no attached client, no output and no input for `terminal.idleTimeoutMinutes` (default 720, range 5–10 080, 0 disables) is closed with exit reason `idle-timeout`. **Maximum lifetime:** `terminal.maxLifetimeHours` (default 168, range 1–8 760, 0 disables); 10 minutes before the limit attached clients see the banner "This terminal will close in 10 minutes" with "Keep for 24 hours" (admin, usable repeatedly), then the terminal is closed with reason `max-lifetime`. **Close** sends, on macOS and Linux hosts, SIGHUP to the foreground process group and, after 5 s, SIGKILL to the whole process tree, and on Windows hosts `CTRL_CLOSE_EVENT` followed after 5 s by `taskkill /T /F`; `close {force: true}` ("Kill" in the tab menu and in host settings → Terminal → "Running terminals", which lists every terminal of the Gateway with workspace, owner, age and a Kill button) sends SIGKILL immediately. `jagentchill.terminal.exit {terminalId, exitCode?, signal?, reason: process-exit | closed | killed | idle-timeout | max-lifetime | disabled | workspace-archived | worker-crashed | host-restarted | error}` is delivered to every attached client and is never dropped. **Gateway restart or stop:** terminals do not survive; the server terminates every PTY process tree during shutdown (5 s grace) and persists only terminal records (id, workspace, name, profile, cwd, owner — never output or history). After the restart each such tab shows the client's retained screen dimmed, the banner "This terminal ended because the host restarted" and "Restart terminal" (opens a new terminal with the same profile, name and cwd in the same tab position); records not restarted within 7 days are deleted. Reaching zero terminals never disables the terminal feature. [JAD JD-TRM-008] [NEW]

#### Scenario: Limit
- **WHEN** a workspace has 16 running terminals and an admin opens another
- **THEN** `open` fails with `terminal/limit-reached` and no process is started

#### Scenario: Idle timeout
- **WHEN** a detached terminal has had no input and no output for 720 minutes
- **THEN** it is closed, its record shows reason `idle-timeout`, and reopening its tab shows the final banner with "Restart terminal"

#### Scenario: Kill
- **WHEN** an admin presses "Kill" on a terminal running a process that ignores SIGHUP
- **THEN** the process tree no longer exists within 1 s and `exit` carries reason `killed`

#### Scenario: Gateway restart
- **WHEN** the Gateway restarts while 3 terminals are open on a connected desktop
- **THEN** after reconnecting, the 3 tabs keep their position, show the restart banner over their last screen, and "Restart terminal" starts a fresh shell in the same cwd

#### Scenario: No orphan processes
- **WHEN** the Gateway stops while a terminal runs a server process
- **THEN** that process is not running 10 s after the stop

### Requirement: Read-only terminal sharing
Terminal output can contain secrets, so a terminal SHALL be visible only to `admin` devices unless an admin shares it: "Share read-only…" in the tab menu sets `jagentchill.terminal.share.set {terminalId, audience: none | editors}` (default `none`). With `editors`, devices of role `editor` see the terminal's tab with a lock icon and "View only", can attach, scroll, select, copy and find, receive the same output stream, and every mutating call (`input`, `resize` with claim, `rename`, `close`, `capture` beyond what was streamed to them, `takeover`, file drop) fails with `terminal/read-only`. `viewer` devices never see terminals. A shared terminal shows a persistent "Shared with editors" chip to admins, sharing ends when the terminal closes, is not inherited by restarted or split terminals, and each change appends an audit record. The `editors` audience is the only way a terminal is shared: the product has no guest access and no share link for terminals, and sharing an agent session never includes its terminals. [JAD JD-TRM-016] [NEW]

#### Scenario: Not shared by default
- **WHEN** an `editor` lists terminals of a workspace with 2 unshared terminals
- **THEN** the list is empty and no terminal tab is shown

#### Scenario: View-only attach
- **WHEN** an admin shares a terminal with editors and an `editor` attaches
- **THEN** the editor sees live output, and a key press sends nothing and shows "This terminal is view-only"

#### Scenario: Mutation refused on the host
- **WHEN** the same `editor` device calls `jagentchill.terminal.input` directly
- **THEN** the response is `terminal/read-only` and the PTY receives no bytes

#### Scenario: Sharing does not carry over
- **WHEN** a shared terminal exits and the admin presses "Restart terminal"
- **THEN** the new terminal's audience is `none`

### Requirement: Mobile terminal presentation
On iOS and Android — phones and tablets, with the same functions, key row, gestures and limits on both systems — the terminal SHALL be rendered by a **native grid renderer** (the default: the client-side headless emulator state drawn as native text rows with its own selection gesture, key dispatch, resize policy and box-drawing glyphs), with a **web-view renderer** (the web terminal component inside a WebView) selectable by the personal preference "Use web terminal renderer" (default off) and used automatically when the native renderer reports an initialisation failure, with a one-time notice. Both use the same stream, find, link and paste logic. Presentation: the terminal fills the centre panel between the workspace header and an **extra key row** fixed above the software keyboard (44 pt high, horizontally scrollable, each key at least 44 × 44 pt): `Esc`, `Tab`, `Ctrl` and `Alt` (sticky: one tap arms the modifier for the next key and highlights it, double tap locks it, a third tap releases), `↑`, `↓`, `←`, `→` (auto-repeat when held: 400 ms delay, then 20 per second), `Home`, `End`, `PgUp`, `PgDn`, `|`, `/`, `~`, `-`, a paste key and a keyboard-dismiss key. Gestures: tap focuses and shows the keyboard; long-press starts selection with handles and a Copy / Paste / Select all menu; vertical drag scrolls the scrollback; two-finger pinch changes the font size 8–24 pt (default 12 pt, remembered per device); a "Jump to bottom" button appears when scrolled up. Hardware keyboards are fully supported, including Ctrl and Alt combinations, and hide the extra key row. The grid is sized to the visible area and resized when the keyboard shows or hides and on rotation, subject to size ownership. Dictation and autocorrect are disabled for the terminal input; IME composition is supported and committed text is sent on commit. Tabs are switched from the tab-switcher sheet of `workspaces-terminal.Compact layout with three exclusive panels`; splits are not available at compact width. The key row is attached to the software keyboard on both systems (an input accessory view on iOS; a row laid out above the input method with resize-on-keyboard behaviour on Android) and stays above the system navigation area; the Android back button or gesture closes the keyboard first, then the open sheet, and never sends a key to the PTY. When the app is backgrounded the terminal detaches after 30 s and reattaches with replay on return, on both systems. [JAD JD-TRM-013] [NEW]

#### Scenario: Sticky Ctrl
- **WHEN** the user taps `Ctrl` in the key row and then `c` on the software keyboard
- **THEN** the byte 0x03 is sent and `Ctrl` is no longer highlighted

#### Scenario: Renderer preference
- **WHEN** "Use web terminal renderer" is turned on and a terminal is opened
- **THEN** the terminal is drawn by the web-view renderer and the extra key row is still present

#### Scenario: Keyboard resize
- **WHEN** the phone holds the size claim and the software keyboard opens
- **THEN** the grid's row count shrinks to the visible area and the PTY is resized to match, with the cursor line visible

#### Scenario: Return from background
- **WHEN** the app is backgrounded for 5 minutes while a build prints output and is then opened again
- **THEN** the terminal reattaches within 2 s and the missed output is in the scrollback

### Requirement: Terminal accessibility
The terminal SHALL be operable and perceivable per `i18n-accessibility.Keyboard operability`, `i18n-accessibility.Screen reader semantics`, `i18n-accessibility.Colour contrast`, `i18n-accessibility.Reduced motion and flashing` and `i18n-accessibility.Text scaling and zoom`: (1) on web/desktop the emulator's screen-reader mode is enabled whenever assistive technology is detected or the preference "Screen reader mode for terminals" is on, exposing the buffer as navigable text lines and announcing new output through a polite live region, batched to at most one announcement per 500 ms and truncated to the last 20 lines per batch; the native grid renderer exposes each row as an accessibility text element and announces new output the same way; (2) focus never becomes trapped: the action `terminal.focus.leave` moves focus from the terminal to its tab, and `terminal.focus.next-pane` / `terminal.focus.previous-pane` move between panes, and these three actions take precedence over terminal key input; the terminal's accessible description names them; (3) every terminal function reachable by pointer (copy, paste, find, clear, split, history, rename, close, send file) is reachable from the tab menu and the command palette; (4) the 16 ANSI colours and default foreground/background come from the tokens `terminal/bg`, `terminal/fg`, `terminal/cursor`, `terminal/selection` and `terminal/ansi/*` of `design-system.Terminal tokens` in light and dark themes, and text is drawn with a minimum contrast ratio of 4.5:1 against its cell background (colours are adjusted at render time when a program picks a lower-contrast pair; preference "Preserve exact terminal colours" turns the adjustment off); (5) the cursor blinks at 1.06 Hz only when reduced motion is off, and the visual bell never flashes more than once per second; (6) font size 8–32 px on web/desktop (default 13 px) with the actions `terminal.font.increase|decrease|reset`, following OS text scaling on mobile; the default font is the monospace family of `design-system` with a user-selectable host-independent font list; (7) indicators (activity, exit status, read-only, size ownership) carry an icon or text and an accessible name, never colour alone; (8) an exited or disconnected terminal announces its state once. [NEW]

#### Scenario: Leaving the terminal by keyboard
- **WHEN** focus is inside a terminal running a full-screen program and the user invokes `terminal.focus.leave`
- **THEN** focus moves to the terminal's tab and the program receives no key

#### Scenario: Screen reader output
- **WHEN** screen reader mode is on and a command prints 3 lines
- **THEN** the 3 lines are announced once through a polite live region within 1 s

#### Scenario: Low-contrast program colours
- **WHEN** a program prints dark-blue text on the dark theme's background
- **THEN** the rendered text has a contrast ratio of at least 4.5:1 unless "Preserve exact terminal colours" is on

#### Scenario: Reduced motion
- **WHEN** the OS reduced-motion setting is on
- **THEN** the cursor does not blink and activity dots do not animate

### Requirement: Workspace agents run in the workspace directory
A workspace-agent session SHALL execute with `cwd` equal to its workspace's `cwd` (the worktree directory for worktree workspaces), set at session creation and immutable afterwards; its file and exec tools resolve relative paths against that directory, and its `permissionMode` boundary is that directory (OpenClaw `sessionRoot`). The session header shows a chip with the workspace name, branch and `~`-shortened path. If the directory no longer exists when a turn starts, the turn is not started and the agent panel shows "The workspace folder is missing: <path>" with "Open History" (restore) — `workspace/root-missing`. Sub-agents spawned by a workspace agent inherit the same workspace and cwd unless the spawn names another workspace the spawning session's creator is allowed to use; a spawn with the `worktree` parameter of `multi-agent-orchestration.Tool jc_agent_create` creates an owned worktree workspace under the same folder, only in a tree whose root owner device holds `jagentchill.host.exec`, subject to the limits of `workspaces-terminal.Worktree targets and limits`. Files a workspace agent changes appear in the Files and Changes tabs through the same watcher as human edits. Creative agents never receive a workspace cwd other than their project's managed workspace and have no exec or terminal tool (design D25). A workspace-agent turn executes host commands only when the server recorded a permitted initiator for it (`server-api.Run initiator attribution and host-execution gating`). The mode set and unattended-mode badge are those of `chat-agent.Composer modes`; a workspace-agent session in an unattended mode shows the warning badge "Unattended — can run commands on the host". [JAD JD-WS-023] [NEW]

#### Scenario: Commands run in the workspace
- **WHEN** a workspace agent in a worktree workspace runs `pwd` through its exec tool
- **THEN** the output is the worktree directory

#### Scenario: Missing directory
- **WHEN** the worktree directory was deleted outside the app and the user sends a message
- **THEN** no turn starts and the panel shows "The workspace folder is missing: <path>" with "Open History"

#### Scenario: Creative agent has no shell
- **WHEN** a creative agent's session is inspected with OpenClaw `tools.effective`
- **THEN** no exec, process or terminal tool and no `jc_terminal_*` tool is listed

#### Scenario: Agent edits show up live
- **WHEN** a workspace agent writes `cuts/list.json`
- **THEN** the file appears in the Files tree and in Changes within 1 s

### Requirement: Agent terminal tools
The server SHALL serve from its tool endpoint (`server-api.Agent tool endpoint and session binding`), for workspace agents only and only in sessions whose owner device holds `jagentchill.host.exec` (an `editor`-owned workspace session has no terminal tools), the tools `jc_terminal_list {all?}`, `jc_terminal_create {name?, command?, args?, cwd?, profileId?, cols?, rows?}`, `jc_terminal_kill {terminalId}`, `jc_terminal_capture {terminalId, start?, end?, scrollback? (default 200, ≤ 5 000 lines), stripAnsi? (default true)}` → `{lines[], totalLines, cursor {row, col}, state, exitCode?}` and `jc_terminal_send_keys {terminalId, keys, literal? (default false)}` (names registered in `agent-editing-tools.Tool naming and families`). With `literal: false`, `keys` is a space-separated list of literal words and key tokens (`Enter`, `Tab`, `Escape`, `Space`, `Backspace`, `Delete`, `Up`, `Down`, `Left`, `Right`, `Home`, `End`, `PageUp`, `PageDown`, `F1`–`F12`, `C-<char>`, `M-<char>`); with `literal: true` the text is sent verbatim; at most 8 192 bytes per call. A terminal created by an agent is attached to the agent's workspace, has `owner: agent:<sessionId>`, counts against the terminal limits, and is closed when the owning session is archived. **Ownership (corrects the reference, which has no check):** an agent can list, capture, type into and kill only terminals owned by its own session or by a session in its own spawn tree, plus human-owned terminals of the same workspace that an admin explicitly marked "Allow agents to use this terminal" (tab menu, default off, shown as an agent badge); any other target fails with `terminal/not-owner`. **Approvals:** the tools are available only when the terminal is enabled; in `ask` and `plan` modes `create`, `send_keys` and `kill` are refused; in `edit` mode `create` and each `send_keys` to a terminal raise a server approval of kind `host-exec` (`server-api.Approval and question resolution`: the tool endpoint returns `APPROVAL_PENDING:<requestId>` without acting, and the agent's identical retry passes once after an allow) whose card shows the command or keys verbatim, with the choices "Allow once", "Allow for this terminal in this session" and "Deny", answerable only by a device with role `admin` and scope `jagentchill.host.exec` that can act in the session — the server checks the resolver's role when it resolves, and every other device sees "Waiting for an admin device" — expiring after 30 minutes (`APPROVAL_TIMEOUT`); in `auto` mode they run without a card only when the session's unattended flag was explicitly turned on by an admin. `list` and `capture` of permitted terminals need no approval. Every `create`, `send_keys` and `kill` appends an agent-category audit record with the byte count, never the text. For ACP and CLI runtimes the tools are available only when that runtime's `jc_*`-tool bridge is enabled (flag `jcTools` of `agent-runtimes.Capability flags per runtime`); otherwise these tools are absent and the runtime's own command tool is used, whose native approvals are held and resolved by the server under the same `host-exec` rule. **The Gateway terminal is never offered to an agent:** the tool policy of every agent entry the server writes denies the Gateway tools `terminal` and `exec {pty: true}`; as a second barrier the server, which sees every tool item of the Gateway's `agent` events, aborts a run in which either tool starts (`sessions.abort`, audit code `SCOPE_DENIED`, per `server-api.Run initiator attribution and host-execution gating`); and `jagentchill doctor` fails when `tools.effective` of any session lists `terminal`. Because `gateway.terminal.enabled` is always false, the Gateway tool has no backend even if both barriers were bypassed. [JAD JD-TRM-015] [NEW]

#### Scenario: Create and drive a terminal
- **WHEN** a workspace agent in `edit` mode calls `jc_terminal_create {name: "render"}` and then `jc_terminal_send_keys {keys: "pnpm render Enter"}`, and the user chooses "Allow for this terminal in this session" on the first card
- **THEN** a terminal tab "render" with an agent badge appears, the command runs, and subsequent `send_keys` to that terminal in that session raise no further card

#### Scenario: Capture
- **WHEN** the agent calls `jc_terminal_capture {terminalId, scrollback: 50}`
- **THEN** it receives at most 50 scrollback lines plus the screen, without escape sequences, with `totalLines` set

#### Scenario: Ownership enforced
- **WHEN** an agent calls `jc_terminal_send_keys` on a human-owned terminal that is not marked for agent use
- **THEN** the tool returns `terminal/not-owner` and the terminal receives no input

#### Scenario: Ask mode
- **WHEN** the session is in `ask` mode and the agent calls `jc_terminal_create`
- **THEN** the call is refused, nothing starts, and the reply offers "Switch to Edit"

#### Scenario: Gateway terminal tool
- **WHEN** a workspace agent on the built-in runtime calls the Gateway tool `terminal`
- **THEN** the tool is absent from `tools.effective`, a direct call is refused by the Gateway's tool policy, the server records the attempt with `SCOPE_DENIED`, and no shell is started

#### Scenario: Editor cannot approve terminal keys
- **WHEN** an `editor` device answers "Allow once" on a `jc_terminal_send_keys` approval of an admin-owned session it cannot read
- **THEN** the answer fails, the approval stays pending, and no key is sent

#### Scenario: Approval timeout
- **WHEN** a permission card for `send_keys` is unanswered for 30 minutes
- **THEN** the tool returns `APPROVAL_TIMEOUT` and no key is sent

### Requirement: Agent terminal visibility and human takeover
Every agent-owned terminal SHALL be visible to admins as a normal terminal tab in the agent's workspace, opened automatically (unfocused) in the pane of the agent's panel when it is created, with an agent badge and the owning session's name; each `jc_terminal_send_keys` also appears in the session timeline as a tool call that links to the terminal. Humans **watch** by default: the terminal renders live, and typing shows the inline prompt "This terminal is controlled by <agent>. Take over?". **Take over** (button in the terminal header, `jagentchill.terminal.takeover {terminalId, control: human | agent}`, admin) gives input to the human: the header shows "You are in control" in warning colour, the agent's `send_keys` and `kill` calls fail with `terminal/human-control` (the tool result tells the agent the terminal is under human control), `capture` keeps working, and a status line "<device name> took over terminal <name>" is appended to the session timeline. **Hand back** returns input to the agent and appends "Terminal <name> handed back". Take-over is released automatically when the controlling device has been detached for 10 minutes. A human can always Kill an agent-owned terminal. The reverse direction — an agent using a human's terminal — requires the per-terminal switch of `workspaces-terminal.Agent terminal tools`; while it is on, input from the human and the agent is interleaved in arrival order and the header shows "Shared with <agent>". [NEW]

#### Scenario: Watching
- **WHEN** an agent creates a terminal and runs a long command
- **THEN** the admin sees the tab appear with an agent badge and live output without having approved anything beyond the tool call

#### Scenario: Take over
- **WHEN** the admin presses "Take over" while the agent's command waits for a `y/N` answer, types `n` and Enter
- **THEN** the terminal receives `n`, the session timeline shows the takeover status line, and a concurrent `jc_terminal_send_keys` from the agent returns `terminal/human-control`

#### Scenario: Hand back
- **WHEN** the admin presses "Hand back"
- **THEN** the agent's next `jc_terminal_send_keys` succeeds subject to its approvals

#### Scenario: Automatic release
- **WHEN** the device in control disconnects and stays away for 10 minutes
- **THEN** control returns to the agent and the timeline records "Terminal <name> handed back"

### Requirement: CLI runtime interface in a terminal tab
Admins SHALL be able to run an installed agent CLI's own full-screen interface in a terminal tab of a workspace: the "+" menu of a tab strip lists "Agent CLI ▸" with one entry per runtime that `agent-runtimes.Runtime snapshot` reports as installed with `pty: true`. Choosing one starts it in the workspace cwd by launching the CLI's command through a generated terminal profile in the server's own PTY (`workspaces-terminal.Terminal backend and worker process`) — the same way on macOS, Windows and Linux hosts, with the executable path taken from `agent-runtimes.Runtime snapshot`; OpenClaw `sessions.catalog.startTerminal` and the Gateway terminal are not used. The tab has kind `terminal` with sub-kind `cli`, the CLI's icon and name, and behaves as any terminal (attach, replay, size ownership, limits, sharing, environment of `workspaces-terminal.Shell environment`, in which the CLI uses its own login on the host). The product receives only the byte stream of such a tab: it shows no structured tool calls, proposals, usage or cost for it, the tab header shows "Terminal mode — activity is not tracked" (the same statement as `agent-runtimes.Native CLI in a host terminal`, whose entry points open this tab), and attention indicators come only from agent hooks. "Continue in a session" imports the CLI's most recent conversation in that cwd as a JAgentChill session through `agent-runtimes.Session import from a CLI's native history` when the session catalog supports it, and is hidden otherwise. An `initialMessage` typed in a draft panel with "Open in CLI" selected is passed to the CLI as its first prompt. [JAD] [NEW]

#### Scenario: Start a CLI interface
- **WHEN** an admin chooses "Agent CLI ▸ Claude Code" in a workspace
- **THEN** a terminal tab opens running that CLI's interface with the workspace cwd as its working directory, and the tab header shows "Terminal mode — activity is not tracked"

#### Scenario: CLI not installed
- **WHEN** no agent CLI is detected on the host
- **THEN** "Agent CLI ▸" shows "No agent CLI found on the host" and "Set up providers"

#### Scenario: Reattach after reconnect
- **WHEN** the client reconnects while the CLI interface is drawing in the alternate screen
- **THEN** the interface is redrawn correctly from the restore payload without user input

#### Scenario: Editor role
- **WHEN** an `editor` opens the "+" menu
- **THEN** "Agent CLI ▸" and "New terminal" are absent

### Requirement: Workspace screen layout
At the medium and wide form factors of `design-system.Breakpoints and layout constants` — in the desktop app on macOS, Windows and Linux, in a browser, and on iPad and Android tablets — the workspace screen SHALL consist of: the app sidebar (`app-shell-navigation.Global shell layout`) listing folders → workspaces; a **workspace header** 48 px high with the workspace name, branch chip (opens the branch switcher for admins), bound video-project chips, pull-request chip, Scripts button, transfers button, git split button and a ⋯ menu (Workspace settings, Link video project…, Copy path, Reveal in file manager — where `workspaces-terminal.Client-visible and host-only data` offers it —, Archive); a **centre area** of tab strips 36 px high over panes arranged by `workspaces-terminal.Split panes and layout persistence`; and a right **explorer** with the tabs "Files", "Changes" and, when the branch has a request, "Pull request" — default width 320 px, resizable 240 px to 50 % of the content width, collapsible by the action `workspace.explorer.toggle`, overlaying the centre area as a 320 px sheet at the medium form factor. The agents roster is not a column of this layout: it is the Agents tab, and its optional dock is placed and limited only by `multi-agent-orchestration.Agents tab and roster`. Tab strips show icon, title, state indicator and a close button on hover or focus; tabs are reorderable and movable between panes by drag on web/desktop and by "Move to pane ▸" in the tab menu on every platform; a "+" button opens the new-tab page listing the panel kinds available to the role. All surfaces use the tokens and components of `design-system` (shell, tab strip, tree, splitters, empty states) in the app's shared visual language in light and dark themes; no colour, radius or spacing value is defined by this capability. A workspace with no open panel shows the empty state "Nothing open" with the buttons "New agent", "New terminal" (admin, terminal enabled) and "Browse files". [JAD JD-WS-013, JD-WS-014, JD-WS-015] [NEW]

#### Scenario: Default layout
- **WHEN** an admin opens a newly created workspace at the wide form factor
- **THEN** the screen shows the sidebar, the 48 px header, one pane with a draft panel and the explorer 320 px wide on the Files tab

#### Scenario: Explorer limits
- **WHEN** the user drags the explorer splitter to 150 px
- **THEN** the explorer stops at 240 px

#### Scenario: Medium width
- **WHEN** the window is at the medium form factor and the user toggles the explorer
- **THEN** it opens as a 320 px overlay above the centre area and closes on Escape or an outside press

#### Scenario: Empty workspace
- **WHEN** the last panel is closed
- **THEN** "Nothing open" is shown with the role's available buttons

### Requirement: Panel kinds
The centre area SHALL host panels of these kinds, each a tab: `draft` (new-agent composer with runtime, model, mode and isolation controls; becomes an `agent` panel when sent; several drafts allowed); `agent` (the chat pane of a session of this workspace, behaviour owned by `chat-agent`; one panel per session); `subagent` (read-only timeline of a runtime-native sub-agent, with no composer); `terminal` (including sub-kind `cli`); `file` (viewer or editor of one path; one panel per path, a second open focuses the first); `diff` (working or base diff of one file); `commit-diff` (one file at one commit); `setup` (one per workspace); `script-log` (one per script run); `pull-request` (one per workspace); and `editor` (the timeline preview of a bound video project as defined by `chat-agent.Timeline preview tab`, one per bound project, with "Open in editor" navigating to `/editor/[projectId]`; the full four-region editor is never embedded in a pane). Single-click on a tree or Changes row opens a **preview tab** (italic title) that the next single-click replaces; double-click, editing, or the tab action "Keep open" makes it permanent. The reference's in-app browser tab and extension-contributed tabs are not offered: links open in the OS browser and third-party panels do not exist in this product. Inside a session's split view (`chat-agent.Session split view`), the session workspace pane gains the tabs "Files" (this capability's explorer tree for the session's workspace, replacing the read-only tree of `chat-agent.Files tab` with the role rules above), "File changes" (this capability's Changes view, distinct from the project-proposal "Changes" tab) and "Terminal" (admin), all bound to the session's workspace. [JAD JD-WS-013] [NEW]

#### Scenario: One panel per file
- **WHEN** `brief.md` is open in pane 1 and the user double-clicks it in the tree while pane 2 is focused
- **THEN** the existing panel in pane 1 is focused and no second `brief.md` panel is created

#### Scenario: Preview tab is replaced
- **WHEN** the user single-clicks `a.txt` and then single-clicks `b.txt`
- **THEN** one preview tab exists, showing `b.txt`

#### Scenario: Video project panel
- **WHEN** a workspace is linked to "Vlog 12" and the user presses its chip
- **THEN** an `editor` panel shows the project's timeline preview, and "Open in editor" navigates to `/editor/<projectId>`

#### Scenario: Draft becomes agent
- **WHEN** the user sends the first message from a draft panel
- **THEN** the same tab becomes an `agent` panel titled with the session title and keeps its position

#### Scenario: Session pane shows file changes separately
- **WHEN** a workspace-agent session has modified 2 files and submitted no project proposal
- **THEN** the "File changes" tab lists 2 files and the "Changes" tab shows "No changes yet"

### Requirement: Split panes and layout persistence
At the medium and wide form factors a pane SHALL be splittable right or down (tab menu, drag of a tab to a pane edge showing a drop zone covering that half, actions `workspace.pane.split-right|split-down`) into a tree of horizontal and vertical splits built with `design-system.Resizable panels and splitters`. Limits: 4 panes at the wide form factor, 2 at medium; minimum pane size 320 × 200 px — a split or resize that would violate the minimum is refused, and when the window shrinks below what the panes need the smallest unfocused pane's tabs merge into its neighbour (restored when space returns); 12 tabs per pane and 32 per workspace, where opening one more replaces the least recently used unpinned `file`, `diff` or `commit-diff` tab that has no unsaved edits (never an agent, draft, terminal or setup tab; if none qualifies the open is refused with "Close a tab to open another"). Closing the last tab of a pane removes the pane. "Maximise pane" (double-click on a tab strip, action `workspace.pane.maximise`) toggles one pane over the centre area. The layout — split tree with ratios, tabs per pane with order, active and pinned state, per-panel view state (scroll, diff mode, word wrap, terminal font size), explorer width, tab and collapsed state — SHALL be stored **per workspace per device**, written within 500 ms of a change, restored on reopening the workspace, and never synced between devices; a new device starts with one pane holding the workspace's sessions' most recent agent panel, or a draft panel. Tabs whose target no longer exists (deleted file, closed terminal, archived session) are restored with their end state banner, not silently dropped. Layout version mismatches fall back to the default layout. Archiving is host-wide and clears the stored layout on every device at the next connection. [JAD JD-WS-014] [NEW]

#### Scenario: Split and persist
- **WHEN** the user splits right, moves a terminal into the new pane, sets the ratio to 60/40 and restarts the app
- **THEN** the workspace reopens with two panes at 60/40 and the terminal tab in the right pane, reattached

#### Scenario: Layout is per device
- **WHEN** the same workspace is opened on a second desktop
- **THEN** it shows that device's own layout, not the first device's

#### Scenario: Minimum size
- **WHEN** a 700 px wide pane at the wide form factor is split right twice
- **THEN** the second split is refused because a pane would be narrower than 320 px

#### Scenario: Tab limit protects live panels
- **WHEN** a workspace has 32 tabs of which 30 are terminals and agents and 2 are file tabs with unsaved edits, and the user opens another file
- **THEN** the open is refused with "Close a tab to open another"

#### Scenario: Pane limit at medium width
- **WHEN** the window is at the medium form factor with 2 panes and the user invokes split
- **THEN** the split is refused and the action is shown disabled

### Requirement: Compact layout with three exclusive panels
At the compact form factor of `design-system.Breakpoints and layout constants` — phones on iOS and Android and any compact window — the workspace screen SHALL present three mutually exclusive panels driven by one horizontal position — **list** (left: folders and workspaces), **centre** (the active panel) and **explorer** (right: Files / Changes / Pull request) — moved by horizontal swipe from the screen edges (24 pt edge zones, so that terminal, editor and diff content keeps its own horizontal gestures), by the header buttons (list icon at the left, explorer icon at the right) and by the system back action — the Android back button or gesture, the iOS edge swipe, the browser or desktop back command — (explorer → centre → list → previous route). Exactly one panel is visible at rest; the transition follows the finger and settles in at most 250 ms (instant under reduced motion). The selected panel is not persisted: a cold start or a deep link opens the centre panel. There are no splits; the centre shows one tab at a time with the tab title in the header and a **tab switcher** (header title press or the action `workspace.tab.switcher`) presented as a bottom sheet listing all tabs grouped by kind with state indicators, close buttons and "New…" entries. Opening a file or diff from the explorer switches to the centre panel. Diffs are unified only; the file editor and terminal follow their mobile presentations; the explorer's tab row, search and transfers are reachable with one hand in the lower 60 % of the screen through a bottom toolbar. A layout stored at a wider width is kept intact and only its focused pane's active tab is shown; widening the window restores the full split layout. [JAD JD-WS-016] [NEW]

#### Scenario: Cold start opens the centre
- **WHEN** the user left the app on the explorer panel and cold-starts it
- **THEN** the centre panel of the last workspace is shown

#### Scenario: Exclusive panels
- **WHEN** the user swipes from the right edge on the centre panel
- **THEN** the explorer panel replaces the centre panel and the list panel is not visible

#### Scenario: Terminal keeps horizontal gestures
- **WHEN** the user drags horizontally inside a terminal away from the 24 pt edge zones
- **THEN** the terminal selection or scroll handles the gesture and the panel does not change

#### Scenario: Open from the explorer
- **WHEN** the user taps a changed file in the explorer's Changes tab
- **THEN** the centre panel is shown with that file's unified diff

#### Scenario: Back navigation
- **WHEN** the explorer panel is shown and the user performs the system back gesture twice
- **THEN** the centre panel and then the list panel are shown

### Requirement: Keyboard access to workspace surfaces
Every workspace function SHALL be reachable by keyboard on web and desktop and with a hardware keyboard on tablets, through action ids registered in `keyboard-shortcuts.Action registry` (default bindings are defined only there) and listed in the command palette: `workspace.new`, `workspace.open-folder`, `workspace.switch` (quick switcher over workspaces), `workspace.tab.next|previous|close|reopen-closed|move-left|move-right|keep-open|switcher`, `workspace.pane.split-right|split-down|focus-next|focus-previous|maximise|close`, `workspace.explorer.toggle|focus-files|focus-changes|focus-pull-request`, `workspace.scripts.open`, `workspace.git.commit|push|pull`, `file.quick-open` (file-name search), `file.search-in-files`, `file.save`, `file.save-all`, `file.new`, `file.rename`, `file.delete`, `diff.next-change|previous-change|next-file|previous-file|toggle-layout`, `review.add-comment`, `terminal.new`, `terminal.split-right`, `terminal.find`, `terminal.copy`, `terminal.paste`, `terminal.clear`, `terminal.history.toggle`, `terminal.command.previous|next`, `terminal.font.increase|decrease|reset`, `terminal.focus.leave|next-pane|previous-pane`, `terminal.kill`. The tree follows the tree keyboard pattern of `design-system` (arrows, Home/End, type-ahead, Enter to open, F2-equivalent rename through `file.rename`, Space to preview); tab strips are a tablist with roving focus (arrows, Home/End, Delete to close); splitters follow `design-system.Resizable panels and splitters`; diff hunks, review comment boxes, script rows and history rows are reachable in reading order. Contexts and precedence: `terminal.new` is registered in the `workspace` context only (`keyboard-shortcuts.Default bindings for terminals`): its binding works from any workspace surface whose focus is outside a terminal, and from inside a focused terminal it is reached through the tab menu, the terminal toolbar or the command palette. **Terminal key rule** (this capability decides it, and `keyboard-shortcuts.Shortcut contexts and precedence` follows it): while a terminal has focus the application intercepts only (a) the three escape actions `terminal.focus.leave`, `terminal.focus.next-pane` and `terminal.focus.previous-pane` and (b) the terminal's own clipboard and search actions `terminal.copy` (only while a selection exists; otherwise the key goes to the PTY), `terminal.paste` and `terminal.find`, and (c) the binding of the command-palette action `palette.open`, which opens the palette over the terminal; every other key and key combination — including bindings of every other global, workspace and editor action, and the binding shared by "Search in files" (`file.search-in-files`) in a workspace and player fullscreen in the editor — is sent to the PTY unchanged. The other `terminal.*` actions (`terminal.clear`, `terminal.history.toggle`, `terminal.command.previous|next`, `terminal.font.*`, `terminal.split-right`, `terminal.kill`, `terminal.new`) are reached from the tab menu, the terminal toolbar, the command palette (which opens from a focused terminal) and, after `terminal.focus.leave`, their bindings. Keys the operating system or the browser reserves never reach the application on any platform (macOS, Windows, Linux; iPadOS and Android with a hardware keyboard) and are outside this rule. In a workspace, `file.search-in-files` opens "Search in files"; Focus mode has its own globally unique binding in `keyboard-shortcuts`. A focused file editor consumes text-editing keys. Focus returns to the invoking control when a dialog, sheet or menu closes, and moves to the new panel when a tab opens. [NEW]

#### Scenario: Quick open
- **WHEN** the user invokes `file.quick-open`, types `brief` and presses Enter
- **THEN** the best-matching file opens in the focused pane and focus is in the new panel

#### Scenario: Tree by keyboard
- **WHEN** focus is on a collapsed folder row and the user presses Right, Down, Enter
- **THEN** the folder expands, focus moves to its first child, and that child opens

#### Scenario: Terminal does not swallow escape actions
- **WHEN** a terminal is focused and the user invokes the bound `terminal.focus.next-pane`
- **THEN** focus moves to the next pane and the terminal receives no bytes

#### Scenario: Palette lists workspace actions
- **WHEN** the command palette is opened inside a workspace and the user types "split"
- **THEN** "Split pane right", "Split pane down" and "Split terminal right" are listed with their current bindings

#### Scenario: Global binding inside a focused terminal
- **WHEN** a terminal running a full-screen editor is focused and the user presses the binding of `app.settings`
- **THEN** the key sequence is delivered to the PTY and Settings does not open

#### Scenario: Command palette inside a focused terminal
- **WHEN** a terminal running a full-screen editor is focused and the user presses the binding of `palette.open`
- **THEN** the command palette opens, no bytes are sent to the PTY, and closing the palette returns focus to the terminal

#### Scenario: Copy with and without a selection
- **WHEN** a terminal is focused, text is selected and the user presses the binding of `terminal.copy`, then clears the selection and presses it again
- **THEN** the first press copies the selection and sends nothing to the PTY, and the second press is sent to the PTY

#### Scenario: Search in files outside a terminal
- **WHEN** focus is in the file tree of a workspace and the user invokes `file.search-in-files`
- **THEN** "Search in files" opens and the editor's player fullscreen does not

### Requirement: Audit entries for workspace, file and terminal actions
The following actions SHALL append records to the audit log of `server-api.Audit log` (fields as defined there; category `security` unless marked `agent`): `workspace.root.added|removed`; `workspace.created|archived|restored|deleted|linked|unlinked` (with kind and whether a worktree was created or removed); `workspace.config.written`; `workspace.config.trusted` (with the content hash); `workspace.setup.run|skipped`; `workspace.script.started|stopped` (script name; actor device, `host-cli` or `agent:<sessionId>`); `workspace.settings.changed` (changed keys of `workspaces.*` and `terminal.*`); `fs.browse.host`, `fs.read.host`, `fs.write.host`, `fs.delete.host`, `fs.upload.host` (every host-scope operation, with the absolute path); `fs.write`, `fs.delete`, `fs.upload` inside an external workspace by an `editor` device; `fs.denied` (any `fs/outside-workspace` or `fs/protected-path` refusal, at most 1 record per device per path per minute); `git.commit`, `git.push`, `git.pull`, `git.merge`, `git.discard`, `git.branch.switch|rename`, `git.pr.create|merge` (branch and request number, never diff content); `terminal.enabled|disabled`; `terminal.opened|closed|killed` (terminal id, workspace, profile name, command of a custom launch, exit reason); `terminal.share.changed`; `terminal.takeover|handback`; `terminal.agent-access.changed`; `terminal.hooks.enabled|disabled`; `terminal.cli.started` (CLI id); and, category `agent`: `terminal.agent.create|send-keys|kill` (byte count only), `workspace.agent.session.created` (owner device and role) and `approval.resolved` for every host-execution approval (request id, kind, decision, resolver device id and its role at that moment; never the command text). Records SHALL NOT contain terminal input, terminal output, file contents, environment values or command output. Admin devices see these records in host settings → Diagnostics → Audit with filters for workspace and terminal. [NEW]

#### Scenario: Terminal session is recorded without content
- **WHEN** an admin opens a terminal, types a command containing a password and closes the terminal
- **THEN** audit records `terminal.opened` and `terminal.closed` exist with the device id and terminal id, and no record contains any substring of the typed command

#### Scenario: Host-scope write
- **WHEN** an admin saves a file opened through "Open host path…"
- **THEN** a record `fs.write.host` with the absolute path, device id and outcome `ok` exists

#### Scenario: Denied traversal is recorded once per minute
- **WHEN** an `editor` device sends 30 traversal requests for the same path within one minute
- **THEN** every request is refused and exactly one `fs.denied` record exists for that minute

#### Scenario: Agent keystrokes
- **WHEN** an agent sends 14 bytes with `jc_terminal_send_keys`
- **THEN** an `agent` category record `terminal.agent.send-keys` with `bytes: 14` and the session id exists

### Requirement: Headless and container Gateways
The capability SHALL work on a headless Gateway (CLI or the Docker distribution of `updates-distribution.Headless Gateway distribution and update`) with these stated differences, exposed by `jagentchill.workspace.hostInfo` → `{os, arch, hostname, user, home, containerised, pathSeparator, browseRoots[], shells[{id, path}], git {available, version}, forge, features {fileEditing, terminal, worktrees, serviceProxy, reveal}, backends}`: (1) **Paths** are paths of the Gateway's own file system; in a container only mounted volumes exist. The Docker distribution declares the volumes `/data` (the state directory, including managed workspaces and worktrees) and `/workspace` (the operator's folders); `workspaces.browseRoots` defaults to `["/workspace"]` there, and the host file browser, New workspace screen and host settings show the notice "This host runs in a container. Only folders mounted into it are visible; paths shown are container paths." whenever `containerised` is true (detected by the image's `JAGENTCHILL_CONTAINER=1`). (2) **Shells**: the image ships `bash` and `sh`, `git`, `git-lfs`, `openssh-client` and no forge CLI; terminal profiles are generated from `shells[]`, and pull-request actions show the install hint until the operator adds a CLI to the image. (3) **User**: the image runs the Gateway as an unprivileged user (uid 1000), the terminal runs as that user, and the enablement dialog names it; files created in mounted volumes are owned by that uid. (4) **Reveal / open in external editor** and "Open in browser" for services are unavailable (`features.reveal` false); services are reachable only inside the container unless the operator publishes ports, and the script list says so. (5) **No desktop UI on the host**: every flow, including the first enablement of the terminal and repository trust, is completable from a paired admin device or through `jagentchill workspace …` / `terminal enable|disable|list|kill` host CLI commands. (6) **Host systems.** A desktop-supervised or headless Gateway on macOS, Windows or Linux offers the same functions; the stated differences are: on Windows hosts paths use `\` in display and `/` or `\` in input, the PTY uses ConPTY (Windows 10 version 1809 or newer), built-in shells are `pwsh`, `powershell.exe` and `cmd.exe`, and signals map as stated in `workspaces-terminal.Terminal limits, kill and restart behaviour`; on macOS and Linux hosts paths use `/`, the PTY uses forkpty, and built-in shells are the login shell plus `zsh`, `bash`, `fish` and `sh` when present. `hostInfo.os` is `macos`, `windows` or `linux`, and clients on every platform — desktop on the three systems, web, iOS and Android — render paths and shell names from `hostInfo`, never from their own operating system. [NEW]

#### Scenario: Container notice
- **WHEN** an admin opens the host file browser on a Docker Gateway
- **THEN** the listing starts at `/workspace` and the container notice is shown above it

#### Scenario: Only bundled shells
- **WHEN** host settings → Terminal is opened on the Docker distribution
- **THEN** the built-in profiles are exactly `bash` and `sh`

#### Scenario: Terminal enabled from the host CLI
- **WHEN** the operator runs `jagentchill terminal enable --acknowledge` on a headless host
- **THEN** the terminal is enabled, an audit record with actor `host-cli` exists, and the command without `--acknowledge` prints the four warning statements and changes nothing

#### Scenario: No forge CLI in the image
- **WHEN** a workspace on the Docker distribution has a GitHub remote
- **THEN** Commit, Pull and Push work with mounted credentials and "Create pull request" shows "Install and sign in to gh on the host"

### Requirement: Offline, disconnected and error states
Every surface of this capability needs a connected host and SHALL present these states, using `design-system.Empty, error and offline states`:

| Surface | No Gateway paired | Disconnected (was connected) | Operation error |
|---|---|---|---|
| Workspaces index, sidebar list | requires-host state with "Pair a device" | cached list shown dimmed with the banner "Reconnecting…"; creation and menu actions disabled | "Failed to load workspaces" + "Retry" |
| New workspace, host file browser | requires-host state | "Host is not connected"; form values kept; "Create"/"Open" disabled | inline error per `workspaces-terminal.New workspace screen` |
| File tree | — | last loaded entries dimmed; expand shows "Reconnect to load this folder" | "Failed to load folder" + "Retry" |
| File viewer | — | content already loaded stays readable; media playback pauses with "Reconnecting…" | "Failed to load file" + "Retry" |
| File editor | — | typing continues into the local buffer; "Save" disabled with "Reconnect to save"; on reconnect the revision is re-checked before any save | conflict banner or the host's error message |
| Uploads and downloads | — | paused automatically, resumed within 5 s of reconnect | "Failed" + "Retry" after the retry schedule |
| Changes, diffs, commits | — | last diff shown dimmed with "Not live — reconnecting"; git actions disabled | toast with git's first line + "Show details" |
| Pull-request panel | — | last status with its fetch time; "Refresh" disabled | forge error with "Retry" |
| Scripts, setup, logs | — | last received log lines stay; state shown as "Unknown — reconnecting"; no start/stop | error in the row |
| Terminal | — | screen stays visible and scrollable, input disabled, banner "Reconnecting… output will be replayed"; automatic reattach per `workspaces-terminal.Scrollback, attach and replay` | exit banner with the reason and "Restart terminal" |
| Agent and draft panels | — | per `chat-agent.Offline and disconnected behaviour` | per `chat-agent` |

Typed input into a disconnected terminal is discarded, never queued. After reconnect each surface pulls current state (its stream's pull RPC) before applying new events; a stale banner is removed only after that pull succeeds. A request that receives no response within 30 s (10 minutes for clone, worktree creation and setup; 5 minutes for git network actions) fails with `TIMEOUT` and re-enables its control. When the Gateway reports `terminal/backend-unavailable` or `git/unavailable`, the affected entry points are shown disabled with the reason instead of failing on use. When the device's role changes or the device is revoked, open surfaces switch to the role-denied or signed-out state within 2 s without losing unsaved editor buffers. On web, where a workspace needs a Gateway and none is paired, `/h/[hostId]/workspaces…` routes show the not-paired screen of `app-shell-navigation.Route map`. [NEW]

#### Scenario: Terminal while disconnected
- **WHEN** the connection drops while a terminal is focused and the user types `ls` and Enter
- **THEN** the keys are not sent then or after reconnecting, the banner "Reconnecting… output will be replayed" is shown, and the screen remains scrollable

#### Scenario: Editor while disconnected
- **WHEN** the connection drops while the user is editing a file
- **THEN** typing continues, "Save" is disabled with "Reconnect to save", and after reconnecting a save either succeeds or shows the conflict banner if the host file changed meanwhile

#### Scenario: Stale diff
- **WHEN** the connection drops with the Changes tab open
- **THEN** the list is dimmed with "Not live — reconnecting", the git split button is disabled, and both recover after the status pull that follows reconnect

#### Scenario: Request timeout
- **WHEN** a `jagentchill.fs.list` request gets no response for 30 s
- **THEN** the folder row shows "Failed to load folder" with "Retry" and the spinner stops

#### Scenario: Git missing
- **WHEN** `hostInfo.git.available` is false
- **THEN** "New worktree" is disabled with "Git is not installed on the host" and the Changes tab shows the same message

### Requirement: Workspace, file, git and terminal error codes
In addition to the general codes of `server-api.RPC error envelope` (`INVALID_PARAMS`, `NOT_FOUND`, `ALREADY_EXISTS`, `CONFLICT`, `SCOPE_DENIED`, `RATE_LIMITED`, `QUOTA_EXCEEDED`, `UNAVAILABLE`, `TIMEOUT`, `CANCELLED`, `APPROVAL_TIMEOUT`, `PERMISSION_DENIED`, `INTERNAL`), this capability SHALL define and use exactly these domain codes, each with `message` in English for logs, `retryable`, and a localised user message chosen by the client from the code:
- `workspace/limit-reached`, `workspace/root-missing`, `workspace/archived`, `workspace/busy`, `workspace/config-invalid`, `workspace/config-untrusted`, `workspace/setup-failed`, `workspace/script-not-found`, `workspace/script-already-running`, `workspace/port-unavailable`;
- `fs/outside-workspace`, `fs/outside-browse-roots`, `fs/protected-path`, `fs/not-found`, `fs/exists`, `fs/conflict` (`details {currentRevision, modified_ms}`), `fs/too-large` (`details {limitBytes}`), `fs/binary`, `fs/unsupported-encoding`, `fs/not-a-directory`, `fs/not-empty`, `fs/permission-denied` (refused by the host operating system), `fs/no-space`;
- `git/unavailable`, `git/not-a-repository`, `git/dirty-worktree` (`details {files[]}` ≤ 50), `git/branch-exists`, `git/branch-checked-out` (`details {worktreePath}`), `git/ref-not-found`, `git/merge-conflict` (`details {files[]}`), `git/non-fast-forward`, `git/nothing-to-commit`, `git/identity-missing`, `git/auth-failed`, `git/forge-unavailable`, `git/pr-not-found`, `git/timeout`;
- `terminal/disabled`, `terminal/backend-unavailable`, `terminal/not-found`, `terminal/exited`, `terminal/limit-reached`, `terminal/profile-not-found`, `terminal/shell-not-found`, `terminal/input-too-large`, `terminal/read-only`, `terminal/not-owner`, `terminal/human-control`.
`retryable` is true only for `workspace/busy`, `git/timeout`, `terminal/backend-unavailable` and the general `UNAVAILABLE`, `TIMEOUT`, `RATE_LIMITED`. Git and operating-system error text is passed in `details.hostMessage` truncated to 2 000 characters after removing URL credentials (`scheme://user:secret@` → `scheme://`). No code outside this list and the general registry is emitted by a `jagentchill.workspace.*`, `jagentchill.fs.*` or `jagentchill.terminal.*` method. [NEW]

#### Scenario: Closed code set
- **WHEN** the server contract test forces every failure branch of the three domains
- **THEN** each response code is in the general registry or in the list above

#### Scenario: Credentials are removed from host messages
- **WHEN** a push to `https://op:ghp_secret@example.com/repo.git` fails
- **THEN** the error's `details.hostMessage` contains `https://example.com/repo.git` and does not contain `ghp_secret`

#### Scenario: Retryable flag
- **WHEN** a second git mutation is requested while one is running in the same repository
- **THEN** the response is `workspace/busy` with `retryable: true`

#### Scenario: Conflict details
- **WHEN** a write fails with `fs/conflict`
- **THEN** `details.currentRevision` equals the SHA-256 of the file currently on the host
