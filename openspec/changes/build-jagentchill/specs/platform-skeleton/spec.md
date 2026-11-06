## ADDED Requirements

### Requirement: Fork baseline and remotes
The repository SHALL be JAgentChill's own git repository and pnpm monorepo (design D1); it is not a fork or a clone of OpenClaw and holds none of OpenClaw's history or files — the title of this requirement is historical. OpenClaw SHALL be present only as the pinned Gateway: the tracked file `gateway/OPENCLAW_VERSION` holds exactly one stable OpenClaw release tag (a tag with no `-beta`, `-nightly`, `-rc` or other pre-release suffix; a branch such as `main` MUST NOT be used); `scripts/gateway-pull.sh` fetches that tag from `https://github.com/openclaw/openclaw.git` into `gateway/openclaw/`, which is ignored by git, never committed to this repository, never edited and never holds a JAgentChill file. The resolved base SHALL be recorded in the tracked file `gateway/openclaw.lock.json` with exactly the fields `tag` (string, equal to `gateway/OPENCLAW_VERSION`), `commit` (40-character lowercase hex SHA) and `pulled_ms` (Unix UTC milliseconds). [NEW]

#### Scenario: Lock file matches the pulled Gateway
- **WHEN** a contributor runs `scripts/gateway-pull.sh` and then `pnpm jagentchill:check:upstream` on a clean checkout
- **THEN** the command verifies that `gateway/openclaw.lock.json.tag` equals `gateway/OPENCLAW_VERSION`, that the tag resolves to `commit`, and that `HEAD` of `gateway/openclaw/` is that commit
- **AND** exits 0

#### Scenario: Pre-release tag rejected
- **WHEN** `gateway/OPENCLAW_VERSION` contains a pre-release suffix such as `-beta.2`
- **THEN** `pnpm jagentchill:check:upstream` exits with a non-zero status and prints `gateway pin must be a stable tag`

#### Scenario: Pulled tree is at another commit
- **WHEN** `HEAD` of `gateway/openclaw/` is not `gateway/openclaw.lock.json.commit`
- **THEN** the command exits non-zero and prints both commit SHAs

#### Scenario: Gateway source is not tracked
- **WHEN** `git ls-files gateway/` is run
- **THEN** it lists `gateway/OPENCLAW_VERSION`, `gateway/openclaw.lock.json` and `gateway/README.md` and nothing under `gateway/openclaw/`

### Requirement: Product directory layout
All JAgentChill product code SHALL live only in the following paths of JAgentChill's own repository (design D1): `server/` (JAgentChill Server, package `@jagentchill/server`: channel P, HTTP routes, services, the agent tool endpoint, gateway supervision and the gateway link, generation provider adapters, with one source module per domain — pairing, sync, queue, render-host supervision, agent tools, multi-agent, script, workflow host, film host, automation, workspace, terminal, usage, skills, connectors, runtimes and providers, notifications — its prompts in `server/prompts/`, and the Go sources of the ingress helper in `server/go/tsnet-bridge/` — the path-restricted reverse proxy behind the tailnet and LAN listeners of `server-api.Product listeners and path restriction`, built for macOS, Windows and Linux on arm64 and x64 and gated by spike S20); `packages/protocol/` (shared Zod schemas, the server configuration schema, error, event, scope and feature-flag registries); `packages/editor-core/` (model, commands, undo, selection, placement, keyframes; pure TypeScript with no DOM access); `packages/render/` (scene builder, frame descriptors, decode, audio mix, export); `packages/render-wasm/` (Rust wgpu crate compiled to wasm); `packages/media/` (probe, thumbnail, waveform, proxy, transcription); `packages/workflow/` (workflow engine, document schema and the projection to plain archify documents); `packages/archify/` (the fork of archify, kept with its own upstream remote and recorded upstream commit, extended into the editable workflow canvas of design D12: free coordinates, incremental redraw, editing layer, run overlay, message bridge, touch gestures, design-system tokens, and the PNG, SVG, WebM and self-contained HTML exports; when spike S19 of `diagnostics-quality.Gating spikes` fails on a target, nothing is replaced automatically: the owner decides between fixing the fork, a product renderer for the failing platform class, or a product renderer everywhere (decision A5), and any product renderer lives in this same package behind the same component interface, so no other path changes); `packages/film/` (film production domain); `packages/content/` (bundled content as data with typed manifests: starter stickers, bundled templates and their procedural demo definitions, the bundled sound pack, baked LUTs and preset catalogues; no runtime logic); `packages/provider-kit/` (provider adapter contract of capability `generation-providers`, implemented by the generation providers that run inside the server); `packages/ui/` (design system); `apps/app/` (Expo app for iOS, Android and web, including the native modules `JagentchillEngineView`, `JagentchillCanvasView` (the WebView host of the workflow canvas, `workflow-diagram.Runtime hosting on each platform`), `JagentchillCrypto`, `JagentchillTransport` and `JagentchillTailnet` — the last with Swift and Kotlin wrappers over one Go bridge built with `gomobile bind`, present in both store builds (removed from both only by the owner-approved S20 fallback), `device-pairing-signing.Embedded tailnet node on mobile`); `apps/desktop/` (Electron shell that starts JAgentChill Server, also the render-host executable, with the tailnet proxy helper binary for each desktop platform); `skills/` (agent skills); `deploy/` (Dockerfile and compose file of the headless distribution, including the server, the built Gateway, a Node runtime, the render host, both FFmpeg builds and the ingress helper); and `scripts/` (build, guard, gateway pull, gateway build and gateway upgrade scripts). `gateway/` holds only the pin, the lock file, a README and the ignored pristine checkout `gateway/openclaw/` (`platform-skeleton.Fork baseline and remotes`). There SHALL be no `extensions/` and no `plugins/` directory: JAgentChill is not a plugin of OpenClaw and ships none. No other directory SHALL contain product runtime code. [NEW]

#### Scenario: All workspace packages are discovered
- **WHEN** `pnpm -r list --depth -1 --json` is run after `pnpm install`
- **THEN** the output contains one workspace package for each of the fourteen `server/`, `packages/` and `apps/` paths listed above and no package from `gateway/openclaw/`
- **AND** every one of those package names begins with `@jagentchill/`

#### Scenario: Product code placed outside the layout
- **WHEN** a commit adds a TypeScript, Rust, Go, Swift or Kotlin source file under a path that is not in the list above and not in the support paths of `platform-skeleton.JAgentChill-owned support paths`
- **THEN** the upstream guard fails as specified in `platform-skeleton.Read-only upstream guard`

#### Scenario: Canvas package after an owner-approved renderer decision
- **WHEN** spike S19 failed on a target and the S19 record carries `owner-approved` for a product renderer
- **THEN** that renderer lives in `packages/archify/` behind the same component interface, no additional canvas package is created, and the list of fourteen workspace packages is unchanged

#### Scenario: No plugin directories
- **WHEN** the repository tree is listed at any commit of the default branch
- **THEN** no path starts with `extensions/` or `plugins/`, and no tracked file is an OpenClaw plugin manifest

### Requirement: JAgentChill-owned support paths
In addition to the product directories, the repository SHALL contain only these non-runtime paths: `openspec/`; the document folders `docs/research/`, `docs/design/` (holding the required file of `platform-skeleton.UI design reference file`), `docs/stories/`, `docs/decisions/`, `docs/product/` and the harness folders `docs/plans/`, `docs/templates/`, `docs/patterns/`, `docs/README.md`, `docs/WORKFLOW.md`; the single documents `docs/TOOLCHAIN.md`, `docs/GATEWAY-UPGRADES.md`, `docs/ASSET-PROVENANCE.md` and `docs/AGENTS.jagentchill.md`; `gateway/OPENCLAW_VERSION`, `gateway/openclaw.lock.json` and `gateway/README.md`; the root files `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.gitignore`, `LICENSE`, `AGENTS.md`, `CLAUDE.md` and `THIRD_PARTY_NOTICES.md`, all of them JAgentChill's own; `.harness-core/`; `.agents/skills/harness-*` (the skills the harness installs); `.claude/skills/jagentchill-*`; `scripts/bin/harness*` (ignored by the root `.gitignore`); and `.github/workflows/jagentchill-*.yml`. `.refs/` (reference clones and review notes) and `.dev/` (development state and scratch) SHALL be ignored by the root `.gitignore` and never committed, as SHALL `gateway/openclaw/`, `node_modules/` and build output. Nothing in these paths is copied into the Gateway or into the distributed Gateway build (`updates-distribution.Desktop packaging targets`). [NEW]

