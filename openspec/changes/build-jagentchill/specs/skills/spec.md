## ADDED Requirements

### Requirement: Skill model
A skill SHALL be a plain folder `<name>/` containing a `SKILL.md` file with YAML front matter that has at least `name` and `description`, followed by Markdown instructions, plus any supporting files. `name` matches `^[a-z0-9]+(-[a-z0-9]+)*$`, is at most 64 characters and equals the folder name; `description` is 1–1 024 characters; the optional front-matter key `version` is a semantic version string. The product SHALL never paste a skill's text into a prompt itself: skills are made available by placing folders where the Gateway's skill loader, or a CLI runtime's own loader, finds them, and by referencing them by name in the turn. Loading, selection and prompt assembly are the Gateway's and the runtime's; the server builds the management, picker, trust, lock, update, bundle and tool layers on the Gateway's skill RPCs (`skills.status`, `skills.search`, `skills.detail`, `skills.skillCard`, `skills.securityVerdicts`, `skills.install`, `skills.upload.*`, `skills.update`, `skills.library.*`, event `skills.changed`), which the server calls over its gateway link (`server-api.Gateway link`); devices use only the `jagentchill.skill.*` and `jagentchill.session.skills.*` methods of `skills.Skill RPC surface` and never a Gateway skill RPC. Every skill feature requires a connected host. While the host's OpenClaw Gateway is not linked to the server, the Skills screen shows the last list the server holds with the banner "The agent engine is restarting on <host name>", and install, update, enable, remove and attach answer `GATEWAY_UNAVAILABLE` without changing anything. [JAD JD-SKL-001] [NEW]

#### Scenario: Valid skill folder
- **WHEN** a folder `shot-lists/` contains `SKILL.md` with `name: shot-lists` and a 40-character description
- **THEN** it is listed as a skill with status `ok`

#### Scenario: Name and folder differ
- **WHEN** the folder is `shot-lists/` and the front matter says `name: shotlists`
- **THEN** the skill is listed with status `invalid` and the reason "The name in SKILL.md must match the folder name"

#### Scenario: No prompt injection
- **WHEN** a turn is sent with two skills attached
- **THEN** the message sent to the Gateway contains only the invocation line of `skills.Invocation rewriting per runtime` and the user's text, and none of the skills' instruction text

### Requirement: Skill record
`jagentchill.skill.list {projectId?, cwd?, agentId?, sessionKey?}` (scope `jagentchill.config.read`) SHALL return entries of the shape `{skillId, name, description, version?, scope: "bundled" | "global" | "project", projectRoot?, root, realPath, links[] {runtimeId, path, kind: "symlink" | "copy"}, visibleTo[] (runtime ids), owned, bundled, enabled, pinned, status: "ok" | "invalid", invalidReason?, source {kind: "bundled" | "clawhub" | "npm" | "git" | "local" | "upload" | "authored" | "fork" | "runtime-native", ref?, revision?}, hasScripts, fileCount, sizeBytes, contentHash, familyId, modifiedLocally, updateAvailable?: {version?, revision}, verdict?: "clean" | "warn" | "blocked" | "unknown", training?: {status: "training" | "graduated", lessons, uses, consecutiveCleanUses}, installed_ms?, updated_ms?}`. `skillId` is `<scope>:<root label>:<name>` and is stable while the folder stays in place. `owned` is true for skills the server installed or authored (present in the lock file); `hasScripts` is true when the folder contains any file with an executable bit or with an extension in `.sh .bash .zsh .ps1 .bat .cmd .py .js .mjs .ts .rb .pl`. `realPath` is returned only to devices with role `admin`; other roles receive it as `null`. Changes are announced with the event `jagentchill.skill.changed {skillIds[]}` on stream `skill`, driven by the Gateway's `skills.changed` event and by the server's own operations; after a gap the client calls `skill.list` again. [JAD JD-SKL-002] [NEW]

#### Scenario: Record fields for an installed skill
- **WHEN** a skill was installed from a git source at commit `4f2a9c1`
- **THEN** its entry has `owned: true`, `source {kind: "git", ref, revision: "4f2a9c1…"}`, a `contentHash`, and `updated_ms`

#### Scenario: Path hidden from editors
- **WHEN** an editor device lists skills
- **THEN** every entry has `realPath: null`

### Requirement: Discovery roots
Skills SHALL be discovered from the Gateway's roots, highest precedence first: `<workspace>/skills`; `<workspace>/.agents/skills`; `~/.agents/skills`; the managed root `<state-dir>/skills`; the per-agent workshop root `<state-dir>/agents/<agentId>/agent/workshop-skills`; OpenClaw's own bundled root; `skills.load.extraDirs`, into which the server writes exactly one directory — its own read-only skills directory holding the `jagentchill-*` skills of `skills.Bundled JAgentChill skills` (`gateway/openclaw/docs/tools/skills-config.md`), because JAgentChill is not part of the Gateway and ships nothing inside it; and the skill directories of OpenClaw plugins enabled in `plugins.allow`. `<workspace>` is the session's workspace directory: for a creative session, `<dataDir>/workspaces/<projectId>/`; for a workspace session, the host directory bound through `workspaces-terminal.Workspace to agent session binding`. Root labels used in `skillId` and in the UI are `workspace`, `workspace-agents`, `user-agents`, `managed`, `workshop`, `bundled` and `extra`. When two roots hold a skill of the same name with different content, the higher root wins for loading and the lower one is listed with the badge "Shadowed by <root label>". In addition, for runtimes with `capabilities.skills: "native-dir"`, the server scans that runtime's own skill directories (see `skills.Runtime visibility and native directories`) so that skills a CLI already has are listed with `source.kind: "runtime-native"` and `owned: false`. The server lists what the Gateway reports through `skills.status` and adds only the native-directory scan and the lock-file facts; it does not implement a second loader. [JAD JD-SKL-002] [NEW]

#### Scenario: Project skill shadows a global one
- **WHEN** `storyboard-notes` exists in `<workspace>/skills` and in the managed root with different content
- **THEN** sessions of that project load the workspace copy, and the managed copy is listed with "Shadowed by workspace"

#### Scenario: Skill a CLI already had
- **WHEN** `~/.claude/skills/pdf-tools` exists on the host and was not installed by the server
- **THEN** it is listed with `owned: false`, `source.kind: "runtime-native"`, `visibleTo` containing only the runtimes that read that directory, and the badge "Other"

### Requirement: Runtime visibility and native directories
Each entry's `visibleTo` SHALL list the runtimes that can load the skill. Runtimes with `capabilities.skills: "token"` (`builtin`, `claude-code`, `gemini-cli`, `codex`, `copilot` — see `agent-runtimes.Published capability matrix`) see every enabled skill the Gateway discovers, because the Gateway resolves the skill and passes it to the runtime (for `claude-code` as a temporary CLI plugin directory). ACP runtimes load skills only from their own directories; the server's table of native directories is: `acp-claude` → `~/.claude/skills` and `<workspace>/.claude/skills`; `acp-codex` → `~/.codex/skills` and `<workspace>/.codex/skills`; `acp-kiro` → `~/.kiro/skills` and `<workspace>/.kiro/skills`; every other ACP runtime, including custom ACP commands → `~/.agents/skills` and `<workspace>/.agents/skills`. "Make available to <runtime>" (admin; `jagentchill.skill.link.set {skillId, runtimeId, linked}`, scope `jagentchill.config.write`, behind the trust prompt of `skills.Trust prompt before install`) creates, for an owned skill, a symbolic link from the runtime's native directory to the skill's real folder — on a host where symbolic links cannot be created, a copy, recorded as `kind: "copy"` and refreshed on every update. A link is never created over an existing path the server did not write; that case fails with `skill/name-conflict`. Removing availability (`linked: false`) deletes exactly the recorded link. A skill not visible to the session's runtime appears in pickers as a row "Make available to <runtime>" for admins and "Not available on <runtime>" for others. [JAD JD-SKL-002, JD-SKL-004] [NEW]

#### Scenario: Link for an ACP runtime
- **WHEN** an admin chooses "Make available to OpenCode" for a managed skill
- **THEN** a symbolic link is created at `~/.agents/skills/<name>`, the lock file records it, and `visibleTo` gains `acp-opencode`