#### Scenario: Reference clones are never committed
- **WHEN** a contributor runs `git status --short` after cloning reference repositories into `.refs/`
- **THEN** no path under `.refs/` appears as untracked or modified

#### Scenario: Pulled Gateway is never committed
- **WHEN** `scripts/gateway-pull.sh` and the Gateway build have run
- **THEN** `git status --short` lists nothing under `gateway/openclaw/`

#### Scenario: Development state is ignored
- **WHEN** `pnpm jagentchill:dev` has created `.dev/server-data/`
- **THEN** `git status --short` lists nothing under `.dev/`

### Requirement: Read-only upstream guard
`gateway/openclaw/` SHALL be read-only and pristine: every file of the pinned OpenClaw tag stays byte-identical, and no file is added to the checkout or to its build output by JAgentChill. The guard `pnpm jagentchill:check:upstream` SHALL fail when (a) the pin, the lock file and the checked-out commit disagree (`platform-skeleton.Fork baseline and remotes`); (b) `git -C gateway/openclaw status --porcelain` reports a modified, deleted, renamed or untracked path (paths ignored by OpenClaw's own ignore rules — its `node_modules` and build output — are not reported); (c) any path tracked by the JAgentChill repository lies under `gateway/openclaw/`; (d) a JAgentChill script, build step or packaging step writes into `gateway/openclaw/` anything other than what OpenClaw's own install and build commands produce, which the guard checks by scanning `scripts/`, `deploy/` and the packaging configuration for a copy or write whose target is under that directory; (e) a patch against OpenClaw exists (`platform-skeleton.Allowed upstream patch list`); or (f) a tracked product source file lies outside the product directories and the JAgentChill-owned support paths. The failure output SHALL list each offending path on its own line prefixed with its git status letter, and the command SHALL complete in 30 seconds or less on the CI runner class used by the job `jagentchill-upstream-guard`. The guard SHALL run in CI on every pull request and as the second step of `diagnostics-quality.Verify gate`. [NEW]

#### Scenario: Edit to the Gateway is blocked
- **WHEN** one line of `gateway/openclaw/src/gateway/server.ts` is changed in a working tree or in a CI checkout
- **THEN** the job `jagentchill-upstream-guard` fails
- **AND** its log contains the line `M src/gateway/server.ts`

#### Scenario: JAgentChill file placed inside the Gateway
- **WHEN** a build step copies a file to `gateway/openclaw/extensions/jagentchill/index.ts` or to `gateway/openclaw/dist/extensions/jagentchill/`
- **THEN** the guard fails and lists the path with status `??`, or names the build step that targets the Gateway directory

#### Scenario: New product file is allowed
- **WHEN** a commit adds `packages/editor-core/src/commands/split.ts` and nothing else
- **THEN** the guard exits 0

#### Scenario: Fresh pull and build pass the guard
- **WHEN** `pnpm install`, `scripts/gateway-pull.sh`, the Gateway build and `pnpm jagentchill:build` have run on a clean checkout
- **THEN** the guard exits 0, because installing and building the Gateway changes no tracked OpenClaw file

#### Scenario: Deleting an unused OpenClaw extension is blocked
- **WHEN** a script deletes `gateway/openclaw/extensions/telegram/` to shrink a package
- **THEN** the guard fails and lists each deleted file with status `D`

### Requirement: Allowed upstream patch list
The list of allowed patches to OpenClaw SHALL be empty, and no `upstream-patches.json` exists (design D1: there is no upstream patch allow-list). JAgentChill SHALL NOT carry, apply or generate a patch, an overlay, a `pnpm patch` or `patchedDependencies` entry, a post-install rewrite or a build-time file substitution against OpenClaw's source, its dependencies' resolution or its build output, and SHALL NOT depend on OpenClaw's workspace dependency policy. Everything the Gateway has to know about JAgentChill is configuration that the server writes (`server-api.Gateway supervision and lifecycle`, `platform-skeleton.Run profile application`); a behaviour OpenClaw lacks is obtained from a newer OpenClaw release or built in the server. An exception SHALL require an owner-approved decision record under `docs/decisions/` and a change to this requirement before any such file is merged. [NEW]

#### Scenario: Patch file added
- **WHEN** a pull request adds a `*.patch` file whose target is OpenClaw, or a `patchedDependencies` entry naming `openclaw` or an `@openclaw/*` package
- **THEN** `pnpm jagentchill:check:upstream` fails with `upstream patch not allowed` and names the file

#### Scenario: Distributed Gateway equals a pristine build
- **WHEN** the packaging test compares the file list and hashes of the Gateway inside a distribution with a build of the pinned tag made from a fresh pull on the same platform
- **THEN** they are identical

#### Scenario: Exception without a decision record
- **WHEN** a commit changes this requirement's rule in code (a guard exemption) without an owner-approved record under `docs/decisions/`
- **THEN** the job `jagentchill-policy` fails with `upstream exception requires an owner-approved decision record`

### Requirement: Gateway build and placement
The Gateway SHALL be installed and built in place, as OpenClaw itself is built, by `scripts/gateway-build.sh` (`pnpm jagentchill:gateway:build`): inside `gateway/openclaw/`, with OpenClaw's own lockfile, workspace file and dependency policy, a frozen-lockfile install followed by OpenClaw's build command; the script passes no JAgentChill option, flag or environment variable that changes what is built. `gateway/openclaw/` SHALL NOT be a member of the JAgentChill workspace (`platform-skeleton.Workspace feasibility spike and fallback`), and no JAgentChill package SHALL be linked, installed or copied into it. The server locates the built Gateway through `openclawRoot` (`server-api.Gateway supervision and lifecycle`): `gateway/openclaw/` in a checkout, the packaged copy in a distribution. The server's dependency `@openclaw/gateway-client` SHALL be the published package at exactly the version of the pin (`platform-skeleton.Gateway client compatibility declaration`); a development checkout is allowed to resolve it from the built Gateway tree of the same tag. The build is a cache hit when the pin and the lock file are unchanged and the build output exists. [NEW]

#### Scenario: Build from a fresh pull
- **WHEN** `pnpm jagentchill:gateway:pull` and `pnpm jagentchill:gateway:build` run on a clean checkout
- **THEN** `gateway/openclaw/openclaw.mjs gateway --help` exits 0 under the required Node version, and the guard of `platform-skeleton.Read-only upstream guard` passes

#### Scenario: Gateway is not a workspace member
- **WHEN** `pnpm install` runs at the repository root
- **THEN** nothing is installed inside `gateway/openclaw/`, and the root lockfile has no importer under `gateway/`

#### Scenario: Pin changed without a rebuild
- **WHEN** `gateway/OPENCLAW_VERSION` names another tag than the one the existing build output was made from
- **THEN** `pnpm jagentchill:build` rebuilds the Gateway, or fails with `gateway build is stale` when the new tag has not been pulled

### Requirement: Upstream CI disabled in fork settings
The repository is not a fork, so it holds no OpenClaw workflow file and nothing has to be disabled in the forge's settings (the title is historical). Only `.github/workflows/jagentchill-*.yml` SHALL exist and run. OpenClaw's own test suites, lint and release workflows SHALL NOT be gates of JAgentChill: a JAgentChill workflow runs inside `gateway/openclaw/` only the pull, the install, the build and what the gateway contract suite of `diagnostics-quality.Gateway contract tests` starts. `pnpm jagentchill:check:ci` SHALL fail when a workflow file that does not match `jagentchill-*.yml` is tracked or when a workflow step runs another command inside `gateway/openclaw/`; with `--remote` it SHALL query the forge's API and exit non-zero, naming each file, when an enabled workflow does not match `jagentchill-*.yml`. [NEW]

#### Scenario: Workflow copied from OpenClaw
- **WHEN** a pull request adds `.github/workflows/ci.yml` copied from the Gateway checkout
- **THEN** `pnpm jagentchill:check:ci` fails and names the file

#### Scenario: OpenClaw test suite as a gate
- **WHEN** a JAgentChill workflow adds a step that runs OpenClaw's full test command inside `gateway/openclaw/`
- **THEN** `pnpm jagentchill:check:ci` fails with `gateway step not allowed` naming the step

#### Scenario: Push runs only product workflows
- **WHEN** a commit is pushed to the default branch
- **THEN** every workflow run started for that commit is from a `jagentchill-*.yml` file

### Requirement: Workspace feasibility spike and fallback
JAgentChill SHALL have its own pnpm workspace at the repository root, with `pnpm-workspace.yaml` listing exactly `server`, `packages/*` and `apps/*`, its own `pnpm-lock.yaml` and its own dependency policy (`platform-skeleton.Dependency admission policy`). OpenClaw's workspace — its `overrides`, `nodeLinker`, release-age rules and lockfile — applies only inside `gateway/openclaw/` and never to a JAgentChill package, and JAgentChill's policy never applies to OpenClaw. Spike S5 is withdrawn: there is no upstream workspace for the apps to fit into, so there is no second-workspace fallback and no `apps/jagentchill-workspace/` (the title is historical). In its place the CI job `jagentchill-build` SHALL prove, on every pull request that touches `apps/`, `packages/` or the root workspace files, that `expo export -p web`, `expo prebuild` followed by debug builds for iOS and Android, and `electron-builder --dir` on macOS, Windows and Linux succeed in this workspace. No capability specification depends on how OpenClaw resolves its dependencies. [NEW]

#### Scenario: App toolchain builds in the workspace
- **WHEN** the job `jagentchill-build` runs on a pull request that changes `apps/app/package.json`
- **THEN** the web export, the iOS and Android debug builds and the three desktop directory builds succeed

#### Scenario: OpenClaw policy does not leak
- **WHEN** the pinned OpenClaw tag adds an `overrides` entry for a package that `apps/app` also uses
- **THEN** the version resolved for `apps/app` is unchanged and the root lockfile does not change

#### Scenario: Workspace member outside the three globs
- **WHEN** `pnpm-workspace.yaml` gains the entry `gateway/openclaw` or `gateway/openclaw/packages/*`
- **THEN** `pnpm jagentchill:check:upstream` fails with `gateway must not be a workspace member`

### Requirement: Upstream merge procedure
A newer OpenClaw SHALL be taken only by raising the pin through the script `pnpm jagentchill:upstream:sync <tag>` — nothing is merged, because the repository holds no OpenClaw history (the title is historical). The script performs these steps in order and stops at the first failure: (1) verify the working tree is clean; (2) verify `<tag>` is a stable tag newer than `gateway/OPENCLAW_VERSION`; (3) create branch `gateway-upgrade/<tag>`; (4) write `<tag>` to `gateway/OPENCLAW_VERSION` and run `scripts/gateway-pull.sh`; (5) write the new `tag`, `commit` and `pulled_ms` to `gateway/openclaw.lock.json`; (6) set the server's `@openclaw/gateway-client` dependency to the same version and run `pnpm install`; (7) run `scripts/gateway-build.sh`; (8) run `openclaw doctor --fix --yes --non-interactive` of the new build against a scratch state directory; (9) run the upstream guard; (10) run the gateway contract suite of `diagnostics-quality.Gateway contract tests` (which re-verifies every surface of `platform-skeleton.Gateway surface feasibility record`) and the full gate of `diagnostics-quality.Verify gate`. The script SHALL append one row (date, old tag, new tag, result) to the log table in `docs/GATEWAY-UPGRADES.md`. No step edits a file of OpenClaw, and the upgrade changes exactly three kinds of tracked files: the pin, the lock file and JAgentChill's own lockfile and server manifest (plus server code when a surface changed). [NEW]

#### Scenario: Clean upgrade to a newer stable tag
- **WHEN** `pnpm jagentchill:upstream:sync v2026.10.2` is run and every surface the server uses is unchanged
- **THEN** `gateway/OPENCLAW_VERSION` and `gateway/openclaw.lock.json.tag` equal `v2026.10.2`, the server depends on `@openclaw/gateway-client` of that version
- **AND** `docs/GATEWAY-UPGRADES.md` has a new log row with result `passed`

#### Scenario: Gateway surface break detected
- **WHEN** the gateway contract suite fails at step 10 because a method of `CORE_METHODS` changed its parameters
- **THEN** the script exits non-zero, names the method, the log row records result `failed: contract`, and the branch is not merged into the default branch

#### Scenario: Pre-release or older tag
- **WHEN** the script is given `v2026.10.2-beta.1`, or a tag older than the pin
- **THEN** it exits non-zero at step 2 and changes no file

#### Scenario: Dirty tree
- **WHEN** the script is started with uncommitted changes
- **THEN** it exits non-zero before pulling and prints `working tree must be clean`

### Requirement: Gateway client compatibility declaration
`server/package.json` SHALL declare the dependency `@openclaw/gateway-client` pinned to exactly the version of `gateway/OPENCLAW_VERSION`, and no other workspace package SHALL depend on any `openclaw` or `@openclaw/*` package. Server code SHALL use OpenClaw only through that client library and the Gateway protocol it speaks (protocol version 4 only, `server-api.Gateway link`); imports that resolve into `gateway/openclaw/` or to OpenClaw's plugin SDK are forbidden and SHALL fail lint. The server SHALL NOT rely on an interface OpenClaw marks experimental, and SHALL reach agent runtimes only through the Gateway's bundled backends, harnesses and ACP client, by configuration and Gateway methods. [NEW]

#### Scenario: Version tracks the pin
- **WHEN** `gateway/OPENCLAW_VERSION` is `v2026.9.8`
- **THEN** `server/package.json` pins `@openclaw/gateway-client` to exactly `2026.9.8`, and `pnpm jagentchill:check:upstream` fails when the two differ

#### Scenario: Import of Gateway internals
- **WHEN** a file under `server/` contains `import ... from "../../gateway/openclaw/src/pairing/store"`
- **THEN** `pnpm jagentchill:lint` reports a `no-upstream-internals` error for that line and exits non-zero

#### Scenario: Plugin SDK import
- **WHEN** a file under `server/` or `packages/` imports from `openclaw/plugin-sdk/plugin-entry`
- **THEN** `pnpm jagentchill:lint` fails with rule `no-plugin-sdk`, because JAgentChill is not an OpenClaw plugin

#### Scenario: Gateway client in a client package
- **WHEN** `apps/app/package.json` adds `@openclaw/gateway-client`
- **THEN** `pnpm jagentchill:lint` fails with `only the server can depend on the gateway client`

### Requirement: Gateway surface feasibility record
`docs/research/openclaw-agent-capabilities.md` and `docs/decisions/0002-own-server-gateway-sidecar.md` SHALL be the record of what the pinned OpenClaw tag provides to an external client that supervises it, each surface listed with its Gateway method, event or configuration key, its source path and its verdict. Every OpenClaw surface the product depends on SHALL have one contract test in `diagnostics-quality.Gateway contract tests` that exercises it on the pinned tag: starting the Gateway as a child with its own state directory, a loopback bind and a server-generated token; exit code 78 for an invalid configuration; the `shutdown` event before close code 1012; `connect` with `@openclaw/gateway-client` on protocol 4, token plus device identity, granting `operator.read`, `operator.write`, `operator.admin` and `operator.approvals` without a manual pairing step; `config.get` and `config.patch { raw, baseHash }` on a running Gateway, with the `config.changed` event; every method of `CORE_METHODS`, including one session method and one method needing the administrator scope; a turn started with `sessions.create` and `chat.send` whose `agent`, `session.message`, `session.tool` and `chat` events arrive on the link; `connect` declaring the client capabilities `approvals`, `exec-approvals` and `plugin-approvals`, without which the Gateway denies every approval request itself and emits no event; approval events on the link (`plugin.approval.requested`, which is how the native tool approvals of the Claude Code runtime arrive, and `exec.approval.requested`) answered with `approval.resolve { id, kind, decision }`, and question events answered with `question.resolve`; `exec.approvals.get` and `exec.approvals.set { file, baseHash }` for the host-command approval defaults; `sessions.create` with an explicit `permissionMode`, a session without one running host commands unasked; `mcp.servers` with a Streamable HTTP entry, MCP discovery, and a tool call in a real turn whose `agent` tool events (`stream: "item"`, `kind: "tool"`) carry `sessionKey`, `toolCallId` and `name`; a per-agent `tools.allow` policy that hides a tool; the exec approval policy `security: "allowlist"`, `ask: "on-miss"`, `askFallback: "deny"` with an empty allowlist, under which every host command of a `guarded` session raises an approval request; a file SecretRef resolved by one of OpenClaw's bundled provider plugins; the Gateway's device-pairing list (read only, to report foreign pending requests); and a sub-agent run on an existing session key, including the busy-session case of spike S18. A surface whose test fails after the pin was raised blocks the upgrade, and the owning requirement's stated fallback (`server-api.OpenClaw surface dependencies and fallbacks`) is the only permitted response other than waiting for a newer OpenClaw. The spikes of `diagnostics-quality.Gating spikes` map to this record as follows: S7 to S17 and S21 to S27 each verify surfaces listed here (S1 to S5 are withdrawn); S18 verifies the sub-agent case above; S6, S19 and the client part of S20 verify product-owned code (the mobile engine view, the workflow canvas renderer in `packages/archify`, the embedded tailnet nodes), and the Gateway part of S20 verifies the product listeners in front of the server. No required behaviour SHALL rest on a surface absent from the record. [NEW]

#### Scenario: Record matches the pin
- **WHEN** the documentation check runs
- **THEN** both files name the tag and commit of `gateway/openclaw.lock.json`

#### Scenario: Surface removed in a newer OpenClaw
- **WHEN** a newer tag no longer accepts `config.patch` with `baseHash` from an operator client
- **THEN** the contract test `surface-config-patch` fails at step 10 of the upgrade procedure and names the method

#### Scenario: Spike outcome needs no Gateway edit
- **WHEN** the tree is built with S12 (for one method) and S18 recorded as `fail`
- **THEN** the upstream guard passes, the admin proxy of that method answers `UNSUPPORTED_FEATURE` with the host command, and workflow reports use the session outbox

#### Scenario: Undocumented surface used
- **WHEN** server code sends a Gateway method that is neither in `CORE_METHODS` nor in the record's dependency list
- **THEN** `pnpm jagentchill:lint` fails with rule `gateway-surface-allowlist`

### Requirement: Toolchain versions
The repository SHALL require Node `>=24.16.0 <25 || >=26.1.0`, pnpm major version 12 selected by Corepack from the root `packageManager` field, Rust `1.90.0` with target `wasm32-unknown-unknown` pinned by `packages/render-wasm/rust-toolchain.toml`, a `wasm-bindgen-cli` version equal to the `wasm-bindgen` crate version in `Cargo.lock`, Xcode 26.0 or newer for iOS builds, Android `compileSdk` 35 or newer with `minSdk` 31 and JDK 17 for Android builds, one pinned Electron version (shared by the desktop app and the render host), one pinned Go toolchain and `gomobile` version for the ingress helper, proxy helper and mobile module, and FFmpeg 6.1 or newer on any host that runs host-side media jobs. The Gateway is built and run with the Node version its pinned tag requires, which the range above SHALL satisfy. `docs/TOOLCHAIN.md` SHALL list these versions, the minimum Android System WebView Chromium version (working value 121, final value set by spike S6), the pinned OpenClaw tag, the commit of the vendored repository-harness checkout and the upstream commit the archify fork is based on, and — as not subject to the Node rule — the EAS build image, and the one Node runtime bundled in the distributions, which runs both the server and the Gateway. `pnpm jagentchill:doctor` SHALL check each tool present on the machine and print one line per tool with `ok`, `missing` or `version mismatch (found X, need Y)`. [NEW]

#### Scenario: All tools present
- **WHEN** `pnpm jagentchill:doctor` runs on a machine with every required tool at a satisfying version
- **THEN** every line ends with `ok` and the exit status is 0

#### Scenario: Unsupported Node version
- **WHEN** the command runs under Node 22.19
- **THEN** the Node line reads `version mismatch (found 22.19.x, need >=24.16.0 <25 || >=26.1.0)` and the exit status is non-zero

#### Scenario: Mobile toolchain absent on a web-only machine
- **WHEN** Xcode and the Android SDK are absent and the command is run with `--targets web,desktop`
- **THEN** the Xcode and Android lines read `skipped (target not selected)` and the exit status is 0

### Requirement: Build and development commands
The root workspace SHALL expose these scripts as `scripts["jagentchill:*"]` entries of the root `package.json`, each implemented under `scripts/`: `jagentchill:gateway:pull` and `jagentchill:gateway:build` (`platform-skeleton.Gateway build and placement`), `jagentchill:build` (builds the wasm crate, all `packages/*`, the server, the tailnet bridge and proxy helper binaries, the web export and the desktop app in dependency order, and the Gateway when its build output is absent or stale, after running the deterministic content scripts `scripts/bake-luts` and `scripts/render-sound-pack`, whose outputs are compared with the committed files and fail the build when they differ), `jagentchill:dev` (starts JAgentChill Server on port 18910 with data directory `.dev/server-data` — the server supervises the Gateway on port 18911 with state directory `.dev/server-data/gateway-state` — plus the Expo web dev server), `jagentchill:dev:desktop`, `jagentchill:dev:ios`, `jagentchill:dev:android`, `jagentchill:typecheck`, `jagentchill:lint`, `jagentchill:test` (with the layer sub-commands of `diagnostics-quality.Test taxonomy`), `jagentchill:test:gateway-contract`, `jagentchill:verify`, `jagentchill:doctor`, `jagentchill:check:upstream`, `jagentchill:check:ci`, `jagentchill:check:coverage`, `jagentchill:check:stories`, `jagentchill:check:design`, `jagentchill:check:contrast`, `jagentchill:harness:normalise` and `jagentchill:upstream:sync`. `jagentchill:build` on an unchanged tree SHALL be a cache hit that finishes in 60 seconds or less on the CI runner class used by the job `jagentchill-build`. [NEW]

#### Scenario: Cold build from a fresh clone
- **WHEN** a contributor runs `pnpm install && pnpm jagentchill:gateway:pull && pnpm jagentchill:build` on a fresh clone with the required toolchain
- **THEN** the commands exit 0
- **AND** `packages/render-wasm/pkg/` contains a `.wasm` file and the web export directory contains `index.html`

#### Scenario: Cached rebuild
- **WHEN** `pnpm jagentchill:build` is run a second time on the unchanged tree on the `jagentchill-build` runner class
- **THEN** it finishes in 60 seconds or less and rebuilds no package

#### Scenario: Development host does not touch user state
- **WHEN** `pnpm jagentchill:dev` is running
- **THEN** the server's data directory is `.dev/server-data` inside the repository and the Gateway's state directory is inside it
- **AND** no file under `~/.openclaw` or under the per-user JAgentChill data directory is created or modified

#### Scenario: Port in use
- **WHEN** port 18910 is already bound and `pnpm jagentchill:dev` starts
- **THEN** it exits non-zero with `port 18910 is in use` and does not start the Expo server

### Requirement: Package dependency boundaries
Package dependencies SHALL follow this direction only: `protocol` depends on no other JAgentChill package; `editor-core` depends only on `protocol`; `render` depends on `editor-core`, `protocol` and `render-wasm`; `media`, `workflow` and `film` depend on `protocol` and `editor-core`; `provider-kit` and `content` depend only on `protocol`; `ui` depends on `protocol` and on types and selectors of `editor-core`; `archify` depends on `workflow`, `ui` (tokens only) and `protocol`; apps and the server depend on packages; no package depends on an app or on the server, no app depends on the server, the server is the only workspace package that depends on `@openclaw/gateway-client`, and `render` does not depend on `ui`. `editor-core` MUST NOT reference `window`, `document`, `navigator`, Node built-in modules or React. `packages/workflow` and `packages/archify` MUST NOT depend, directly or transitively through a JAgentChill package, on a third-party graph, diagram or node-editor library (denylist at least: `reactflow`, `@xyflow/*`, `dagre`, `@dagrejs/*`, `elkjs`, `cytoscape*`, `d3-dag`, `graphlib`, `mermaid`, `jointjs`, `@antv/x6`, `@antv/g6`, `rete`, `litegraph*`, `gojs`). The geometry, edge routing and layout code of the canvas is the fork's own code and the product's own code; the denylist applies in every outcome of spike S19, including an owner-approved product renderer (a drawing library is not a graph library and is admitted only with that decision record). The lint step SHALL enforce all of these rules. [NEW]

#### Scenario: Editor core uses a DOM global
- **WHEN** a file in `packages/editor-core/src` references `document.createElement`
- **THEN** `pnpm jagentchill:lint` fails with rule `editor-core-no-platform`

#### Scenario: Reverse dependency
- **WHEN** `packages/protocol/package.json` adds a dependency on `@jagentchill/editor-core`
- **THEN** `pnpm jagentchill:lint` fails with `forbidden dependency direction: protocol -> editor-core`

#### Scenario: Render depends on UI
- **WHEN** `packages/render/package.json` adds a dependency on `@jagentchill/ui`
- **THEN** `pnpm jagentchill:lint` fails with `forbidden dependency direction: render -> ui`

#### Scenario: Graph library in the canvas package
- **WHEN** `packages/archify/package.json` adds `elkjs`
- **THEN** `pnpm jagentchill:lint` fails with `third-party graph library not allowed: elkjs`

### Requirement: Gateway run profile
Every Gateway launch is made by JAgentChill Server (`server-api.Gateway supervision and lifecycle`), whoever started the server — the desktop app on macOS, Windows and Linux, `pnpm jagentchill:dev`, the headless image entry point — and SHALL set the environment variables `OPENCLAW_SKIP_CHANNELS=1`, `OPENCLAW_DISABLE_BONJOUR=1`, `OPENCLAW_NO_RESPAWN=1` and `OPENCLAW_EXEC_SHELL_SNAPSHOT=0`, and the Gateway configuration that the server writes SHALL satisfy this run profile (design D2, D7, D25), which only ever restricts: (1) `plugins.allow` contains only OpenClaw's own plugins: the model and media provider plugins an admin enabled, the runtime plugins an admin enabled (`agent-runtimes.Admin proxy and Gateway reuse`) and the configured memory slot plugin; it never names a JAgentChill plugin, because none exists; no messaging channel plugin is started; `device-pair` stays allowed as in design D2 because the host's own `openclaw devices` commands use it, although the product pairs no device with the core (`server-api.Native Gateway port isolation`); `canvas` is NOT allowed (decision A2 — no capability needs OpenClaw's canvas host, and agent-written documents must not be served from the web app's origin, `server-api.Web origin isolation`). (2) `gateway.auth.mode` is `"token"` with the 32-byte random token generated by the server per install, stored owner-only, never sent to any client (`server-api.Gateway secrets`); `gateway.auth.allowTailscale` is `false`; `gateway.auth.rateLimit.exemptLoopback` is `false`. (3) `gateway.nodes.pairing.autoApproveLocal` is `false`. (4) The OpenAI-compatible HTTP endpoints are disabled. (5) The default agent is a creative agent, and every `agents.entries.jagentchill-*` creative persona carries the tool policy of `security-privacy.Agent tool sandbox`; `tools.elevated` is disabled. (6) `tools.sessions.visibility` and `tools.agentToAgent` equal the values mapped from the stored preset of `multi-agent-orchestration.Who-can-call-whom policy presets`, whose initial value restricts both to the caller's own agent tree; the effective value is `all` only while an admin selected the preset `all` through the confirmed and audited change of `security-privacy.Workspace agent safeguards`, and any other value found in the configuration is reset to the mapped one. (7) `gateway.terminal.enabled` is always `false`, whether the product setting `terminal.enabled` is on or off: the product terminal is the server's own PTY worker (`workspaces-terminal.Terminal backend and worker process`) and no path of the product uses OpenClaw's terminal, `terminal.*` methods or `sessions.catalog.startTerminal`; the core `terminal` tool and `exec` with `pty: true` are denied in every agent entry the server writes (`security-privacy.Agent tool sandbox`); `gateway.cliAgents.enabled` is `true` exactly while at least one CLI runtime is enabled (`agent-runtimes`), independently of the terminal, because CLI sessions and their import need it. (15) `skills.load.extraDirs` holds exactly one directory, the server's own read-only skills directory (`skills.Bundled JAgentChill skills`), and nothing of JAgentChill is copied into the Gateway's skill roots. (16) Besides the creative personas the server writes one service agent, `jagentchill-media`, whose tool allow-list is exactly OpenClaw's media tools `image_generate`, `video_generate` and `music_generate` and whose sessions only the server creates (`permissionMode: "read-only"`, never listed to a device); it is the only place `tools.invoke` of those tools runs for builtin generation providers (`generation-providers.Provider registry by capability type`, spike S28). (17) No key under `plugins.entries.jagentchill` exists; per-agent and per-session tool policy (`agents.entries.<agentId>.tools.allow | deny`, the tool overrides of `sessions.patch`) is written by the server and by nothing else. (8) Upstream telemetry options are disabled. (9) The Gateway's list of allowed browser origins is empty: no browser and no device connects to the Gateway, and the origins of the app are admitted by the server only (`server-api.HTTP request limits and browser access`). (10) `mcp.servers` contains the entry `jagentchill` — the server's agent tool endpoint (`server-api.Agent tool endpoint and session binding`) — and no entry that the server did not write. (11) The Gateway binds loopback only (`gateway.bind` loopback, no custom bind host, no TLS listener of its own): the server passes `--bind loopback`, owns this key, and no Network access level changes it. (12) `gateway.controlUi.enabled` is `false`. (13) `gateway.tailscale.mode` is `"off"`. (14) `gateway.trustedProxies` is empty: no proxy stands in front of the Gateway, and the product listeners forward only to the server (`server-api.Product listeners and path restriction`). (18) Host commands are never run unasked and never refused without a person having been asked: `tools.exec` is `{ host: "gateway", security: "allowlist", ask: "on-miss" }`, and the Gateway's exec-approvals file, written over the link with `exec.approvals.get` and `exec.approvals.set { file, baseHash }`, has `defaults { security: "allowlist", ask: "on-miss", askFallback: "deny" }` and an allowlist that the server keeps empty — so every host command of a `guarded` session misses the allowlist and raises an approval request on the server's link, and a request nobody can answer is denied. Measured (`docs/decisions/0002-own-server-gateway-sidecar.md` rows 13, 15 and 16): with `ask` off a `guarded` session's command is refused without any request, and without the link's approval capabilities (`server-api.Gateway link`) the request is denied by the Gateway unseen. An allowlist entry found in the file, `ask` other than `on-miss` or `always`, or `askFallback` other than `deny` is a violation that `ensureRunProfile()` resets. Reachability from a network is provided only by the product listeners, which the server starts according to its own configuration keys `tailnet.enabled` and `lan.enabled`. [NEW]

#### Scenario: Channels are not started
- **WHEN** the Gateway is launched by `pnpm jagentchill:dev` or by the desktop app
- **THEN** the Gateway log contains no channel startup entry
- **AND** a `plugins` listing shows no channel plugin in state `active`

#### Scenario: Plugin outside the allow-list
- **WHEN** the Gateway configuration has an OpenClaw plugin enabled that is not in the allow-list above, for example `canvas`
- **THEN** that plugin is not loaded and `jagentchill doctor` reports it as `blocked by plugins.allow`

#### Scenario: Default agent is creative
- **WHEN** a session is created on a profiled Gateway without naming an agent
- **THEN** its agent id starts with `jagentchill-` and its effective tools contain no command or core file tool

#### Scenario: Session visibility
- **WHEN** an agent in tree A calls a session-listing tool
- **THEN** no session of tree B is returned

#### Scenario: Shared token stays on the host
- **WHEN** all traffic between a paired device and the Gateway is captured through pairing and one hour of use
- **THEN** the shared Gateway token appears in no frame or request

#### Scenario: Gateway stays on loopback at every level
- **WHEN** the Network access level is changed to "Tailnet" and then to "Local network (encrypted)" on a macOS, a Windows and a Linux host
- **THEN** on each the Gateway's listening sockets are loopback only, `gateway.trustedProxies` is empty, and the server's own listener is loopback only

#### Scenario: CLI agents without the terminal
- **WHEN** the terminal is off and one CLI runtime is enabled
- **THEN** `gateway.terminal.enabled` is `false` and `gateway.cliAgents.enabled` is `true`

#### Scenario: Product terminal on, Gateway terminal still off
- **WHEN** an admin turns the product terminal on and opens a terminal tab
- **THEN** the Gateway configuration still reads `gateway.terminal.enabled: false`, and the tab runs in the server's own PTY worker

#### Scenario: Skills directory and media service agent
- **WHEN** the Gateway configuration written by the server on a fresh install is inspected
- **THEN** `skills.load.extraDirs` has one entry, the server's skills directory, and the agent `jagentchill-media` allows exactly `image_generate`, `video_generate` and `music_generate`

#### Scenario: Host commands ask instead of running or failing silently
- **WHEN** the server has linked to a fresh Gateway and a `guarded` workspace session wants to run a host command
- **THEN** `tools.exec` reads `security: "allowlist"`, `ask: "on-miss"`, the exec-approvals defaults read `askFallback: "deny"` with an empty allowlist, and the command raises an approval request on the server's link instead of running or being refused unseen

#### Scenario: Allowlist entry added by hand
- **WHEN** an operator adds a command pattern to the Gateway's exec allowlist
- **THEN** the next `ensureRunProfile()` removes it, health lists `run_profile_violation` until then, and the doctor names the entry

#### Scenario: The only JAgentChill entry is the tool endpoint
- **WHEN** the Gateway configuration written by the server is inspected
- **THEN** `plugins.allow`, `plugins.entries` and `plugins.load` name nothing of JAgentChill, and `mcp.servers.jagentchill` points at `http://127.0.0.1:<server.port>/agent-tools/mcp`

### Requirement: Run profile application
The server SHALL own an idempotent function `ensureRunProfile()` that writes exactly the configuration keys of `platform-skeleton.Gateway run profile` (items 1 to 18): into the Gateway configuration file before every Gateway start, and on a running Gateway over the gateway link with `config.get` followed by `config.patch { raw, baseHash }` (a stale `baseHash` is re-read and retried, never forced). It is executed before every start of the Gateway child, every time the gateway link becomes ready, on every `config.changed` event of the Gateway, and by `jagentchill doctor --fix`. It SHALL only tighten: it never removes a deny, never adds an allow outside the listed sets, never touches a key outside the profile (bind is inside it: item 11 forces loopback), and never lowers a stricter value an operator set. When a key that needs a Gateway restart changed, the server SHALL restart the Gateway child itself as soon as no agent turn is running, and until then report `restartRequired: true` in health and in the doctor. When the profile cannot be applied or a required value is overridden afterwards, health SHALL list `run_profile_violation` and the doctor SHALL name each violating key; pairing, admin proxies and the product listeners SHALL be refused while `gateway.auth.mode`, `autoApproveLocal`, the Gateway bind, `gateway.trustedProxies` or `gateway.auth.rateLimit.exemptLoopback` violates the profile; and while the host-command approval policy of item 18 is not in effect — it is written over the link (`config.patch` for `tools.exec`, `exec.approvals.set` for the approvals file) each time the link becomes ready, before the server reports the Gateway `ready` — the relay starts no turn in a workspace-class session and answers `GATEWAY_UNAVAILABLE` with `details.reason` `starting`. Configuration needed by other capabilities (persona agents, per-agent `tools.allow` and approval policy, ORC mapping to `agents.entries.*`, endpoint projection to `models.providers.*`, terminal switches) is written by the same mechanism by their owners and is subject to the same only-tighten rule for the profile keys. The environment variables are set by the server when it spawns the Gateway; the doctor checks them. [NEW]

#### Scenario: First start
- **WHEN** the server starts the Gateway on an empty state directory
- **THEN** after `ensureRunProfile()` the configuration satisfies items 1 to 18 and a second call changes nothing

#### Scenario: Operator loosens a key
- **WHEN** an operator sets `gateway.nodes.pairing.autoApproveLocal` to `true` in the Gateway configuration
- **THEN** the next `ensureRunProfile()` — at the `config.changed` event or before the next start — sets it back to `false`, and until it takes effect health lists `run_profile_violation` and enrolment calls are refused

#### Scenario: Stricter operator value kept
- **WHEN** an operator removed a provider plugin from `plugins.allow`
- **THEN** `ensureRunProfile()` does not add it back

#### Scenario: Doctor fix
- **WHEN** `jagentchill doctor --fix` runs on a host whose Gateway's OpenAI-compatible endpoints were enabled by hand
- **THEN** they are disabled and the command reports the changed key

#### Scenario: Concurrent configuration edit
- **WHEN** `config.patch` is refused because the configuration changed since `config.get`
- **THEN** the server reads the configuration again and patches with the new `baseHash`, and after 5 refusals reports `run_profile_violation` instead of overwriting

#### Scenario: Restart deferred while a turn runs
- **WHEN** a profile key that needs a Gateway restart is corrected while an agent turn is running
- **THEN** health carries `restartRequired: true`, the turn finishes, and the server then restarts the Gateway child

### Requirement: Harness installation
The repository SHALL have the repository-harness core installed from the vendored checkout at the commit recorded in `docs/TOOLCHAIN.md` (`.refs/repository-harness/scripts/install-harness.sh --directory "$PWD" --merge --yes`), followed by the scripted post-step `pnpm jagentchill:harness:normalise`, which SHALL keep the harness agent block in the root `AGENTS.md`, keep all JAgentChill agent rules in `docs/AGENTS.jagentchill.md`, verify that `scripts/bin/harness` and `scripts/bin/harness.exe` are ignored by the root `.gitignore`, verify that the harness wrote nothing under `gateway/`, and write the root `CLAUDE.md` containing the two imports `@AGENTS.md` and `@docs/AGENTS.jagentchill.md`. The same post-step SHALL run after every `harness update`. The installation yields `docs/WORKFLOW.md`, `docs/README.md`, `docs/product/`, `docs/plans/active/`, `docs/plans/completed/`, `docs/decisions/`, `docs/templates/`, `docs/patterns/encoding-invariants.md`, the harness skills under `.agents/skills/harness-*`, `.harness-core/manifest.json` and `scripts/bin/harness`; `.harness-core/` SHALL be committed. `docs/templates/story.md`, `docs/templates/decision.md` and `docs/stories/README.md` are JAgentChill-authored files, and `docs/decisions/0001-story-openspec-workflow.md` records the adoption of `platform-skeleton.User story convention`. The harness ships `docs/product/` empty for the consumer to fill, so this repository SHALL fill it: one page per capability group — `editor.md`, `agents.md`, `workflows.md`, `film.md`, `connectivity.md`, `platform.md` — each derived from `proposal.md` with the headings `## Purpose`, `## Users and journeys`, `## Capabilities` (the capability names of the group, each resolving to a spec directory), `## Platforms` (web; desktop macOS, Windows, Linux; mobile iOS, Android — what differs on each) and `## Non-goals`; `pnpm jagentchill:check:stories` fails when a page is missing, a heading is missing, a capability of the change appears on no page, or a named capability has no spec. `docs/decisions/0002-harness-scope.md` SHALL record the owner's answer to the open question of `docs/research/repository-harness-reference.md` section 10 (the current harness core plus this repository's story convention, or the legacy harness); until it carries `status: owner-approved` the policy job reports `warn harness scope undecided` and release builds fail. [NEW]

#### Scenario: Harness is healthy after normalisation
- **WHEN** `scripts/bin/harness doctor --json` is run after `pnpm jagentchill:harness:normalise`
- **THEN** it exits 0 and reports no provenance, path or transaction error

#### Scenario: Product pages present
- **WHEN** `pnpm jagentchill:check:stories` runs after installation
- **THEN** the six pages of `docs/product/` exist with their five headings and every capability of the change is named on exactly one page

#### Scenario: Gateway checkout untouched by the harness
- **WHEN** the harness install and the post-step have completed
- **THEN** `git -C gateway/openclaw status --porcelain` is empty
- **AND** `CLAUDE.md` contains the two import lines `@AGENTS.md` and `@docs/AGENTS.jagentchill.md`

#### Scenario: Harness update
- **WHEN** `scripts/bin/harness update` rewrites its block in `AGENTS.md`
- **THEN** running the normalise step leaves the harness block in `AGENTS.md`, leaves `docs/AGENTS.jagentchill.md` unchanged, and the upstream guard passes

#### Scenario: Harness update with local overlap
- **WHEN** `scripts/bin/harness update` reports an overlapping change in `docs/WORKFLOW.md`
- **THEN** the update stops with staged BASE, LOCAL and UPSTREAM copies and the tree is left unchanged until `harness update --continue` or `--abort` is run