#### Scenario: Existing foreign folder
- **WHEN** `~/.agents/skills/<name>` already exists and is not in the lock file
- **THEN** the action fails with `skill/name-conflict`, nothing is overwritten, and the dialog offers "Install under another name"

#### Scenario: Host without symlink permission
- **WHEN** the host refuses to create symbolic links
- **THEN** a copy is written, `links[].kind` is `copy`, and updating the skill rewrites that copy in the same operation

### Requirement: De-duplication and families
Entries reached through different directories SHALL be de-duplicated by resolved real path, so that a skill and its links appear once with its `links[]`. Distinct folders with the same `name` form a family (`familyId` = the name): the list shows one family row with a count badge ("3 copies") that expands to its members, each with its root label, scope, runtimes and `contentHash`; members with differing hashes show "Differs". The family row's actions act on the member that the current context loads (by root precedence). `contentHash` is the SHA-256 over the sorted list of relative paths and file digests of the folder, excluding `.git/` and OS metadata files. [JAD JD-SKL-003] [NEW]

#### Scenario: Linked skill appears once
- **WHEN** a managed skill is linked into two native directories
- **THEN** the list shows one row with two links, not three rows

#### Scenario: Diverged copies
- **WHEN** a project has its own edited copy of a globally installed skill
- **THEN** the family row shows "2 copies", and expanding it shows both members with "Differs" on the one whose hash is not the loaded one's

### Requirement: Skill sources
The server SHALL support four source kinds — the reference's `index` kind (an https JSON index of skills) is not offered: ClawHub replaces it, and an index file can be consumed by adding the repository or package it points to as a `git` or `npm` source — stored in the server configuration `skills.sources[]` as `{id, kind, label, enabled, …}` (at most 20):
- `clawhub` — the ClawHub registry reached through the Gateway (`skills.search`, `skills.detail`, `skills.install {source: "clawhub", slug, version?, force?}`); fields `{}`.
- `npm` — `{package, registry? (default `https://registry.npmjs.org`), distTag? (default `latest`)}`; listing reads registry metadata only; install downloads the tarball, verifies its registry integrity value, extracts without running any lifecycle script, and takes the skill folders found at the package root (`SKILL.md`) or under `skills/*/SKILL.md`.
- `git` — `{url (https only), ref? (branch, tag or commit; default the remote's default branch), subPath?}`; listing uses a shallow, blob-filtered fetch into `<dataDir>/skills/cache/` reading only `SKILL.md` front matter; install fetches the chosen skill's folder at the resolved commit. The host's `git` runs with prompts disabled and without credential helpers, so private repositories that need interactive credentials fail with `skill/source-fetch-failed`.
- `local` — `{path}` (absolute folder on the Gateway host containing skill folders), or a one-off upload from the device (a folder or `.zip` sent as a blob through `cross-device-sync.Chunked resumable upload` and handed to the Gateway with `skills.upload.begin | chunk | commit`).
Because the Gateway's `skills.install` RPC accepts only installer specs, ClawHub and uploads, `npm` and `git` skills are fetched and validated by the server on the host and then installed through the upload path. Listing never downloads skill content beyond metadata; install downloads only the chosen skill. Source listings are cached 10 minutes per source and refreshed in the background when read after expiry. Each remote source host is an entry of `security-privacy.Network egress control`; a source whose host is disabled there reports `EGRESS_BLOCKED`. [JAD JD-SKL-007] [NEW]

#### Scenario: Git source listing
- **WHEN** an admin adds a git source for a repository with 30 skill folders
- **THEN** Browse lists 30 items with name and description, and no skill file other than `SKILL.md` front matter has been read into the cache

#### Scenario: npm package with install scripts
- **WHEN** an npm skill package declares a `postinstall` script
- **THEN** the script is never executed, and the trust prompt shows "This package declares install scripts — they are not run"

#### Scenario: Non-https git URL
- **WHEN** a source is added with an `ssh://` or `file://` URL
- **THEN** it is refused with `INVALID_PARAMS` and "Use an https URL"

### Requirement: Source management and defaults
With no stored source list, the server SHALL present these defaults: ClawHub (enabled), and two git sources for the official public skill repositories of Anthropic (`https://github.com/anthropics/skills`) and OpenAI (`https://github.com/openai/skills`), both listed and disabled until an admin enables them. Methods: `jagentchill.skill.source.list` (scope `jagentchill.config.read`) → `{sources[]}` with state; `jagentchill.skill.source.upsert {source}` → the stored source (an absent `id` creates one; kind-specific fields are validated as in `skills.Skill sources`); `jagentchill.skill.source.remove {id}`; `jagentchill.skill.source.refresh {id}` → `{state, itemCount}` (the last three with scope `jagentchill.config.write`). The Sources sheet (from the Browse tab) lists sources with label, kind, state ("Ready · <n> skills", "Refreshing…", "Error — <message>", "Disabled", "Blocked by network settings"), an enable switch, "Refresh" and "Remove"; "Add source" offers the kinds npm, git and local with validated fields. Removing a source does not remove skills installed from it; those keep their recorded source and show "Source removed" in place of update status. [JAD JD-SKL-008] [NEW]

#### Scenario: Defaults on a fresh host
- **WHEN** an admin opens Sources on a host with no stored list
- **THEN** ClawHub is shown enabled and the two official git sources are shown disabled

#### Scenario: Remove a source with installed skills
- **WHEN** the admin removes a git source from which two skills were installed
- **THEN** both skills remain installed and usable, and their detail shows "Source removed — updates unavailable"

### Requirement: Browse catalogue
`jagentchill.skill.catalogue.list {sourceIds?, query?, cursor?, limit?}` (scope `jagentchill.config.read`; default 20, max 50 per page) SHALL return items `{itemId, sourceId, name, description, version?, revision?, author?, hasScripts?, installed: {skillId, version?}?, updateAvailable, verdict?}` merged across enabled sources and sorted by relevance to `query` (name prefix, then name substring, then description substring), then name. ClawHub search is the Gateway's `skills.search`; other sources are filtered locally from the cached listing. `jagentchill.skill.catalogue.get {itemId}` returns the full card (`skills.skillCard` / `skills.detail` for ClawHub; the rendered `SKILL.md`, file list with sizes, and licence file name for other kinds). A source that fails is reported in `failedSourceIds[]` and the other sources' items are still returned. [JAD JD-SKL-007] [NEW]

#### Scenario: Search across sources
- **WHEN** the query is "storyboard" with ClawHub and one git source enabled
- **THEN** matching items from both are listed with their source label, name-prefix matches first

#### Scenario: One source down
- **WHEN** the npm registry is unreachable
- **THEN** items from the other sources are listed and a banner reads "Unable to load <npm source label>" with "Retry"

### Requirement: Trust prompt before install
No skill SHALL be installed, updated to a new revision, or linked into a runtime's native directory without an explicit confirmation by a device with role `admin`. The trust prompt shows: name, description, version and revision; source kind, label and exact reference (registry and package, repository URL and commit, host path, or "Uploaded from <device name>"); author when the source states one; file count and total size; the file list (collapsed; scripts first); whether it has scripts, with the warning "This skill includes scripts. An agent that can run commands will be able to run them on <host name>."; the Gateway's verdict from `skills.securityVerdicts` (`clean`, `warn` with findings, `blocked`, or "Not scanned"); where it will be installed and which runtimes will see it; and "View SKILL.md". Buttons: "Cancel" (default focus) and "Install" — "Install" is disabled for 3 s when the skill has scripts or a `warn` verdict, and is absent for a `blocked` verdict, which shows "Blocked by the host's security check" and fails server-side with `skill/blocked`. The confirmation is bound to the content: the install call carries the `contentHash` the prompt displayed, and the host refuses with `skill/content-changed` when the fetched content hashes differently. A checkbox "Trust this source for updates" (off by default; unavailable for skills with scripts) allows revisions from the same source to install without a new prompt as long as they add no scripts and receive no `warn` or `blocked` verdict. Agents can never answer this prompt. [NEW]