### Requirement: User story convention
User stories SHALL be files named `docs/stories/US-###-<slug>.md`, where `###` is a zero-padded sequence number unique in the repository starting at `001` and `<slug>` is lowercase kebab-case of 3 to 60 characters. Each story SHALL be created from `docs/templates/story.md` and SHALL contain these headings in order: `# US-### <Title>`, `## Status` (one of `planned`, `in_progress`, `blocked`, `implemented`, `changed`, `retired`), `## Capability`, `## Requirements` (1 to 15 references of the form `<capability>.<Requirement name>` that resolve to a requirement in `openspec/changes/*/specs/` or `openspec/specs/`), `## Acceptance Criteria`, `## Validation`, `## Verify command`, `## Evidence`. A story describes one user-visible flow; every capability of the change SHALL have at least one story, and every requirement SHALL be referenced by at least one story, whatever its provenance tag. `docs/stories/README.md` SHALL hold an index table with one row per story (id, title, capability, status) and SHALL contain the full initial set before the first implementation task starts. The initial set SHALL contain at least one story per end-to-end journey per platform family (web; desktop — verified on macOS, Windows and Linux; mobile — verified on iOS and Android): first run to export and share; pair a second device, edit there, return, revoke; browser pairing on the same computer and over tailnet HTTPS; chat with a CLI runtime and a provider switch; one prompt to video; script by hand and by agent with approval; drawing and running a workflow; team run and free agents; film pipeline to export; ORC with a proxy endpoint and usage; admin workspace and terminal from a phone; unattended automation with export; and the failure paths (host down, device offline, storage full, no GPU, provider quota, tailnet sign-in expired). A story names the platforms its evidence must cover under `## Validation`. A story SHALL NOT be set to `implemented` while its `## Evidence` section is empty. [NEW]