#### Scenario: Skill with scripts
- **WHEN** an admin installs a skill that contains `scripts/render.sh`
- **THEN** the prompt lists the script first, shows the scripts warning, and "Install" becomes pressable after 3 s

#### Scenario: Content changed between prompt and install
- **WHEN** the repository's default branch moves after the prompt was shown and the install fetch resolves different content
- **THEN** the install fails with `skill/content-changed` and the prompt reopens with the new revision

#### Scenario: Blocked verdict
- **WHEN** the Gateway's verdict for an item is `blocked`
- **THEN** the prompt has no "Install" button and a direct RPC attempt fails with `skill/blocked`

#### Scenario: Editor device
- **WHEN** an editor opens an item in Browse
- **THEN** the card is readable and the install button is replaced by "Ask an admin device to install this skill"

### Requirement: Install
`jagentchill.skill.install {itemId | upload: {blobSha256}, scope: "global" | "project", projectId?, rename?, makeAvailableTo?: runtimeId[], confirmedContentHash, idempotencyKey}` (scope `jagentchill.config.write`) SHALL: fetch into a staging directory under `<dataDir>/skills/staging/`; validate (`SKILL.md` present and parseable, name rule, description length, size and file-count limits, no path that escapes the folder, no symbolic link pointing outside the folder, no device or socket files); compare the content hash with `confirmedContentHash`; then write exactly one real copy — global scope: into the Gateway's managed root through `skills.install` (ClawHub) or `skills.upload.*` + `skills.install {source: "upload"}` (other kinds); project scope: into `<workspace>/.agents/skills/<name>/` of that project's workspace, written atomically (staging directory renamed into place) — and create the requested runtime links. Every folder the server installs or authors carries the marker file `.jagentchill-skill.json` (`{name, source, resolvedRevision, installed_ms}`, no secret), which is excluded from `contentHash` and from exports. A name already taken in the target root fails with `skill/name-conflict` unless `rename` supplies a free valid name, in which case the folder and the front-matter `name` are both rewritten. A directory the server did not write is never overwritten. On any failure the staging directory and every path written by this call are removed and the lock file is unchanged. The call returns the new entry; install of a 20 MiB skill completes within 30 s on the reference desktop host excluding download time. Use of the Gateway's skill RPCs with the `operator.admin` scope over the gateway link is gated by spike S12; when it fails, global-scope installs are written by the server directly into `~/.agents/skills/<name>/` (a Gateway discovery root) with the same validation and lock entry. [JAD JD-SKL-004] [NEW]

#### Scenario: Global install from ClawHub
- **WHEN** an admin confirms the trust prompt for a ClawHub item with scope "Global"
- **THEN** the skill appears under Installed with `scope: "global"`, `owned: true`, source `clawhub` and the installed version, and new sessions can reference it

#### Scenario: Name conflict with rename
- **WHEN** a skill named `captions` exists and the admin installs another `captions` choosing the name `captions-broadcast`
- **THEN** the new folder and its front-matter name are `captions-broadcast` and the existing skill is untouched

#### Scenario: Archive with path traversal
- **WHEN** an uploaded `.zip` contains an entry `../../.ssh/authorized_keys`
- **THEN** the install fails with `skill/invalid`, reason "Unsafe path in archive", and nothing is written outside the staging directory, which is then deleted

### Requirement: Lock file
The server SHALL keep `<dataDir>/skills/lock.json`, written atomically with owner-only permissions, with one record per owned skill: `{skillId, name, scope, projectId?, realPath, paths[] (every file-system path this product created for the skill, including links and copies), source {kind, sourceId?, ref, resolvedRevision, integrity (the content hash at install)}, version?, pinned: boolean, pinnedRevision?, trustSource: boolean, installed_ms, installedByDeviceId, updated_ms?, previous?: {revision, backupPath, saved_ms}}`. Uninstall and unlink remove exactly the recorded paths and nothing else. A skill folder not present in the lock file is foreign: it is never overwritten, renamed or deleted without the explicit confirmation of `skills.Remove, disable and foreign skills`. At server start the lock is reconciled with disk: records whose `realPath` no longer exists are dropped and reported once in the Skills screen ("<n> skills were removed outside JAgentChill"); recorded links that are missing are re-created. `modifiedLocally` is true when the current content hash differs from `source.integrity`. The lock file contains no secret and is included in `server-api.Host backup and restore`. [JAD JD-SKL-005] [NEW]

#### Scenario: Uninstall removes only recorded paths
- **WHEN** a skill with one real folder and two links is removed
- **THEN** exactly those three paths are deleted and a sibling folder created by the user in the same directory is untouched

#### Scenario: Folder deleted outside the app
- **WHEN** an owned skill's folder was deleted by hand while the Gateway was stopped
- **THEN** at the next start its lock record is dropped and the Skills screen shows "1 skill was removed outside JAgentChill"

### Requirement: Version pinning
An admin SHALL be able to pin an owned skill to its installed revision ("Pin this version") or, for `clawhub`, `npm` and `git` sources, to a chosen version, tag or commit ("Install specific version…", a field validated against the source). Both use `jagentchill.skill.pin.set {skillId, pinned, revision?}` (scope `jagentchill.config.write`): without `revision` it pins or unpins the installed revision; with a `revision` that differs from the installed one it validates the revision at the source, returns `{needsInstall: true, contentHash}`, and the pin is recorded when the client completes `jagentchill.skill.update.apply {skillId, revision, confirmedContentHash}` after the trust prompt. A pinned skill records `pinned: true` and `pinnedRevision`, shows the badge "Pinned <version or short revision>", is skipped by "Update all" and by automatic update checks' apply step, and still shows "Newer version available" as information. Unpinning restores normal update behaviour. Project-scope installs record the pin in the lock file only; no pin is written into the project folder. [NEW]

#### Scenario: Pinned skill and Update all
- **WHEN** three skills have updates and one is pinned
- **THEN** "Update all" updates two, leaves the pinned one at its revision, and reports "1 pinned skill skipped"

#### Scenario: Install a specific tag
- **WHEN** an admin enters tag `v1.2.0` for a git-sourced skill
- **THEN** after the trust prompt the skill's folder matches that tag's commit and it is marked pinned to `v1.2.0`

#### Scenario: Unknown version
- **WHEN** the entered version does not exist at the source
- **THEN** the field shows "Version not found at <source label>" and nothing changes