#### Scenario: Valid story passes the check
- **WHEN** `pnpm jagentchill:check:stories` runs and every story file has the required headings, resolvable requirement references and an index row
- **THEN** the command exits 0

#### Scenario: Story references a missing requirement
- **WHEN** `US-014-pair-mobile.md` lists a requirement name that exists in no spec
- **THEN** the command fails with `US-014: unresolved requirement reference`

#### Scenario: Capability without a story
- **WHEN** no story names the capability `script-studio`
- **THEN** the command fails with `capability without story: script-studio`

#### Scenario: Too many requirements
- **WHEN** a story lists 16 requirement references
- **THEN** the command fails with `US-###: more than 15 requirements`

#### Scenario: Implemented without evidence
- **WHEN** a story has status `implemented` and an empty `## Evidence` section
- **THEN** the command fails with `US-###: implemented story has no evidence`

#### Scenario: Duplicate number
- **WHEN** two files share the prefix `US-021-`
- **THEN** the command fails and names both files

### Requirement: Story to change workflow
Work on a capability SHALL follow this sequence: the change has a `tasks.md` (required: `pnpm jagentchill:check:coverage` fails without it) that contains, before any capability group, the group "Gating spikes" with one task per open spike of S6 to S28 in dependency order (S20, S21 and S23 before any connection or agent task; S6 before mobile render tasks; S19 before canvas tasks) and the group "Design reference" for `platform-skeleton.UI design reference file`, followed by one group per capability; every task states the requirements it satisfies, the story id, the verify command, and the platforms on which evidence is required (`web`, `macos`, `windows`, `linux`, `ios`, `android`), and a task of a platform-dependent requirement that omits a platform of its family fails the coverage gate; a story exists with status `planned`; the OpenSpec change holding the referenced requirements validates with `openspec validate <change> --strict`; the story moves to `in_progress` when implementation of a task that references one of its requirements begins; the story's `## Verify command` is executed and its output or artifact paths are recorded under `## Evidence`; only then is the story set to `implemented`. A decision that changes externally observable policy, security behaviour or the wire protocol SHALL be recorded as `docs/decisions/NNNN-<slug>.md` from `docs/templates/decision.md` before the corresponding code merges, and every gating spike result (S6 to S27 of `diagnostics-quality.Gating spikes`; S1 to S5 are withdrawn) is such a record. [NEW]

#### Scenario: Protocol change without a decision record
- **WHEN** a pull request changes a file under `packages/protocol/src` that alters an existing schema and adds no file under `docs/decisions/`
- **THEN** the CI job `jagentchill-policy` fails with `protocol change requires a decision record`

#### Scenario: Additive schema with a decision record
- **WHEN** the same pull request also adds `docs/decisions/0007-add-sync-comment-field.md`
- **THEN** the `jagentchill-policy` job passes

#### Scenario: Task without platforms
- **WHEN** a task for a desktop requirement lists evidence platforms `macos` only
- **THEN** `pnpm jagentchill:check:coverage` fails with `task lacks platforms: windows, linux`

#### Scenario: Change without tasks
- **WHEN** the active change has no `tasks.md`
- **THEN** `pnpm jagentchill:check:coverage` fails with `tasks.md missing`

### Requirement: UI design reference file
The repository SHALL contain the normative UI design file `docs/design/jagentchill-ui.html` (decision B10, design D14), whose content — one frame per route and state, built from the tokens — is defined by capability `design-system`; this requirement makes it a required artifact of the skeleton and gates it. The file SHALL be a self-contained static HTML file that makes no network request (fonts, images and scripts inline or under `docs/design/assets/`), SHALL use no Devin or CapCut name, logo or asset, and SHALL carry a machine-readable index `<script type="application/json" id="frames">` listing every frame as `{ frameId, route, formFactor: "desktop" | "tablet" | "phone", theme: "light" | "dark", state, requirement }`. `pnpm jagentchill:check:design` SHALL fail when: the file is missing; a route of `app-shell-navigation.Route map` has no frame for a form factor on which the route exists, in light and in dark; a list or collection route lacks any of the states `empty`, `loading`, `error`, `offline`, `requires-host`; a colour, size, radius, type or motion literal in the file is not a value of the generated token file of capability `design-system`; a frame's `requirement` does not resolve to a requirement of this change; the file performs a network request when loaded in the CI browser; or the file's embedded token-file hash differs from the current generated token file (the design file is regenerated whenever tokens change). The check is a step of `diagnostics-quality.Verify gate` and of the job `jagentchill-design`. The file covers web, desktop (macOS, Windows and Linux differences such as the app-drawn menu button of the frameless window on Windows and Linux) and mobile (iOS and Android differences such as system bars and back affordance); a platform-specific frame names its platform in `state`. [NEW]