### Requirement: Update from source
Owned skills from `clawhub`, `npm`, `git` and path-based `local` sources SHALL be updatable; JAgentDesk records a revision but has no update flow, which is added here. `jagentchill.skill.update.check {skillIds?}` (scope `jagentchill.config.read`) resolves the current revision at the source and sets `updateAvailable`; checks run on demand ("Check for updates") and, when the host setting "Check for skill updates automatically" (`skills.autoCheckUpdates`, default true) is on, at most once per 24 h per source. A check transfers only the source reference, never skill content or usage. `jagentchill.skill.update.apply {skillId, revision?, confirmedContentHash}` (scope `jagentchill.config.write`; `revision` defaults to the source's current one) fetches the new revision, shows the trust prompt with a change summary (files added, removed, changed; a text diff of `SKILL.md`; "Scripts changed" when any script differs) unless `trustSource` permits skipping it, saves the current folder as the single backup `previous` (kept 30 days), replaces the content atomically, refreshes copies in native directories, and updates the lock. A skill with `modifiedLocally: true` asks first: "Keep my changes as a fork" (the edited folder becomes an owned fork named `<name>-custom`, then the update applies), "Overwrite my changes", or "Cancel". "Roll back" on the detail (`jagentchill.skill.rollback {skillId}`, scope `jagentchill.config.write`; `skill/not-found` when no `previous` exists) restores `previous` and makes the replaced revision the new `previous`. The "Trust this source for updates" state of an installed skill is changed with `jagentchill.skill.trust.set {skillId, trustSource}` (scope `jagentchill.config.write`; refused with `INVALID_PARAMS` for a skill with scripts). Sessions keep the revision they started with (the Gateway retains selected skill ids and revisions per session); the new revision applies to sessions started afterwards, and running sessions show nothing. Uploaded and authored skills have no source to update from and show "No update source". [NEW]

#### Scenario: Update with a SKILL.md diff
- **WHEN** an admin presses "Update" on a skill whose source has a new commit
- **THEN** the prompt shows the changed files and the `SKILL.md` diff, and after confirmation the detail shows the new revision and "Roll back" becomes available

#### Scenario: Locally modified skill
- **WHEN** the installed folder was edited and an update is applied with "Keep my changes as a fork"
- **THEN** a skill `<name>-custom` exists with the edited content, and `<name>` matches the source's new revision

#### Scenario: Source unreachable during a check
- **WHEN** the source host does not respond within 15 s
- **THEN** the check ends with `skill/source-fetch-failed` for that source, installed skills keep working, and the row shows "Unable to check for updates"

### Requirement: Remove, disable and foreign skills
`jagentchill.skill.remove {skillId, confirm?}` (scope `jagentchill.config.write`) SHALL remove an owned skill with a confirmation dialog ("Remove <name>? Agents will no longer be able to use it.") and delete exactly its lock-file paths. Removing a foreign skill (`owned: false`) requires `confirm: true` after a second dialog that names the folder path and states "JAgentChill did not install this skill"; the folder is first copied to `<dataDir>/skills/backups/<name>-<timestamp>/` (kept 30 days; listed by `jagentchill.skill.removed.list` → `{items[{backupId, name, originalPath, removed_ms, expires_ms}]}`, scope `jagentchill.config.read`, and restored from Skills ▸ "Recently removed" with `jagentchill.skill.restore {backupId}`, scope `jagentchill.config.write`, which copies the folder back to its original path and fails with `skill/name-conflict` when that path is taken) and then deleted; without `confirm` the call fails with `skill/confirmation-required`. Bundled skills cannot be removed (`skill/not-owned`), only disabled. Disabling: `jagentchill.skill.setEnabled {skillId, enabled}` (scope `jagentchill.config.write`) calls the Gateway's `skills.update {skillKey, enabled}`; for a foreign skill in a runtime's native directory, disabling moves the folder to `<dataDir>/skills/disabled/<runtime>/<name>/` and enabling moves it back to the same path, failing with `skill/name-conflict` when that path has been taken in the meantime. Disabling takes effect for sessions started afterwards; a running session keeps the skills it selected. [JAD JD-SKL-006] [NEW]

#### Scenario: Remove a foreign skill
- **WHEN** an admin confirms both dialogs for a skill found in `~/.claude/skills`
- **THEN** a backup copy exists under the backups directory, the original folder is deleted, and "Recently removed" lists it with "Restore"

#### Scenario: Missing confirmation
- **WHEN** a client calls `skill.remove` for a foreign skill without `confirm`
- **THEN** the call fails with `skill/confirmation-required` and the folder is untouched

#### Scenario: Disable and re-enable a foreign skill
- **WHEN** an admin disables and then re-enables a skill in a CLI's native directory
- **THEN** the folder is back at its original path with identical content

### Requirement: Per-agent and per-runtime availability
Availability of a skill to a turn SHALL be the intersection of: (1) host enablement (`enabled`); (2) the agent's allow-list — `agents.entries.<agentId>.skills`, where an absent list means all enabled skills, an empty list means none, and a non-empty list is the final set; the list of a `jagentchill-*` persona is written from Settings ▸ Skills ▸ "Available to" and from the persona editor through `jagentchill.agent.persona.update {changes: {skillIds}}` of `chat-agent.Persona list and editor` (admin; this capability defines no method for it), which the server applies to the Gateway configuration with `config.patch` over its gateway link; (3) runtime visibility (`visibleTo`); (4) the session's `toolOverrides.skills` map, which a device with scope `jagentchill.agent.use` that can act in the session sets through the relayed session control (`agent-runtimes.Session control application`) to switch individual skills off or on for one session. A new session selects at most 64 enabled skills (the Gateway's limit); when more are available, the persona's allow-list order decides and the session shows "64 of <n> skills loaded". The skill detail shows a matrix "Available to" with one row per persona and one column per enabled runtime, each cell "Yes", "Off for this agent", or "Not on this runtime" with the fixing action for admins. [NEW]

#### Scenario: Persona allow-list
- **WHEN** the Reviewer persona's list contains only `jagentchill-review`
- **THEN** a Reviewer session's skill picker offers only that skill and a `$jagentchill-editing` reference is rejected with a visible error

#### Scenario: Session-level switch
- **WHEN** an editor turns off a skill for the current session
- **THEN** `toolOverrides.skills[<name>]` is false for that session only, and the same skill stays available in other sessions

#### Scenario: Not on this runtime
- **WHEN** a session runs on an ACP runtime for which a skill has no native link
- **THEN** the picker shows the skill as "Make available to <runtime>" for an admin and "Not available on <runtime>" for an editor

### Requirement: Invocation rewriting per runtime
Skills attached to a turn SHALL be turned into an invocation line that is prepended to the user's text, built by `jagentchill.skill.invocation.build {sessionKey, skillIds[]}` (scope `jagentchill.agent.use`; each entry is a `skillId` or a bare name, resolved as `skills.Skills attached to a turn` states) → `{line, warnings[]}` from the session's runtime (`agent-runtimes.Capability flags per runtime`, flag `skills`):

| Runtime | First skill | Further skills |
|---|---|---|
| `skills: "token"` — `builtin`, `claude-code`, `gemini-cli`, `codex`, `copilot`, and profiles extending them | `$name` | further `$name` tokens on the same line, space-separated; the Gateway resolves up to eight distinct references |
| `acp-claude`, `acp-cursor`, `acp-copilot`, `acp-kiro` | `/name` | a second line "Before you answer, load these skills: a, b" |
| `acp-codex` | `$name` | further `$name` on the same line |
| `acp-pi`, `acp-kimi` | `/skill:name` | a second line with the same sentence |
| every other ACP runtime and custom ACP command | — | one line "Before you answer, load these skills: a, b, c" for all |

Only the first skill can be a leading command. The line is separated from the user's text by one blank line. A user-typed `$name` that names an available skill is recognised by the composer, shown as a chip, and counted toward the per-turn limit. Resolution of `$name` tokens on CLI-backend and harness runtimes is confirmed by contract test S8; where a runtime does not resolve them, its `skills` flag is published as `sentence` and the sentence form is used. In the timeline the line is rendered as skill chips and is not shown as raw text. [JAD JD-SKL-009] [NEW]

#### Scenario: Built-in runtime with three skills
- **WHEN** a turn on `builtin` has `jagentchill-editing`, `jagentchill-captioning` and `jagentchill-colour` attached and the text "Tighten the intro"
- **THEN** the sent message is `$jagentchill-editing $jagentchill-captioning $jagentchill-colour`, a blank line, then "Tighten the intro"

#### Scenario: Slash-command runtime
- **WHEN** the same three skills are attached on `acp-claude`
- **THEN** the first line is `/jagentchill-editing`, the second is "Before you answer, load these skills: jagentchill-captioning, jagentchill-colour", then a blank line and the text

#### Scenario: Generic ACP runtime
- **WHEN** two skills are attached on a custom ACP command
- **THEN** the message starts with the single sentence naming both skills and has no leading command

### Requirement: Skills attached to a turn
A turn SHALL carry at most 8 distinct skills. **Identifiers:** `skills[]` on tools, nodes, automations and RPCs accepts, per entry, a `skillId` (`<scope>:<root label>:<name>`) or a bare skill name; a bare name is resolved for the target session by the root precedence of `skills.Discovery roots` to the member that session loads, and results and stored attachments always carry the resolved `skillId`. Attached skills travel as such identifiers from every origin and are rewritten on the host or by the same shared function: from the composer (the client calls `invocation.build` and sends the resulting text through the relayed send of `chat-agent.Session and chat RPC surface`); from agent-to-agent prompts (`jc_agent_send` and `jc_agent_create` accept `skills[]`, see `multi-agent-orchestration.Tool jc_agent_create` and `multi-agent-orchestration.Tool jc_agent_send`), where the server rewrites for the target agent's runtime; from workflow `agent` nodes (`agent-workflows.Agent node`, configuration `skills[]`); and from automations. A ninth skill is refused before sending with `skill/too-many` ("You can attach up to 8 skills per message"); an id that is disabled, hidden by the agent's allow-list, or not visible to the runtime is refused with `skill/not-available` naming it, and the message is not sent — nothing is dropped silently. Attachments are stored per session on the host (`jagentchill.session.skills.get | set`, scope `jagentchill.agent.use`) so that they follow the session across devices; JAgentDesk keeps them in one client's local storage. Attachment persists across turns until removed and is re-validated on a runtime switch (see `agent-runtimes.Switch runtime operation`), where skills not available on the new runtime are listed in a notice and detached. [JAD JD-SKL-010] [NEW]

#### Scenario: Ninth skill
- **WHEN** eight skills are attached and the user selects another
- **THEN** the picker row does not toggle and a caption reads "You can attach up to 8 skills per message"

#### Scenario: Agent-to-agent prompt
- **WHEN** a parent agent on `builtin` calls `jc_agent_send {skills: ["jagentchill-review"]}` (a bare name) to its child on `acp-opencode`
- **THEN** the name resolves to `bundled:bundled:jagentchill-review` for the child's session and the child receives the sentence form naming `jagentchill-review`, not a `$` token

#### Scenario: Attachment follows the session
- **WHEN** two skills are attached on the desktop and the session is opened on a phone
- **THEN** the phone's Skills control shows "2 skills"

### Requirement: Composer skill picker
The composer's Skills control (placement and density are defined by `chat-agent.Composer layout and controls`) SHALL open a picker with this content: a search field ("Search skills", filtering by case-insensitive substring of name and description, results within 100 ms for 200 skills); a "Pinned" section (skills the user pinned on this device, at most 16, in pin order); "Attached" (currently attached, with remove); and "All skills" grouped as Built-in, Project, Global. Each row has the name, a one-line description, badges (Built-in, Has scripts, Training, Pinned version), a check when attached, and a pin toggle. Selecting toggles attachment and keeps the picker open; the trigger shows "Skills" with no attachment and "<n> skills" otherwise, and the header shows the counter "<n>/8". Rows not available to the session's runtime or agent are listed last with their reason and, for admins, the one-press fix. Empty states: "No skills installed" with "Browse skills" (admins) or "Ask an admin device to install skills"; "No skills match your search". The picker is a 360 px popover above the composer on desktop and web, and a bottom sheet with 48 pt rows on mobile. Keyboard: Up/Down move, Space toggles, `Mod+P` toggles pin on the focused row, Escape closes; each row is announced as "<name>, <attached or not attached>, <n> of 8 attached". The control is disabled while disconnected and hidden when the host reports no skill support. [NEW]

#### Scenario: Search and attach
- **WHEN** the user types "cap" and presses Space on `jagentchill-captioning`
- **THEN** the row shows a check, the header reads "1/8", the picker stays open, and the trigger reads "1 skill"

#### Scenario: Pinned section
- **WHEN** the user pins two skills
- **THEN** they are listed under "Pinned" at the top of the picker on this device in every session, and pins are not shared with other devices

#### Scenario: No skills installed, editor device
- **WHEN** an editor opens the picker on a host where every skill is disabled
- **THEN** the picker shows "Ask an admin device to install skills" and no browse action

### Requirement: Skills screen — Installed
The Skills screen SHALL have the title "Skills", the subtitle "One list of skills for every agent and runtime: install, enable, create and train them.", a "Create skill" button, a context picker ("Global only" or a project), and tabs "Installed (<n>)" and "Browse". Installed lists family rows with: name, description (two lines), version or short revision, source label, scope, runtime chips from `visibleTo`, an enable switch, and badges — Built-in, JAgentChill (owned), Other (foreign), Disabled, Invalid, Has scripts, Pinned, Update available, Modified, Shadowed, Training, Graduated. Filters: search; "Visible to" (runtime); "Scope" (Built-in, Global, Project); "Source" (kind); "Installed by" (JAgentChill / Other); "Status" (Enabled, Disabled, Invalid, Update available). Toolbar: "Check for updates", "Update all (<n>)", "Sources", "Recently removed". Row menu: Details, Enable/Disable, Update, Pin/Unpin, "Make available to…", Train, Fork, Export, "Copy folder path" (admins), "Reveal in file manager" (desktop app connected to its own local Gateway only), Remove. States: loading skeleton rows; "No skills yet" with "Browse skills"; "No skills match your filters" with "Clear filters"; offline "Connect to a host to manage skills". Non-admin devices see the list and details read-only with the banner "Only admin devices can install or change skills". Wide and medium layouts use a table; compact uses stacked cards with the row menu behind a "More" button, and filters in a bottom sheet. [JAD JD-SKL-011] [NEW]

#### Scenario: Filter by runtime
- **WHEN** the admin sets "Visible to" to OpenCode
- **THEN** only skills whose `visibleTo` contains `acp-opencode` are listed and the tab label still shows the total installed count

#### Scenario: Invalid skill
- **WHEN** a folder in a discovery root has a `SKILL.md` without a description
- **THEN** it is listed with the badge "Invalid", the reason under its name, its enable switch disabled, and it is offered in no picker

#### Scenario: Offline
- **WHEN** the device is not connected to the host
- **THEN** the screen shows "Connect to a host to manage skills" and no cached row is interactive

### Requirement: Skills screen — Browse
The Browse tab SHALL show a search field, source filter chips ("All" plus one per enabled source), and a grid (wide: 3 columns; medium: 2; compact: 1) of cards from `skills.Browse catalogue`: name, description (three lines), source label, version, badges "Installed", "Update available", "Has scripts", and a primary button "Install" (admins), "Installed", or "Update". Pressing a card opens the catalogue item sheet: rendered `SKILL.md`, file list, source reference, verdict, and an install panel with the scope picker ("Global" or "Project: <name>") and the "Make available to" runtime checkboxes; "Install" opens the trust prompt. States: per-source loading rows; "Unable to load <source>" with "Retry"; "No skills found"; "No sources are enabled" with "Open sources". Results are paged 20 at a time with "Load more". [JAD JD-SKL-011] [NEW]

#### Scenario: Install from Browse into a project
- **WHEN** an admin opens a card, picks "Project: Launch film" and confirms the trust prompt
- **THEN** the skill is written to that project's workspace skills folder, the card shows "Installed", and it appears under Installed when that project is the selected context

#### Scenario: No sources enabled
- **WHEN** every source is disabled
- **THEN** Browse shows "No sources are enabled" with "Open sources"

### Requirement: Skill detail
The detail view of an installed skill SHALL show: header (name, badges, enable switch, version, "Updated <time>"); the rendered `SKILL.md` with a "Source" toggle showing the raw text; "Files" (tree with sizes; scripts marked; text files up to 256 KiB previewable, others "Preview not available"); "Source" (kind, reference, resolved revision, installed by <device name> on <date>, pin state, trust-for-updates state, update status with "Check now", "Update", "Roll back"); "Available to" (the matrix of `skills.Per-agent and per-runtime availability`); "Family" (other copies with "Differs"); "Training" (lessons list, status); and actions Edit (owned, non-bundled), Fork, Export, Remove. Rendering of `SKILL.md` never executes embedded HTML or scripts, loads no remote images, and opens links on the client only after the confirmation "Open <host>?". Bundled skills show "Built-in — updated with JAgentChill" in place of source controls. Desktop and web: a 640 px side sheet; mobile: a full-screen page. [NEW]

#### Scenario: Remote image in SKILL.md
- **WHEN** a skill's `SKILL.md` references an image at an `https://` URL
- **THEN** the detail shows a placeholder box with the alt text and makes no network request for it

#### Scenario: Bundled skill
- **WHEN** an admin opens `jagentchill-directing`
- **THEN** there is no Remove, Update or Edit action, the enable switch works, and "Fork" is available

### Requirement: Create, edit and fork skills in the app
An admin SHALL be able to author skills in the app. "Create skill" opens an editor with Name (validated live against the name rule and for conflicts), Description (counter to 1 024), Scope (Global or a project), and Instructions (Markdown editor with preview; 1–200 000 characters). Saving calls `jagentchill.skill.author {skillId?, name, description, body, scope, projectId?, expectedContentHash?}` (scope `jagentchill.config.write`), which writes an owned skill folder with a generated `SKILL.md` (`source.kind: "authored"`); editing an existing owned skill sends `expectedContentHash` and fails with `CONFLICT` when the folder changed meanwhile. The editor edits `SKILL.md` only; other files are added on the host or through upload. Renaming an owned skill is offered as "Rename…" (`jagentchill.skill.rename {skillId, name}`, scope `jagentchill.config.write`; `skill/name-conflict`, `skill/in-use`), which rewrites the folder, the front matter and the lock paths in one operation and is refused while any live session has the skill selected. `jagentchill.skill.fork {skillId, name?}` (scope `jagentchill.config.write`) copies any skill (bundled, foreign or owned) into an owned copy named `<name>-custom` by default, with `source.kind: "fork"` and the origin recorded; the fork is independent of updates to the original. Unsaved changes prompt "Discard changes?". [JAD JD-SKL-012] [NEW]

#### Scenario: Create a project skill
- **WHEN** an admin creates `brand-voice` with scope "Project: Launch film"
- **THEN** `<workspace>/.agents/skills/brand-voice/SKILL.md` exists with the entered front matter and body, and the skill is offered in that project's sessions only

#### Scenario: Fork a bundled skill
- **WHEN** an admin forks `jagentchill-editing`
- **THEN** an owned skill `jagentchill-editing-custom` exists, is editable, and the bundled one is unchanged

#### Scenario: Concurrent edit
- **WHEN** two admin devices edit the same skill and both save
- **THEN** the second save fails with `CONFLICT` and the editor offers "Reload" and "Save as a fork"

### Requirement: Agent tools to create and update skills
The server SHALL serve two tools from its tool endpoint (`server-api.Agent tool endpoint and session binding`), named per the convention of `agent-editing-tools.Tool naming and families` and listed in its catalogue: `jc_skill_create {name, description, instructions, scope: "global" | "project"}` and `jc_skill_update {skillId, instructions?, description?}`. `name` is normalised to the name rule (lower-cased, runs of other characters replaced by one hyphen, trimmed to 64) and the normalised name is returned. Both tools write `SKILL.md` text only: they cannot add scripts or other files, cannot rename, cannot touch a skill that is not owned (`skill/not-owned`), and `jc_skill_update` preserves the lessons section. Every call SHALL require an approval — JAgentDesk auto-approves updates, which is not reproduced: the call becomes a server approval of kind `skill-write` (`server-api.Approval and question resolution`: the tool endpoint returns `APPROVAL_PENDING:<requestId>` without writing anything, and the agent's identical retry passes once after an allow); the approval card shows the full proposed `SKILL.md` for a create or a text diff for an update; the server resolves it and checks the resolver at that moment — only a device with role `admin` and scope `jagentchill.config.write` that can act in the session is accepted, the resolving device is stored on the request and in the audit record `skill.author`, and an answer from any other device fails with `SCOPE_DENIED` and leaves the request pending; other devices that can read the session see the card with "Waiting for an admin device". No ancestor agent, reviewer agent or approval policy can answer it (`multi-agent-orchestration.Approvals resolved by the server`). The approval is required in every mode including Auto, in unattended sessions, in workflows and in automations; with no decision within 30 minutes the call fails with `APPROVAL_TIMEOUT`, and a declined call fails with `PERMISSION_DENIED`. A skill created by an agent is installed disabled-for-others: it is added to the creating persona's allow-list only, and an admin enables it for other personas from the detail. Both tools are available to creative and workspace agents; at most 5 skill tool calls per session per hour are accepted (`RATE_LIMITED`). [JAD JD-SKL-013] [NEW]

#### Scenario: Agent proposes a skill
- **WHEN** the Director calls `jc_skill_create` for `interview-cutdowns`
- **THEN** an approval card with the rendered `SKILL.md` appears, and after an admin approves, the skill exists as owned and authored, enabled for the Director only

#### Scenario: Update in Auto mode
- **WHEN** an agent in Auto mode calls `jc_skill_update`
- **THEN** the call waits for an admin's approval and is not auto-approved

#### Scenario: Editor tries to approve
- **WHEN** an `editor` device sends an allow decision for a pending `jc_skill_create` approval
- **THEN** the decision is refused with `SCOPE_DENIED`, the request stays pending, and no skill is written

#### Scenario: Foreign skill
- **WHEN** an agent calls `jc_skill_update` with the id of a skill found in a CLI's native directory
- **THEN** the call fails with `skill/not-owned` and no approval card is shown

### Requirement: Skill training
An owned skill SHALL accumulate lessons. `jagentchill.skill.learn {skillId, lesson, approved, sessionKey?}` (scope `jagentchill.config.write`): an approved lesson (1–500 characters, single paragraph) is appended as a bullet with its date under a `## Lessons` section at the end of `SKILL.md`; a rejected one is discarded. Lessons are proposed from the session ("Teach this skill…" on an assistant message while the skill is attached, which pre-fills a lesson the user edits) and by agents through `jc_skill_update` with the same approval. Training a skill that is not owned forks it first and applies the lesson to the fork, after telling the user. A skill holds at most 50 lessons; at the limit the editor asks the user to merge or delete lessons. Status: `training` from the first lesson; `graduated` after 5 consecutive uses (turns with the skill attached that finished without a negative turn rating and without a new lesson) following the last lesson; any new lesson returns it to `training`. `training.uses` counts turns with the skill attached. The Training section lists lessons with date and origin and allows edit and delete through `jagentchill.skill.lesson.update {skillId, lessonId, text? | delete: true}` (scope `jagentchill.config.write`), which rewrites the `## Lessons` section and returns the skill to `training`. [JAD JD-SKL-015] [NEW]

#### Scenario: Approve a lesson
- **WHEN** an admin approves the lesson "Keep lower-thirds under 40 characters"
- **THEN** the skill's `SKILL.md` ends with a `## Lessons` section containing that bullet and the skill shows the badge "Training"

#### Scenario: Graduation
- **WHEN** the skill is attached to 5 turns in a row with no negative rating and no new lesson
- **THEN** its badge changes to "Graduated"

#### Scenario: Train a bundled skill
- **WHEN** a lesson is approved for `jagentchill-captioning`
- **THEN** a fork `jagentchill-captioning-custom` receives the lesson, the dialog states "Built-in skills cannot be changed — a copy was created", and the bundled skill is unchanged

### Requirement: Bundled JAgentChill skills
The repository SHALL ship these skills as folders `skills/<name>/SKILL.md`, packaged with the server and loaded by the Gateway through the `skills.load.extraDirs` entry the server writes (never copied into the Gateway's tree), naming every product tool by its base name `jc_<name>` and never by a runtime-prefixed form (`agent-editing-tools.Tool naming and families`), original in wording (no text copied from any reference product), each at most 5 000 words:

Craft skills:
- `jagentchill-directing` — turns a request into a production plan: goal, audience, format and duration, step list, which persona does what, when to ask the user.
- `jagentchill-screenwriting` — writes and revises briefs, outlines, scripts, dialogue and narration in the script model of `script-studio.Script document`, with duration estimates.
- `jagentchill-storyboarding` — breaks a script into shots and panels with framing, movement, continuity notes and image/video prompt structure.
- `jagentchill-editing` — cutting rhythm and pacing, safe use of the editing tools and proposals, when to snapshot the timeline, how to keep edits undoable.
- `jagentchill-captioning` — caption generation, line breaking, reading speed, bilingual layout, burn-in versus sidecar.
- `jagentchill-sound-design` — music selection, SFX placement, voice levels, ducking and loudness targets.
- `jagentchill-colour` — grading order, matching shots, using adjustment layers and LUTs.
- `jagentchill-review` — the review checklist and the findings format a reviewer returns.
- `jagentchill-producing` — running the prompt-to-video workflow end to end: cost estimates, budgets, approvals, re-running a step, hand-over to the timeline.
- `jagentchill-diagram-authoring` — authoring archify-compatible workflow diagrams with the diagram tools (lanes, columns, node kinds, edges).

Film-stage skills:
- `jagentchill-film-production` — the overall film pipeline: stages, readiness and stale markers, which stage tool to call next.
- `jagentchill-film-story` — story input and expansion, episode splitting, style bible and creative direction.
- `jagentchill-film-casting` — character, location and prop analysis, appearance variants, reference images for consistency, voice assignment.
- `jagentchill-film-shots` — panel image prompts, first/last-frame video prompts, regeneration and candidate selection.
- `jagentchill-film-voice` — voice lines, speaker assignment, text-to-speech direction, lip-sync preparation.
- `jagentchill-film-assembly` — assembling panels, dialogue, captions and music into the timeline and exporting the whole film.

Orchestration skills:
- `jagentchill-orchestration` — the base team skill: preparing a task brief, creating peers, limits, reading hand-backs.
- `jagentchill-handoff` — handing work to another agent with a context package and returning a structured hand-back (changes, evidence, uncertainties, counter-arguments).
- `jagentchill-advisor` — asking a second agent for advice without transferring ownership.
- `jagentchill-committee` — convening several agents on one question and resolving dissent.
- `jagentchill-loop` — worker/verifier iteration with stop conditions.

A build check fails when any of the 21 folders is missing, has an invalid `SKILL.md`, exceeds the word limit, or names a tool that is not in the index of `agent-editing-tools.Tool naming and families`. Bundled skills carry the badge "Built-in", have `scope: "bundled"`, cannot be edited or removed, and are replaced with the product version on update. This list is the single definition of the bundle; `chat-agent.Persona skills` references it. [JAD JD-SKL-016] [NEW]

#### Scenario: Bundle is complete
- **WHEN** the server starts on a fresh host
- **THEN** all 21 `jagentchill-*` skills are listed with the badge "Built-in" and status `ok`

#### Scenario: Stale tool name
- **WHEN** a bundled `SKILL.md` mentions a `jc_*` tool name that is not in the tool catalogue
- **THEN** the build check fails naming the skill and the tool

### Requirement: Bundled skill selection and persona defaults
The bundled skills SHALL be available on every Gateway — desktop-supervised or headless — without an install step; JAgentDesk installs its bundle from the desktop app only. The user's selection is the enable switch of each bundled skill plus, per runtime with `skills: "native-dir"`, the checklist "Link built-in skills to <runtime>" in Settings ▸ Skills (all unchecked by default; each tick calls `jagentchill.skill.link.set` and the skill is linked per `skills.Runtime visibility and native directories`). Default persona allow-lists, written to `agents.entries.jagentchill-<persona>.skills` at first start and never overwriting user edits: Director → directing, review, diagram-authoring, orchestration, handoff, advisor, committee; Screenwriter → screenwriting, handoff; Storyboard artist → storyboarding, film-shots, handoff; Editor → editing, captioning, sound-design, colour, handoff; Reviewer → review; Producer → producing, directing, film-production, film-story, film-casting, film-shots, film-voice, film-assembly, diagram-authoring, orchestration, handoff, loop. "Reset to defaults" on a persona restores its list. Disabling a bundled skill removes it from every picker for sessions started afterwards and does not edit the persona lists. [JAD JD-SKL-016] [NEW]

#### Scenario: Headless host
- **WHEN** the Gateway runs from the Docker distribution with no desktop app
- **THEN** the bundled skills are listed and attachable from a paired phone

#### Scenario: Link the bundle to a CLI runtime
- **WHEN** an admin checks `jagentchill-editing` under "Link built-in skills to OpenCode"
- **THEN** a link to the bundled folder exists in `~/.agents/skills`, recorded in the lock file, and the skill is attachable in OpenCode sessions

#### Scenario: User edits are kept
- **WHEN** an admin removed `jagentchill-colour` from the Editor persona and the product is updated
- **THEN** the Editor's list still lacks `jagentchill-colour`

### Requirement: Export and sharing of a skill folder
`jagentchill.skill.export {skillId}` (scope `jagentchill.agent.use`) SHALL package the skill folder as `<name>.skill.zip` — a standard archive with the single top-level folder `<name>/` — store it as a content-addressed blob, and return `{blobSha256, fileName, sizeBytes, excluded[]}`; the client downloads it through `server-api.Authenticated media delivery`. Excluded from the archive and listed in `excluded[]`: `.git/`, OS metadata files, and files matching `.env*`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`, `secrets*`. Lessons are part of `SKILL.md` and are included; lock-file data, training counters and host paths are not. The export dialog shows the file list and the exclusions before the download. Delivery: desktop — save dialog; web — browser download; mobile — the system share sheet. The archive installs on another host through the `local` upload path of `skills.Skill sources`, with the normal trust prompt, and installs unchanged in any tool that reads standard skill folders. Export blobs are deleted 24 h after creation. Skills larger than the size limit cannot exist, so export has no additional size rule. [NEW]

#### Scenario: Export and re-import
- **WHEN** an authored skill is exported on one host and uploaded on another
- **THEN** the second host shows the trust prompt with source "Uploaded from <device name>" and, once installed, the skill's content hash equals the exported folder's

#### Scenario: Excluded file
- **WHEN** a skill folder contains `.env.local`
- **THEN** the export dialog lists it under "Not included" and the archive does not contain it

#### Scenario: Viewer
- **WHEN** a viewer device calls `skill.export`
- **THEN** the call fails with `SCOPE_DENIED`

### Requirement: Skill permissions
Skill privileges SHALL follow the device roles of design D25. Device roles hold only JAgentChill scopes; every call is checked by the server on its own channel. Role `admin` (scopes `jagentchill.config.write`): install, update, roll back, pin, restore, remove, enable and disable, link to runtimes, manage sources, author, fork, rename, train, approve agent-proposed skills (the server checks the resolver's role when it resolves the approval), change persona allow-lists, answer trust prompts. Roles `editor` and `admin` (scope `jagentchill.agent.use`): attach skills to turns, switch skills per session, pin skills in the picker, export. All roles including `viewer` (scope `jagentchill.config.read`): list, detail, browse, sources list, update status. Agents of either class (creative or workspace) can propose skills only through the two approval-gated tools and can never install from a source, link, enable, remove or answer a trust prompt. Skills with scripts are attachable in creative sessions — creative agents have no command execution, so the scripts cannot run there, including creative sessions on a CLI or ACP runtime under `agent-runtimes.Creative sessions on CLI and ACP runtimes` — and the picker marks them "Scripts run only in workspace sessions". Agent classes and the host setting that lets editors start workspace agents are those of `multi-agent-orchestration.Agent classes and creation privileges`. Every state-changing call writes an audit record (`skill.install`, `skill.update`, `skill.rollback`, `skill.remove`, `skill.restore`, `skill.enable`, `skill.link`, `skill.pin`, `skill.rename`, `skill.trust`, `skill.author`, `skill.lesson`, `skill.source.change`) with the actor device, the skill id, source reference and revision. A denied call returns `SCOPE_DENIED`. [NEW]

#### Scenario: Editor attaches, cannot install
- **WHEN** an editor attaches a skill and then calls `jagentchill.skill.install`
- **THEN** the attachment succeeds and the install fails with `SCOPE_DENIED`

#### Scenario: Audit of an install
- **WHEN** an admin installs a skill from a git source
- **THEN** an audit record with action `skill.install`, the repository URL, the commit and the device id exists

### Requirement: Skill error codes
Skill operations SHALL fail with one of these domain codes inside the envelope of `server-api.RPC error envelope`, each with a localised message: `skill/name-conflict` (a skill or foreign folder of that name exists in the target; `details.suggestedName`); `skill/not-found`; `skill/not-owned`; `skill/confirmation-required`; `skill/invalid` (`details.reason`: missing `SKILL.md`, unparseable front matter, bad name, description length, unsafe path, unsupported file type); `skill/too-large` (`details.limit`); `skill/path-not-allowed` (a `local` path outside the host's allowed roots or inside the Gateway state directory); `skill/source-fetch-failed` (`retryable: true`, `details.sourceId`, `details.cause`); `skill/catalogue-item-not-found`; `skill/source-not-found`; `skill/blocked`; `skill/content-changed`; `skill/not-available` (`details.skillId`, `details.reason: "disabled" | "agent" | "runtime"`); `skill/too-many`; `skill/in-use` (rename or remove refused while a live session selected it; `details.sessionIds`). General codes used unchanged: `SCOPE_DENIED`, `INVALID_PARAMS`, `CONFLICT`, `QUOTA_EXCEEDED`, `EGRESS_BLOCKED`, `APPROVAL_TIMEOUT`, `PERMISSION_DENIED`, `RATE_LIMITED`, `UNSUPPORTED_FEATURE`. [JAD JD-SKL-014] [NEW]

#### Scenario: Fetch failure is retryable
- **WHEN** a git fetch fails because the host has no network
- **THEN** the error is `skill/source-fetch-failed` with `retryable: true` and the UI offers "Retry"

#### Scenario: Local path inside the state directory
- **WHEN** an admin adds a `local` source pointing into the Gateway state directory
- **THEN** the call fails with `skill/path-not-allowed`

### Requirement: Skill limits
The following limits SHALL apply: 8 skills per turn; 64 skills selected per new session (the Gateway's limit); 200 installed non-bundled skills per host and 50 per project; 20 MiB and 2 000 files per skill folder; `SKILL.md` ≤ 256 KiB; description ≤ 1 024 characters; name ≤ 64 characters; 50 lessons of ≤ 500 characters per skill; 20 sources; 16 pinned skills per device; 3 concurrent install or update operations per host, further ones queued in order; source listing fetch timeout 15 s and install download timeout 120 s; one backup per skill kept 30 days; uploaded archives ≤ 20 MiB compressed and ≤ 100 MiB uncompressed with a compression ratio no greater than 100:1. Exceeding a count limit fails with `QUOTA_EXCEEDED` naming the limit; a size limit with `skill/too-large`. [NEW]

#### Scenario: Oversized upload
- **WHEN** a 25 MiB `.zip` is uploaded as a skill
- **THEN** the install fails with `skill/too-large`, `details.limit: "20 MiB"`, and no folder is created

#### Scenario: Archive bomb
- **WHEN** a 1 MiB archive expands to more than 100 MiB
- **THEN** extraction stops, the install fails with `skill/too-large`, and the staging directory is deleted

#### Scenario: Fourth concurrent install
- **WHEN** four installs are started at once
- **THEN** three run and the fourth shows "Waiting…" and starts when one finishes

### Requirement: Skill failure and degraded states
The product SHALL behave as follows in failure states. Gateway without the skill RPCs or with administrator-scope calls over the gateway link unavailable (spike S12 failed): listing, attaching and the bundled skills work; install, update, enable and remove of global skills use the server's direct-write fallback of `skills.Install`, and actions with no fallback show "Manage this on the host with `openclaw skills`" and return `UNSUPPORTED_FEATURE`. A skill that becomes `invalid` after an edit on disk is dropped from pickers at the next `skills.changed` event; sessions that had it attached show "<name> is no longer valid and was detached". A referenced skill that the Gateway rejects at send time (extra reference, allow-list-hidden) surfaces the Gateway's visible error as an error item, the user's text is restored to the composer, and no partial turn runs. An interrupted install or update (Gateway stop) leaves no partial folder: at start, staging directories are deleted and a half-replaced skill is restored from `previous`. A lock file that fails to parse is renamed to `lock.json.corrupt-<timestamp>`, a new lock is rebuilt containing only skills whose folders carry the server's marker file `.jagentchill-skill.json` (written at install with the source record), and the Skills screen shows "Skill records were rebuilt" once. Disk full during install fails with `QUOTA_EXCEEDED` and leaves existing skills intact. [NEW]

#### Scenario: Gateway restarts mid-update
- **WHEN** the Gateway stops while an update is replacing a skill's folder
- **THEN** after restart the skill is at its previous revision, complete, and the update is shown as "Not applied — try again"

#### Scenario: Skill invalidated on disk
- **WHEN** the `SKILL.md` of an attached skill is edited on the host into an unparseable state
- **THEN** within 2 s of the Gateway's change event the skill shows "Invalid" in the list and is detached from sessions with a notice

#### Scenario: Corrupt lock file
- **WHEN** `lock.json` contains invalid JSON at start
- **THEN** it is renamed with a `corrupt` suffix, records are rebuilt from marker files, and no skill folder is deleted

### Requirement: Skill RPC surface
The `skill` domain of `server-api.RPC domain ownership` SHALL consist of exactly the 27 methods of the first table and the event `jagentchill.skill.changed`; within the `session` domain this capability defines exactly the delegated methods of the second table (`session.skills.*`). The parameters, result and required scope of each method are stated by the requirement named in its row, and the scope rules by `skills.Skill permissions`.

| Method | Defined in |
|---|---|
| `jagentchill.skill.list` | `skills.Skill record` |
| `jagentchill.skill.source.list` | `skills.Source management and defaults` |
| `jagentchill.skill.source.upsert` | `skills.Source management and defaults` |
| `jagentchill.skill.source.remove` | `skills.Source management and defaults` |
| `jagentchill.skill.source.refresh` | `skills.Source management and defaults` |
| `jagentchill.skill.catalogue.get` | `skills.Browse catalogue` |
| `jagentchill.skill.catalogue.list` | `skills.Browse catalogue` |
| `jagentchill.skill.install` | `skills.Install` |
| `jagentchill.skill.update.apply` | `skills.Update from source` |
| `jagentchill.skill.update.check` | `skills.Update from source` |
| `jagentchill.skill.rollback` | `skills.Update from source` |
| `jagentchill.skill.trust.set` | `skills.Update from source` |
| `jagentchill.skill.pin.set` | `skills.Version pinning` |
| `jagentchill.skill.link.set` | `skills.Runtime visibility and native directories` |
| `jagentchill.skill.remove` | `skills.Remove, disable and foreign skills` |
| `jagentchill.skill.setEnabled` | `skills.Remove, disable and foreign skills` |
| `jagentchill.skill.removed.list` | `skills.Remove, disable and foreign skills` |
| `jagentchill.skill.restore` | `skills.Remove, disable and foreign skills` |
| `jagentchill.skill.invocation.build` | `skills.Invocation rewriting per runtime` |
| `jagentchill.skill.author` | `skills.Create, edit and fork skills in the app` |
| `jagentchill.skill.fork` | `skills.Create, edit and fork skills in the app` |
| `jagentchill.skill.rename` | `skills.Create, edit and fork skills in the app` |
| `jagentchill.skill.learn` | `skills.Skill training` |
| `jagentchill.skill.lesson.update` | `skills.Skill training` |
| `jagentchill.skill.export` | `skills.Export and sharing of a skill folder` |
| `jagentchill.skill.subscribe` | `skills.Skill RPC surface` |
| `jagentchill.skill.unsubscribe` | `skills.Skill RPC surface` |

| Method | Defined in |
|---|---|
| `jagentchill.session.skills.get` | `skills.Skills attached to a turn` |
| `jagentchill.session.skills.set` | `skills.Skills attached to a turn` |

`jagentchill.skill.subscribe {}` and `jagentchill.skill.unsubscribe {}` (scope `jagentchill.projects.read`) open and close the stream `skill`, on which `jagentchill.skill.changed` is delivered; `jagentchill.skill.list` is the pull RPC of that stream. Every admin action this capability describes maps to one row; the persona allow-list is the one action written through another capability's method (`jagentchill.agent.persona.update` of `chat-agent.Persona list and editor`), and approvals of agent-proposed skills are answered through `server-api.Approval and question resolution`. A handler under `jagentchill.skill.` or `jagentchill.session.skills.` that these tables do not name MUST fail the contract test `rpc-ownership`. [NEW]

#### Scenario: Ownership test is exact
- **WHEN** the contract test `rpc-ownership` compares the server's handlers under `jagentchill.skill.` and `jagentchill.session.skills.` with these tables
- **THEN** the two sets are equal

#### Scenario: Every admin action has a method
- **WHEN** the contract test walks the Skills screen actions Make available, Pin, Unpin, Install specific version, Roll back, Restore, Rename, trust for updates, source add, edit, remove and refresh, lesson edit and delete
- **THEN** each one calls a method of the first table and none calls an unlisted name

#### Scenario: Unlisted method
- **WHEN** server code adds a handler `jagentchill.skill.publish`
- **THEN** `rpc-ownership` fails and names the method