#### Scenario: Route without a frame
- **WHEN** a route is added to the route map and no frame names it
- **THEN** `pnpm jagentchill:check:design` fails with `route without design frame: <route> (<form factor>, <theme>)`

#### Scenario: Literal outside the tokens
- **WHEN** a frame uses the colour `#123456`, which is not a token value
- **THEN** the check fails with `non-token literal` naming the frame

#### Scenario: Stale against the tokens
- **WHEN** a token value changes and the design file is not regenerated
- **THEN** the check fails with `design file is out of date with tokens`

#### Scenario: Offline file
- **WHEN** the file is opened in the CI browser with the network blocked
- **THEN** every frame renders and no request is attempted

### Requirement: Licence and third-party notices
OpenClaw's `LICENSE` and `THIRD_PARTY_NOTICES.md` SHALL be shipped unmodified with every distribution that contains the Gateway, beside the Gateway build. The repository's own `THIRD_PARTY_NOTICES.md` SHALL contain the full MIT notices for OpenClaw, OpenCut classic and archify (forked at a recorded upstream commit into `packages/archify/`, with its embedded font's OFL notice), the LGPL notice and source-offer text for each LGPL component, and one entry (name, version, licence identifier, copyright line) for every additional third-party dependency shipped in a JAgentChill client or server build. The repository SHALL contain no source code or prompt text copied from waoowaoo and no source code copied from JAgentDesk (AGPL-3.0+). A CI licence check (`jagentchill-licences`) SHALL fail when a shipped dependency has no notice entry or a licence identifier outside the allow-list `MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, MPL-2.0, OFL-1.1, UFL-1.0 (fonts only), Bitstream-Vera (fonts only; the DejaVu family), Unicode-3.0 (data only; CLDR annotation names), CC0-1.0, Unlicense, Zlib, BlueOak-1.0.0`, with one exception list: `LGPL-2.1+` is admitted only for the named, separately loaded and replaceable components `ffmpeg`, `ffprobe` and the MP3 encoder wasm module; no other LGPL or GPL component (including audio time-stretch libraries) is admitted. The FFmpeg binary JAgentChill distributes SHALL be an LGPL build (no `--enable-gpl`, no `--enable-nonfree`), checked from its `-version` output at build time. [NEW]

#### Scenario: New dependency without a notice
- **WHEN** a pull request adds a runtime dependency to `apps/app` and no matching entry to `THIRD_PARTY_NOTICES.md`
- **THEN** the CI job `jagentchill-licences` fails and names the dependency

#### Scenario: Copyleft dependency
- **WHEN** a runtime dependency with licence `GPL-3.0-only` is added
- **THEN** the job fails with `licence not allowed: GPL-3.0-only`

#### Scenario: LGPL outside the exception list
- **WHEN** an LGPL audio library other than the three named components is added
- **THEN** the job fails with `LGPL component not in exception list`

#### Scenario: Font under the Bitstream Vera licence
- **WHEN** DejaVu Sans is bundled as the substitute for Verdana with licence identifier `Bitstream-Vera` and a notice entry
- **THEN** the job `jagentchill-licences` passes, and the same identifier on a JavaScript dependency fails with `licence not allowed for this component type`

#### Scenario: Bundled FFmpeg is a GPL build
- **WHEN** the FFmpeg binary staged for packaging reports `--enable-gpl`
- **THEN** the packaging job fails before any artifact is produced

### Requirement: Bundled asset provenance
Every bundled non-code asset set (fonts and font atlas, emoji glyphs and their annotation names, flag and other stickers, shapes, gradient presets, baked LUTs, the bundled sound pack of music and sound effects, the effect and filter sample image and the two transition sample frames, template demo media, sample media, model files referenced by manifest, country data, test fixtures) SHALL have a row in `docs/ASSET-PROVENANCE.md` with a path glob, origin URL or "project-authored", licence identifier from the allow-list of `platform-skeleton.Licence and third-party notices` (CC0-1.0 or project-authored for the starter library), and copyright line. The job `jagentchill-licences` SHALL fail for any file under `packages/content/` or under an assets directory of another JAgentChill package that no row matches. An OpenCut classic asset whose origin and licence cannot be established SHALL NOT be copied; its replacement is authored or sourced under an allow-listed licence by the owning capability. Assets that a script produces (`scripts/bake-luts`, `scripts/render-sound-pack`) are recorded as "project-authored" with the script path as origin, and the job re-runs the script and fails when the committed output differs. Whether the flag set covers every classic country code is a separate check of the same job (`stickers-shapes.Flag stickers`): it fails when a classic code has neither an upstream file nor a project-drawn one. No asset, name or logo of CapCut or Devin SHALL be bundled. [NEW]

#### Scenario: Asset without a row
- **WHEN** a pull request adds `packages/content/stickers/new-pack/` with no matching row
- **THEN** the job fails with `asset without provenance` naming the first unmatched file

#### Scenario: Generated asset drifted
- **WHEN** a committed baked LUT differs from the output of `scripts/bake-luts` on the CI runner
- **THEN** the job fails with `generated asset out of date` naming the file

#### Scenario: Classic flags
- **WHEN** the provenance file is inspected for the flag sticker set
- **THEN** its row names an origin with an allow-listed licence, and no file is byte-identical to a classic flag file of unknown licence

### Requirement: Clean-room prompt authoring
Prompts and agent instructions shipped by the product SHALL be authored from this change's specifications only. They SHALL live in `packages/film/prompts/`, `packages/workflow/prompts/`, `server/prompts/` (script, multi-agent, ORC and persona prompts) and `skills/`, one file per step or skill in English source with a header line `Requirement: <capability>.<Requirement name>` naming the requirement it implements, which the job resolves against the specs. The job `jagentchill-policy` SHALL fail when any such file shares a run of 12 or more consecutive tokens (after case and whitespace normalisation) with any prompt or skill file under `.refs/waoowaoo*/` when those directories are present on the runner, and release builds SHALL require that the check ran with the reference directories present. [NEW]

#### Scenario: Copied sentence
- **WHEN** a prompt file contains a 14-token run identical to a reference prompt file
- **THEN** the job fails with `prompt overlaps reference material` naming both files

#### Scenario: Prompt without a requirement header
- **WHEN** a prompt file lacks the header naming its requirement
- **THEN** the job fails with `prompt without requirement reference`

### Requirement: Dependency admission policy
JAgentChill dependencies SHALL obey the policy of JAgentChill's own workspace, which SHALL be at least as strict as the one OpenClaw applies to itself at the pinned tag: `minimumReleaseAge` of 10080 minutes and `blockExoticSubdeps: true` SHALL be in force in the root `pnpm-workspace.yaml`, no JAgentChill package SHALL be added to `minimumReleaseAgeExclude` (the one admitted exclusion is `@openclaw/gateway-client`, whose version is dictated by the pin), OpenClaw's own `overrides` and lockfile inside `gateway/openclaw/` SHALL NOT be edited, and every JAgentChill workspace package SHALL pin direct runtime dependencies to exact versions. [NEW]

#### Scenario: Dependency published two days ago
- **WHEN** a contributor adds a dependency version published 2 days before the install
- **THEN** `pnpm install` refuses the version and the contributor selects a version at least 7 days old

#### Scenario: Range specifier in a product package
- **WHEN** `packages/media/package.json` declares `"mediabunny": "^1.2.0"`
- **THEN** `pnpm jagentchill:lint` fails with `runtime dependency must be pinned exactly`

### Requirement: Marketing site and hosted backend excluded from the product
JAgentChill SHALL NOT contain a public marketing website, a hosted multi-user backend, a Postgres database or a Redis service. The classic OpenCut pages for landing, blog with RSS, roadmap, contributors, sponsors and brand assets SHALL NOT be ported, and the app's first route SHALL be the product home screen. The classic server concerns are accounted for as follows: feedback is handled by `diagnostics-quality.Local feedback capture`; sound search, health and rate limiting by `server-api.Sound search proxy`, `server-api.Health route` and `server-api.Rate limiting`; account endpoints and user tables are replaced by `device-pairing-signing.Identity model without accounts` and `server-api.Host data store`; changelog by `updates-distribution.Release notes view`; privacy and terms by `security-privacy.In-app privacy and legal notices`; web manifest and crawler directives by `updates-distribution.Web build delivery`; analytics and bot-protection hooks by `security-privacy.No outbound telemetry`. [PORT W-007, W-008, W-010, W-011, W-012, W-013] [NEW]

#### Scenario: No marketing routes in the web build
- **WHEN** the web export is served and the paths `/blog`, `/rss.xml`, `/roadmap`, `/contributors`, `/sponsors` and `/brand` are requested
- **THEN** each request resolves to the app's not-found screen with a link back to Home
- **AND** no network request is made to a content-management service

#### Scenario: App opens on the product
- **WHEN** a user opens the web build root path, launches the desktop app or launches the mobile app
- **THEN** the first screen shown is the Home screen of capability `app-shell-navigation`, with no landing or sign-up page

#### Scenario: Boot without server environment
- **WHEN** the web build is started with none of the classic environment variables (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `UPSTASH_REDIS_REST_URL`, `MARBLE_WORKSPACE_KEY`) defined
- **THEN** the app boots and the editor is usable

### Requirement: Continuous integration entry points
CI SHALL be defined only in new workflow files named `.github/workflows/jagentchill-*.yml`. The JAgentChill workflows SHALL run on every pull request and on pushes to the default branch, SHALL execute the gates defined in `diagnostics-quality.CI gates`, and SHALL use path filters so that a change touching only `docs/research/` skips build and test jobs but still runs the upstream guard and the checklist coverage gate. [NEW]

#### Scenario: Documentation-only change
- **WHEN** a pull request changes only `docs/research/capcut-parity-benchmark.md`
- **THEN** the jobs `jagentchill-upstream-guard` and `jagentchill-checklist-coverage` run
- **AND** the build, unit, golden-frame and e2e jobs are reported as skipped

#### Scenario: Workflow file outside the naming rule
- **WHEN** a pull request adds `.github/workflows/product-ci.yml`
- **THEN** `pnpm jagentchill:check:ci` and the upstream guard fail because the added path is outside the owned paths
