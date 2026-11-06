# JAgentDesk agent features — behaviour reference (for "like JAgentDesk" requirements)

Source read: `/Users/ngocchanh/Project/private/organisations/hdc/jagentdesk` on 2026-10-05. Companion to `jagentdesk-reference.md` (sections 3, 4, 6), which was written from names and schemas. This file records behaviour confirmed by reading function bodies.

Conventions:

- Path prefixes: `S/` = `packages/server/src/server/`, `A/` = `packages/app/src/`, `P/` = `packages/protocol/src/`, `C/` = `packages/client/src/`. Other paths are relative to the JAgentDesk repo root.
- `file:line` points at the line where the fact was read. Line numbers are from the checkout on the date above.
- **UNVERIFIED** = not confirmed in code (doc-only, name-only, or the body was not read). A consolidated list is in section 11.
- "Doc" after a citation means the fact comes from `docs/` or `public-docs/` and was not re-derived from code.
- JAgentDesk is AGPL. This file describes behaviour and quotes type/schema definitions only.

Corrections to `jagentdesk-reference.md` found while reading:

| Earlier statement | What the code does |
| --- | --- |
| Task Brief is "prepared" (implied model step) | Deterministic text parsing and keyword routing, no model call (`S/orchestration/task-brief.ts:44-106`, `:202-251`). |
| `autoPrepareBrief`, `askWhenAmbiguous` are behaviour switches | Stored and toggled in settings only; no reader found in `packages/server/src` or elsewhere in `packages/app/src` (grep). |
| In-app file editing UNVERIFIED | Present: `fs.file.write.request` with optimistic concurrency (`P/messages.ts:3447-3455`), used by `A/file-pane/pane.tsx:645`, gated on a host feature (`A/file-pane/pane.tsx:456`). |
| Built-in providers are six | Six in the manifest; `cursor`, `kimi`, `kiro`, `traecli` have dedicated ACP adapters selected by provider id when added as `extends: "acp"` (`S/agent/provider-registry.ts:806-818`). |
| Model picker has favourites and recents | Favourites only. No "recent" concept in `A/components/model-browser.tsx`, `A/provider-selection/`, or `A/hooks/use-form-preferences.ts` (grep). |
| A `wait_for_agent` tool exists (per `docs/providers.md:39`) | No tool of that name is registered in `S/agent/tools/jagentdesk-tools.ts`; waiting is done by `background: false` or by finish notifications (section 5.2). |

---

## 1. Providers via CLI

### 1.1 Model

JAgentDesk never calls a model API for chat. The daemon launches an installed agent CLI per provider and adapts it to one `AgentClient` / `AgentSession` interface. Built-in definitions (`P/provider-manifest.ts:171-232`):

| id | Label | Default mode | Enabled by default | Launch (default binary + args) | Transport |
| --- | --- | --- | --- | --- | --- |
| `claude` | Claude | `auto` | yes | `claude` binary handed to the Anthropic Agent SDK as `pathToClaudeCodeExecutable` (`S/agent/providers/claude/agent.ts:3295`) | SDK stream |
| `codex` | Codex | `auto-review` | yes | `codex app-server` (`S/agent/providers/codex-app-server-agent.ts:6991`) | JSON-RPC over stdio |
| `copilot` | Copilot | ACP `#agent` URI | yes | `copilot --acp` (`S/agent/providers/copilot-acp-agent.ts:91`) | ACP over stdio |
| `opencode` | OpenCode | none (`null`) | yes | `opencode serve --port <n>` managed server (`S/agent/providers/opencode/server-manager.ts:319`) | HTTP + SSE |
| `pi` | Pi | none, no modes | yes | `pi --mode rpc` (`S/agent/providers/pi/runtime.ts:91`, `:122`) | JSONL RPC over stdio |
| `omp` | Oh My Pi | `full` | **no** (`enabledByDefault: false`) | `omp --mode rpc-ui` (`S/agent/providers/omp/agent.ts:439`) | JSONL RPC over stdio |

ACP family (`S/agent/provider-registry.ts:771-826`): any config entry with `extends: "acp"` and a `command`. The registry picks an adapter by the entry's id: `cursor` → `CursorACPAgentClient`, `kimi` → `KimiACPAgentClient`, `kiro` → `KiroACPAgentClient`, `traecli` → `TraeACPAgentClient`, anything else → `GenericACPAgentClient`. A `cursor` factory also exists with default command `cursor-agent acp` (`S/agent/provider-registry.ts:209-248`), but `cursor` is not in the manifest, so it only appears once added to config.

One-click ACP catalogue (`A/data/acp-provider-catalog.ts:15-395`): a static, app-bundled list of 38 entries (`agoragentic-acp`, `amp-acp`, `auggie`, `autohand`, `cline`, `codebuddy-code`, `codewhale`, `cortex-code`, `corust-agent`, `crow-cli`, `cursor`, `deepagents`, `devin`, `dimcode`, `dirac`, `factory-droid`, `fast-agent`, `gemini`, `gjc`, `glm-acp-agent`, `goose`, `grok`, `hermes`, `junie`, `kilo`, `kiro`, `kimi`, `minimax-code`, `minion-code`, `mistral-vibe`, `nova`, `poolside`, `qoder`, `qwen-code`, `sigit`, `stakpak`, `traecli`, `vtcode`). Each entry is:

```ts
export interface AcpProviderCatalogEntry {
  id: string; title: string; description: string; version: string;
  iconSvg: string | null; installLink: string;
  command: readonly [string, ...string[]];
  env?: Readonly<Record<string, string>>;
  params?: Readonly<Record<string, unknown>>;
}
```

"Add" writes one config patch — `providers[entry.id] = { extends: "acp", label, description, command, env, params? }` (`A/hooks/use-acp-provider-catalog.ts:11-26`). It does not install the agent binary; the card offers an "install instructions" link (`A/components/provider-catalog-list.tsx:95-102`). Many catalogue commands are `npx -y <pkg>@<version> --acp`, so the first launch downloads the package.

### 1.2 Detection and availability

- Availability = "is the launch binary resolvable". `resolveProviderLaunch` returns the configured `command` (source `override`) or the default binary (`S/agent/provider-launch-config.ts:93-118`); `checkProviderLaunchAvailable` looks it up on `PATH` and, for absolute paths, checks the file is executable (`:67-77`, `:120-132`). Every built-in `isAvailable()` is that check and nothing else (claude `agent.ts:1643`, codex `:7258`, opencode `opencode-agent.ts:1774`, pi `pi/agent.ts:2598`, omp `omp/agent.ts:2423`, generic ACP `generic-acp-agent.ts:96`).
- No credential or login check gates availability. A provider with an installed binary and no login reports `ready` and fails at the first turn (or at catalog fetch if the CLI needs auth to list models).
- Launch environment: daemon `process.env` plus the provider's `env` overlay; four parent-session variables are stripped so a daemon started from inside Claude Code can still launch Claude (`S/agent/provider-launch-config.ts:207-246`).

### 1.3 Provider snapshot (the cache the UI reads)

`ProviderSnapshotEntry` = `{ provider, status: "ready"|"loading"|"error"|"unavailable", enabled, source: "builtin"|"custom", label, description, defaultModeId, models?, modes?, fetchedAt?, error? }` (built in `S/agent/provider-snapshot-manager.ts:913-997`).

Rules confirmed in code:

1. Snapshots are kept per resolved cwd, plus one global scope for requests with no cwd (`:1108-1140`).
2. A read warms only providers whose entry is `loading` (cold) (`:644-650`, `:808-822`). Once an entry is `ready`, `error` or `unavailable` it stays cached until an explicit refresh (`:881-884`). No TTL, no focus refresh.
3. One provider load: `isAvailable()` → if false, `unavailable` (enabled stays true); else `fetchCatalog()` → `ready` with `models`, `modes`, `fetchedAt`; exception → `error` with message (`:945-996`). The whole load runs under a deadline, default 120 000 ms, overridable by `JAGENTDESK_PROVIDER_REFRESH_TIMEOUT_MS`; the timeout error names the pending activity (`:49-70`, `S/agent/provider-refresh-deadline.ts:35-80`).
4. A disabled provider is reported `unavailable` with `enabled: false` and is never probed (`:940-943`, `:763-770`).
5. Repeated model ids in a catalog are de-duplicated, first wins, with a warning (`:966-972`).
6. Config change (`applyMutableProviderConfig`) rebuilds the registry, reconciles every cached snapshot (keeping old `models`/`modes` while marking `loading`), then re-warms `loading` entries (`:493-543`, `:747-783`). Note: `docs/providers.md:77` says config replacement "must not spawn provider processes"; the code calls `warmUp` after publish (`:526-536`). Treat the doc line as stale.
7. Settings refresh clears all scopes and refreshes only global (`docs/providers.md:75`, Doc; method `refreshSettingsSnapshot` at `:268`, body not read).
8. Wire: `get_providers_snapshot_request { cwd? }`, `refresh_providers_snapshot_request { cwd?, providers? }`, `provider_diagnostic_request { provider }` (`P/messages.ts:1800-1818`), pushed `providers_snapshot_update`.

App-side: the model picker opening calls `refetchIfStale`, and forces a refresh of the selected provider only when its entry is not `ready` (`A/composer/agent-controls/index.tsx:1657-1670`). An error row offers Retry, which refreshes that one provider (`:1672-1677`).

### 1.4 Models and thinking options

- `fetchCatalog()` is the single discovery call and returns `{ models, modes, defaultModeId }` (`S/agent/provider-registry.ts:98-102`).
- Config `models` **replace** discovered models; `additionalModels` are merged on top by id, and a same-id entry updates the discovered model in place; an `isDefault` in the additions clears other defaults (`S/agent/provider-registry.ts:377-439`). With replacement models and static modes, no runtime process is started for discovery (`:649-672`).
- Thinking options live on each model (`thinkingOptions`, `defaultThinkingOptionId`). Codex builds them from the model's `supportedReasoningEfforts` and default effort (`S/agent/providers/codex-app-server-agent.ts:7292-7362`). Cursor derives them from each model's `thought_level` config option through a Cursor-specific ACP extension call, and tells the user to update the CLI if the call is missing (`S/agent/providers/cursor-acp-agent.ts:46-86`).
- Claude appends model ids found in `~/.claude/settings.json` to its first-party list (`docs/custom-providers.md:695-699`, Doc).
- Users can add a custom model id per provider in the provider detail sheet ("Add model" → "Add custom model", field "Model ID", placeholder `e.g. openai/gpt-5`) and remove it again; lists are shown as "Discovered" and "Custom models" with an "Updated {{time}}" stamp (`A/i18n/resources/en.ts:2280-2300`, `A/components/provider-diagnostic-sheet.tsx:442-551`).

### 1.5 Modes and "unattended"

Static mode tables with icon and colour tier (`P/provider-manifest.ts:38-168`):

| Provider | Modes (id → label) | Unattended mode |
| --- | --- | --- |
| claude | `plan` Plan Mode, `default` Always Ask, `acceptEdits` Accept File Edits, `auto` Auto mode, `bypassPermissions` Bypass | `bypassPermissions` |
| codex | `auto` Default Permissions, `auto-review` Auto-review, `full-access` Full Access | `full-access` |
| copilot | ACP `#agent` Agent, `#plan` Plan, `allow-all` Allow All | `allow-all` |
| opencode | `build` Build, `plan` Plan (user agents can replace these at runtime) | none |
| pi | none | none |
| omp | `full` Full Access, `write` Write Approval, `ask` Always Ask | `full` |
| ACP | reported at runtime | provider-specific |

`AgentModeColorTier = "safe" | "moderate" | "dangerous" | "planning" | #hex`; icons are an open string looked up client-side (`P/provider-manifest.ts:4-8`).

"Unattended" = the mode flagged `isUnattended`, i.e. the provider's most-permissioned no-prompt mode (`P/provider-manifest.ts:15-19`). It matters when one agent creates another (`S/agent/create-agent-mode.ts:44-83`):

1. Explicit requested mode: validated against the target's modes, used.
2. No parent: use the target's unattended mode only if the creation asked for unattended.
3. Same provider as parent: inherit the parent's current mode.
4. Different provider: if the creation is unattended **or the parent is in its unattended mode**, use the target's unattended mode.
5. Different provider, target has no modes: no mode.
6. Otherwise: error "cannot inherit mode … Pass an explicit mode", listing the target's modes.

Copilot detail: its ACP `autopilot` mode is hidden and replaced by a synthetic `allow-all` mode implemented by writing the `allow_all` session config option on/off (`S/agent/providers/copilot-acp-agent.ts:132-244`).

### 1.6 Features (toggle / select)

```ts
export interface AgentFeatureToggle { type: "toggle"; id; label; description?; tooltip?; icon?; value: boolean }
export interface AgentFeatureSelect { type: "select"; id; label; description?; tooltip?; icon?; value: string | null; options: AgentSelectOption[] }
```

(`P/agent-types.ts:117-138`.) Features are per-session and model-dependent:

- Claude: `fast_mode` ("Fast", icon `zap`), only for models the manifest marks fast-capable (`S/agent/providers/claude/feature-definitions.ts:4-31`).
- Codex: `fast_mode` (model prefixes `gpt-5`, `gpt-4.1`, `o3`, `o4-mini`, plus two exact ids) and `plan_mode` ("Plan", icon `list-todo`) (`S/agent/providers/codex-feature-definitions.ts:3-67`).
- Copilot: select feature `agent` ("Agent", empty option "Default") mapped from the ACP config option of category `_agent` (`S/agent/providers/copilot-acp-agent.ts:48-56`).
- Cursor: `fast` (`S/agent/providers/cursor-acp-agent.ts:27-34`).
- Every ACP provider: an "Auto Accept" toggle (id `auto_accept`, highlighted green in the app, `A/composer/agent-controls/utils.ts:37-46`); unattended agents turn it on unless told otherwise; requests with no allow option still wait for the user (`docs/custom-providers.md:587-590`, Doc).

### 1.7 Custom providers ("profiles")

Stored under `agents.providers` in `$JAGENTDESK_HOME/config.json`. Schema fields: `extends, label, description, command, env, params, models, additionalModels, disallowedTools, enabled, order` (quoted in `jagentdesk-reference.md` 4.3). Behaviour confirmed in `S/agent/provider-registry.ts`:

- An entry whose id is a built-in id is an override of that built-in (label, description, command, env, models, enabled) (`:725-752`).
- Any other id must set `extends`; missing → startup error (`:767-769`). `extends: "acp"` requires `command` (`:771-774`). `extends: <builtin>` clones the base definition, merges env (derived over base) and concatenates `disallowedTools`; a derived `command` replaces the base command (`:275-297`, `:836-865`). Extending an unknown id is an error (`:830-834`).
- A derived provider's sessions, persistence handles, stream events and models are re-labelled with the derived id, while the inner client still runs as the base provider (`:441-586`).
- `params` are adapter-specific: generic ACP accepts `supportsMcpServers` and `clientCapabilities.{fs.readTextFile, fs.writeTextFile, terminal}` (`S/agent/providers/generic-acp-agent.ts:21-36`).
- `order`: declared in the schema and docs; no consumer was found in `S/agent/provider-snapshot-manager.ts` or `A/provider-selection/` (grep). **UNVERIFIED** that it affects list order.
- No in-app form for authoring an `extends: <builtin>` profile was found; the app offers enable/disable, remove, add custom model, and add-from-catalogue. Profiles with custom `env` are edited in `config.json`. **UNVERIFIED** (the settings page was read by strings, not line by line).

### 1.8 Provider settings UI

Host settings → Providers (`A/screens/settings/providers-section.tsx`, strings `A/i18n/resources/en.ts:2253-2316`):

- Card "Providers": one row per provider with icon, label, status pill and an enable switch. Status pills: "Disabled", "Loading", "Error", "Available", "Not installed" (`providers-section.tsx:52-76`). Available rows show "1 model" / "N models".
- Row press opens a detail sheet: model list with search ("Search models"), states "Loading models...", "No models detected", "No models match your search", Retry; buttons "Add model", "Diagnostic", "Refresh".
- Row menu for custom providers: "Remove provider" with confirm "Remove {{name}}? This deletes the provider entry from config.json. It cannot be undone." (`:369-378`). Writes `removeProviders: [id]`.
- Enable switch writes `providers[id].enabled` (`:346-349`).
- Card "Add provider": searchable catalogue list (`A/components/provider-catalog-list.tsx:152-166`).
- Empty/disconnected: "Connect to this host to see providers".

### 1.9 Diagnostics

`provider_diagnostic_request` returns one plain-text block (`S/agent/provider-snapshot-manager.ts:455-477`): the provider's own diagnostic, then `Models: <n>` and `Status: <...>` after a forced re-probe of that provider in the global scope. Per provider:

- Claude, Codex, Copilot, OpenCode: command-resolution rows and binary/version rows (`buildCommandResolutionDiagnosticRows`, `buildBinaryDiagnosticRows`).
- Claude adds `Auth` = output of `claude auth status`, 5 s timeout (`S/agent/providers/claude/agent.ts:1733-1767`).
- OpenCode adds `Auth` = output of `opencode auth list`, 5 s timeout (`S/agent/providers/opencode-agent.ts:1795-1822`).
- Pi adds whether `~/.pi/agent/auth.json` exists (`S/agent/providers/pi/agent.ts:2608-2623`).
- Generic ACP: provider id, configured command, launcher binary, version command (package-runner aware: `npx -y pkg --acp` is probed as `npx -y pkg --version`), then ACP `initialize` / `session/new` probe rows (`S/agent/providers/generic-acp-agent.ts:102-166`, `:196-246`).
- Diagnostic collection is capped at max(refresh timeout, 120 000 ms) (`S/agent/provider-snapshot-manager.ts:73-78`, `:706-715`).

UI: sheet titled "Diagnostic" with Copy and Refresh, states "Running diagnostic...", "No diagnostic available", "Failed to fetch diagnostic".

### 1.10 Credentials

- Chat: JAgentDesk holds no provider credentials. Each CLI uses its own login. The only place a key can enter JAgentDesk is a user-written `env` block of a provider entry, stored in plaintext in `config.json` and passed to the child process.
- Diagnostics only read auth state by running the CLI's own status command.
- Plan-usage fetchers (section 7) **do read the CLIs' credential stores** to call vendor usage endpoints: Claude reads `~/.claude/.credentials.json` or, on macOS, the Keychain item `Claude Code-credentials` (`packages/server/src/services/quota-fetcher/providers/claude.ts:25`, `:438-441`); Codex reads `auth.json` under `CODEX_HOME` / `~/.config/codex` / `~/.codex` (`.../providers/codex.ts:199-201`); Copilot reads `~/.config/gh/hosts.yml` (`.../copilot.ts:25`); Cursor reads Cursor's local `state.vscdb` (`.../cursor.ts:80-89`). The Claude fetcher is commented as read-only ("the Claude CLI owns refresh", `claude.ts:370`). The Codex fetcher contains a call to `https://auth.openai.com/oauth/token` (`codex.ts:246`); whether it writes a refreshed token back is **UNVERIFIED**.

### What a faithful reproduction must include

- [ ] **JD-PRV-001** Providers are local agent CLIs launched by the daemon; the product makes no direct model API call for chat.
- [ ] **JD-PRV-002** Built-in provider table with id, label, description, default mode, static modes, and an "enabled by default" flag (one provider ships disabled).
- [ ] **JD-PRV-003** Availability = launch binary resolvable on `PATH` or as an executable absolute path; no login check.
- [ ] **JD-PRV-004** Per-provider status `loading | ready | error | unavailable` plus `enabled` and `source: builtin | custom`.
- [ ] **JD-PRV-005** Snapshot cached per working directory plus a global scope; cold read probes, warm read never re-probes; explicit refresh per provider, per cwd, or all.
- [ ] **JD-PRV-006** Probe deadline (default 120 s, env override) with an error that names the stuck step.
- [ ] **JD-PRV-007** Single catalog call returns models, modes and default mode; duplicate model ids collapsed.
- [ ] **JD-PRV-008** Config `models` replace discovery; `additionalModels` merge by id and can relabel or set the default.
- [ ] **JD-PRV-009** Per-model thinking options with a default; providers map their native effort levels onto them.
- [ ] **JD-PRV-010** Mode metadata: label, description, icon, colour tier (`safe | moderate | dangerous | planning`), `isUnattended`.
- [ ] **JD-PRV-011** Unattended-mode inheritance rules for agent-created agents (six-step resolution, explicit error when a cross-provider mode cannot be inherited).
- [ ] **JD-PRV-012** Session features as `toggle` or `select`, model-dependent, changeable while the session lives.
- [ ] **JD-PRV-013** Custom provider entries: override a built-in by id, or new id with `extends` + `label`; env merge, command replace, tool deny-list concatenation.
- [ ] **JD-PRV-014** Generic ACP provider from `extends: "acp"` + `command`, with `params.supportsMcpServers` and client-capability switches.
- [ ] **JD-PRV-015** One-click ACP catalogue: searchable list, "Add" writes the config entry, link to install instructions, no binary install.
- [ ] **JD-PRV-016** Providers settings card: status pill, model count, enable switch, detail sheet with model search, add/remove custom model, refresh, remove custom provider with confirm.
- [ ] **JD-PRV-017** Diagnostic sheet: text report (command resolution, binary, version, auth status via the CLI's own command, model count, status), copy and refresh.
- [ ] **JD-PRV-018** Disabled providers are hidden from pickers and never probed.
- [ ] **JD-PRV-019** No credentials held for chat; keys only via user-written provider `env`.
- [ ] **JD-PRV-020** Parent-session environment variables stripped from child launches.

---

## 2. The composer control row

Placement (`A/composer/index.tsx:301-324`): the left side of the composer toolbar holds, in order, the agent controls (model, thinking, mode, features), then Skills, Autonomous, Team. For a draft (no agent yet) only the draft agent controls and Team are shown. The session-share control is **not** in the composer row; it is rendered in the agent panel header (`A/panels/agent-panel.tsx:1262`).

### 2.1 Provider picker

There is no separate provider control for live agents or drafts. The provider is chosen through the combined model browser, which lists every enabled provider (`A/composer/agent-controls/index.tsx:1465-1477`). A standalone provider combobox exists in the component (`:869-894`, test id `agent-provider-selector`, searchable when more than 6 options) but is only rendered when a caller passes `providerOptions`; neither `AgentControls` nor `DraftAgentControls` passes them (`:1687-1711`, `:1787-1811`).

### 2.2 Combined model browser

`A/components/model-browser.tsx`, `A/components/model-browser-view.ts`, strings `A/i18n/resources/en.ts:1421-1440`.

- Trigger shows the current model label; accessibility label "Select model ({{model}})"; tooltip "Change model".
- Two views. **All**: a "Favorites" section (favourite models from every provider) followed by one row per provider with a count ("N models"), or a spinner "Loading", or a warning "Error", and a chevron; pressing drills in. **Provider**: header with back, the provider name, a gear button "Open {{provider}} settings", a search field ("Search models..."), then that provider's models with favourites sorted first when the query is empty.
- Initial view (`model-browser-view.ts:8-40`): one provider → that provider; else if the current model is not a favourite → its provider; else All.
- Each model row has a check for the current selection and a star button to favourite/unfavourite.
- Provider error state shows the message and "Retry" / "Retrying...". No match → "No models match your search".
- Search only exists inside a provider view; there is no cross-provider search. No recents.
- Desktop: popover, min width 360, placed above the composer (`A/composer/agent-controls/index.tsx:914-915`). Compact: full sheet that also contains the thinking, mode and feature rows (`:1154-1173`).

### 2.3 Mode control

`A/composer/agent-controls/mode-control.tsx`. Button with the mode's icon and colour tier, label hidden at the tightest density. Opens a searchable list ("Search modes..."). Selecting stores `mode` in the provider's preferences and calls `set_agent_mode_request`; a provider notice, if returned, is shown as a toast; failure shows an error toast (`:279-296`). No confirmation dialog was found before entering an unattended mode (grep of the file for "confirm"/"unattended" returned nothing).

### 2.4 Thinking control

Shown only when the active model has more than one thinking option (`A/composer/agent-controls/index.tsx:1697`). Label "Thinking", value = option label. Selecting stores `thinkingByModel[modelId]` and calls `set_agent_thinking_request`; notices become toasts (`:1575-1605`). Not searchable on compact; searchable past 6 options on desktop.

### 2.5 Feature controls

Toggles render as icon buttons (coloured when on: fast = yellow, auto accept = green, plan = blue); selects render as icon + current option with a dropdown. At narrower widths all features collapse into one "Features" button that opens a sheet with On/Off rows (`:968-1012`, `:1342-1393`). Changing a feature stores `featureValues[featureId]` per provider and calls the set-feature RPC (`:1606-1630`).

### 2.6 Skills control

`A/composer/agent-controls/skills-control.tsx:74-150`. Sparkles button labelled "Skills" (value "N skills" when attached). Multi-select list, one option per skill family; selecting toggles attachment to the **current agent**, the picker stays open. Options for skills not installed for this agent's provider appear as install rows ("Install for {{provider}}"); installing swaps the attachment to the installed copy. Attached ids persist per agent id in AsyncStorage (`A/stores/agent-skills-store.ts`). On send, only the attached ids travel as `skillIds`.

### 2.7 Team mode

`A/composer/agent-controls/team-mode-control.tsx:16-56`, `team-mode-store.ts`. Users icon, shown only when the host advertises `agentForum`. In-memory flag per `(serverId, agentId)`, never persisted, so a reload disarms it. When armed, the next send does not start a normal turn: it calls `forum/create { prompt, originAgentId, bootstrapLead: true }`, clears the draft, and disarms (`A/composer/index.tsx:1441-1470`). Tooltip texts are hard-coded English.

### 2.8 Autonomous control

`A/composer/agent-controls/autonomous-control.tsx:19-110`. Infinity icon, shown only when the host advertises `autorun` (daemon config `autorun.enabled`, default off, `P/messages.ts:326-327`). Tap = `autorun.start.request` / `autorun.stop.request` for this agent; state streamed on `autorun.stream`. Tooltip shows "N turns · M done" while running. Server guards are in section 5.9.

### 2.9 Session-share control

`A/composer/agent-controls/session-share-control.tsx` (despite the folder, rendered in the panel header). Shown when the host advertises `sessionSharing`. Opens a sheet "Shared sessions" listing every share of this agent:

- "Create another link" (several concurrent links per agent); "Starting tunnel…" until the URL exists; copy button.
- Section "Guest permissions" with five switches: "Read-only (watch chat, no sending)", "View files & diff (read-only)", "View terminals (read-only)", "View artifacts (Canvas)", "Change the agent's model & mode". Each calls `sessionShareSetOptions` and takes effect for connected guests on their next request (`:120-145`).
- "Codes to give guests" with a countdown per code and an expired style; guest list or "No one has joined yet."; "Recent guest messages"; kick; stop link.
- A pending join pops a dialog "Someone wants to join" with Reject / Accept.

### 2.10 What is remembered

`A/create-agent-preferences/preferences.ts:17-36`, stored in AsyncStorage under `@jagentdesk:create-agent-preferences` (`storage.ts:4`):

```ts
const providerPreferencesSchema = z.object({
  model: z.string().optional(),
  mode: z.string().optional(),
  thinkingByModel: z.record(z.string(), z.string()).optional(),
  featureValues: z.record(z.string(), z.unknown()).optional(),
});
const formPreferencesSchema = z.object({
  provider: z.string().optional(),
  providerPreferences: z.record(z.string(), providerPreferencesSchema).optional(),
  favoriteModels: z.array(z.object({ provider: z.string(), modelId: z.string() })).optional(),
  isolation: z.enum(["local", "worktree"]).optional(),
});
```

So memory is **per device and per provider, not per workspace**: last provider, and for each provider its last model, last mode, thinking per model, and feature values; plus a global favourites list and the last isolation choice. Any mid-conversation change updates these (`A/composer/agent-controls/index.tsx:1514-1520`, `:1581-1591`, `:1612-1621`) and seeds the next draft. Attached skills are per agent. Team mode is per agent, memory only.

### 2.11 Density and compact variants

`A/composer/agent-controls/layout.ts`. Three densities chosen from measured width with 12 px hysteresis: `full` (labels and carets everywhere), `condensed` (no carets, thinking label hidden, features collapsed into one button), `tight` (also hides the mode label). Compact form factor starts at `tight` and replaces popovers with one sheet: the model browser on top and the thinking / mode / feature rows below it (`index.tsx:437`, `:1106-1173`). Toolbar glyph size 16 on web, 20 on native. Hover tooltips are desktop-only.

### What a faithful reproduction must include

- [ ] **JD-CMP-001** Control row order: model, thinking, mode, features, Skills, Autonomous, Team; drafts show model/thinking/mode/features and Team only.
- [ ] **JD-CMP-002** Provider chosen through the combined model browser listing all enabled providers; no separate provider control.
- [ ] **JD-CMP-003** Model browser "All" view: Favorites section plus provider rows with model count / loading / error and drill-down.
- [ ] **JD-CMP-004** Model browser provider view: back, provider-settings shortcut, search within the provider, favourites first, current-selection check.
- [ ] **JD-CMP-005** Favourite star per model, stored as `(provider, modelId)` pairs on the device.
- [ ] **JD-CMP-006** Initial browser view rule (single provider / current non-favourite model's provider / All).
- [ ] **JD-CMP-007** Provider error row with message and Retry that re-probes only that provider; opening the picker probes a not-yet-ready current provider.
- [ ] **JD-CMP-008** Mode control with icon + colour tier, searchable list, provider notice surfaced as a toast.
- [ ] **JD-CMP-009** Thinking control hidden when the model has one or zero options; choice remembered per model.
- [ ] **JD-CMP-010** Feature toggles and selects inline; collapse into one "Features" sheet when narrow.
- [ ] **JD-CMP-011** Skills multi-select per agent with inline "install for this provider" rows; attachment persists per agent.
- [ ] **JD-CMP-012** Team mode: one-shot, memory-only arm that turns the next send into a team topic.
- [ ] **JD-CMP-013** Autonomous toggle with live state and turn/done counters, host-feature gated.
- [ ] **JD-CMP-014** Session-share sheet: multiple links, five guest-permission switches, codes with countdown, guest list, kick, stop, join approval dialog.
- [ ] **JD-CMP-015** Preferences remembered per provider (model, mode, thinking-by-model, feature values) plus last provider and isolation; updated by mid-conversation changes.
- [ ] **JD-CMP-016** Three width-driven densities with hysteresis.
- [ ] **JD-CMP-017** Compact variant: one sheet combining the model browser with thinking, mode and feature rows.
- [ ] **JD-CMP-018** Every control is hidden, not disabled, when the host lacks the feature; controls are disabled while disconnected.

---

## 3. Changing things mid-conversation

### 3.1 Set model / mode / thinking / feature

All four act on the live session and re-emit agent state (`S/agent/agent-manager.ts:1791-1806`, `:1922-1984`):

| Action | RPC | Server behaviour |
| --- | --- | --- |
| Model | `set_agent_model_request { agentId, modelId \| null }` | Calls `session.setModel` if the provider implements it, stores the id, refreshes the persistence handle. `null`/blank = provider default. |
| Mode | `set_agent_mode_request { agentId, modeId }` | `session.setMode`, then reads back the provider's actual current mode and stores that. May return a notice. |
| Thinking | `set_agent_thinking_request { agentId, thinkingOptionId \| null }` | `session.setThinkingOption`, then reads the effective option from runtime info. May return a notice. |
| Feature | set-feature RPC (`C/daemon-client.ts` `setAgentFeature`) | Throws "Agent session does not support setting features" if unsupported; otherwise stores `featureValues[id]`. |

Responses share `{ requestId, agentId, accepted, error, notice? }` (`P/messages.ts:1943-1949`). A notice (`AgentProviderNotice`) is how a provider says "staged until the next turn"; the app shows it as a toast (`docs/providers.md:408`, Doc; toast call `A/composer/agent-controls/index.tsx:1598`). None of the four cancels a running turn in the manager; whether a change applies mid-turn is the provider's decision.

### 3.2 Switch provider mid-conversation

RPC `switch_agent_provider_request { agentId, provider, modelId? }` → `switch_agent_provider_response` (`P/messages.ts:1973-1984`). Permission class `workspace.write` (`S/authorization/operation-permissions.ts:410`).

Server (`S/agent/agent-manager.ts:1808-1920`):

1. Same provider → plain model change.
2. If a turn is running it is **cancelled first** (reason "reload").
3. The whole timeline is curated into one text attachment: user messages, assistant messages and tool calls, wrapped as `<chat-history-summary>` with "Source agent" and "Source directory" lines, `contextKind: "chat_history"`, title "Chat history" (`S/agent/activity-curator.ts:283-340`). Reasoning and tool inputs from external tools are left out.
4. New config = old config with the new provider and model, and **mode, thinking option, feature values and provider `extra` reset** so the new provider uses its defaults.
5. A fresh session is created on the new provider (not resumed). The old session is persisted as closed ("provider switched") and shut down.
6. The new session is registered under the **same agent id**, keeping labels, workspace, owner, timestamps, attention, last usage and cumulative usage totals. The visible timeline is kept as is (`historyPrimed: true`).
7. The curated history is staged in memory and prepended as an attachment to the **next** user message (`S/session.ts:5200-5206`).

Client (`A/composer/agent-controls/index.tsx:1537-1562`): picks from the model browser, stores the model as that provider's preference, shows the toast "Provider switched — your chat context carries over to the next message." (hard-coded English).

Limitations, all from the code above:

- The staged history lives in a `Map` in the daemon process; a daemon restart before the next message loses it, and the new provider then starts with no context.
- The transfer is a text summary, not a native transcript: the new provider cannot rewind into, resume or re-run earlier turns.
- The old provider's native session is abandoned; switching back creates another fresh session.
- Rewind afterwards only reaches messages the new provider has acknowledged (3.5).
- No size cap on the seed was found (`maxItems: 0`); a long conversation produces a large first prompt.

### 3.3 Steer, interrupt, queue

Setting "Default send" (`A/hooks/use-settings/storage.ts:79`, strings `A/i18n/resources/en.ts:1822-1835`), default **Steer**:

- Steer: "When the agent is running, Enter steers the live turn without interrupting it — falling back to interrupt if it can't be steered."
- Interrupt: "When the agent is running, Enter interrupts. Command/Ctrl+Enter queues."
- Queue: "When the agent is running, Enter queues. Command/Ctrl+Enter submits."

Client path (`A/composer/submit.ts:23-52`, `A/composer/index.tsx:1471-1499`): when the agent is running and the send is not forced, the message goes to the local queue; a forced send carries `activeTurnBehavior: "steer" | "interrupt"` taken from the setting.

Server path (`S/agent/agent-prompt.ts:36-110`, `S/agent/agent-manager.ts:2620-2690`):

- Out-of-band commands (e.g. a pause command) run without touching the turn.
- `steer`: the provider's `steerActiveTurn` is called with `expectedTurnId`; `accepted` records the user message into the running turn. If the provider has no steering or answers `unavailable`, the manager falls back to interrupt-and-replace, but only while the same turn is still the active one; otherwise it throws "Active turn changed before steering could be delivered".
- Absent `activeTurnBehavior` = interrupt (backward compatible, `P/messages.ts:1285-1288`).
- Providers implementing steering: Claude, Codex, OpenCode (both adapters), Pi (`steerActiveTurn` definitions at `claude/agent.ts:2291`, `codex-app-server-agent.ts:4288`, `opencode-agent.ts:3625`, `opencode/v2/turns.ts:323`, `pi/agent.ts:1281`). ACP providers and OMP: not found, so they interrupt.
- Cancel changes state only after the provider acknowledges; a rejected interrupt leaves the agent `running` and the follow-up action fails (`docs/agent-lifecycle.md:29`, Doc).

Queue (`A/composer/actions.ts:236-345`, `A/composer/index.tsx:382-405`, `:613-660`): a "Queue track" above the input lists queued messages (two-line preview) with "Edit queued message" (moves it back into the input) and "Send queued message now". Send-now removes the item first and puts it back at the head on failure. The queue is per agent in the client session store; it is client-side, so another device does not see it. Automatic drain when the turn ends was not read. **UNVERIFIED**.

Stop: a stop button with the interrupt shortcut and tooltip "Interrupt"; states "Stop agent" / "Canceling agent" (`A/composer/index.tsx:943-980`).

### 3.4 Fork context

RPC `agent.fork_context.request { agentId, boundaryCursor?, boundaryMessageId? }` → `{ attachment, itemCount, boundaryCursor, boundaryMessageId, error }` (`S/session.ts:8797-8830`). The server builds the same curated chat-history attachment as 3.2, optionally cut at a boundary:

- No boundary = whole timeline up to now, including a partly streamed turn (`A/hooks/use-fork-agent.ts:41-50`).
- Boundary by timeline cursor or by assistant message id. A cursor from an older timeline epoch, or a missing row, fails with "Selected timeline position is no longer available." A boundary inside an item that changed afterwards fails with "This checkpoint changed after it was created. Fork from a later completed response or from the current context instead." (`S/agent/activity-curator.ts:230-277`).

Client: a fork menu on assistant messages with "fork in new tab" and "fork in new workspace" (`A/components/assistant-fork-menu.tsx:89-108`). It opens a **draft** pre-filled with the source agent's provider, cwd, mode, model, thinking and feature values, and attaches the history as a `chat_history` composer attachment (`A/hooks/use-fork-agent.ts:63-110`). The source agent is untouched; nothing is resumed on the provider side. Read-only panes (provider subagents) cannot fork.

### 3.5 Rewind

RPC `agent.rewind.request { agentId, messageId, mode: "conversation" | "files" | "both" }` (`P/messages.ts:2022-2033`). Capability flags per provider:

| Provider | conversation | files | both |
| --- | --- | --- | --- |
| claude (`claude/agent.ts:316-318`) | yes | yes | yes |
| codex (`codex-app-server-agent.ts:221-223`) | yes | no | no |
| opencode (`opencode-agent.ts:137-139`, `opencode/v2/capabilities.ts:10-12`) | no | no | yes |
| pi (`pi/agent.ts:163`), omp (`omp/agent.ts:126`) | yes | no | no |
| copilot, generic ACP (`copilot-acp-agent.ts:33-35`, `acp-agent.ts:253`) | no | no | no |

Server (`S/agent/agent-manager.ts:3115-3160`): a just-submitted prompt cannot be rewound until the provider has echoed it ("Cannot rewind before the provider acknowledges the submitted prompt"); a running turn is cancelled first; the provider performs the revert; unless the mode is `files`, the timeline is re-hydrated from the provider and clients receive a `timeline_replacement` with a new epoch. An unsupported mode throws "Provider does not support rewinding <mode>".

UI (`A/components/rewind/rewind-menu.tsx`, strings `en.ts:1583-1594`): an undo icon on user messages, tooltip "Rewind to this message"; menu header "This action cannot be undone"; items "Rewind conversation", "Rewind files", "Rewind conversation and files", only those the provider supports; the menu is hidden when none are. The chosen item shows a pending state and the menu cannot be dismissed meanwhile. The rewound message text is restored into the composer (`A/components/rewind/composer-restore.tsx`, body not read).

### 3.6 Import existing provider sessions

Purpose: adopt a session started in the provider's own CLI. Contract (`docs/providers.md:57`, confirmed in `S/agent/import-sessions.ts:120-203`, `S/agent/provider-session-import.ts:13-49`):

- List: per provider that supports listing, rows `{ provider handle, cwd, title, prompt previews, last activity }`, default limit 20, newest first, optional `since`, sessions already imported are filtered out.
- Import: `import_agent_request { provider, providerHandleId, cwd, workspaceId?, labels? }` resumes that native session, replays its history into a new agent's timeline (including provider-subagent events), and publishes the agent only when ready. Importing an already-imported handle fails with "Provider session is already imported".
- UI: sheet "Import session" (`A/components/import-session-sheet.tsx`, strings `en.ts:360-389`): provider filter chips with "All", refresh, rows with title ("Untitled session") and prompt preview ("No prompt preview"), row state "Importing...", empty states "No recent sessions to import." / "All recent sessions are already imported." / "No {{provider}} sessions found.", partial failure "Could not load sessions for {{providers}}." Also reachable from the open-project start tiles ("Import session — Bring in recent external CLI sessions").

### What a faithful reproduction must include

- [ ] **JD-MID-001** Set model on a live agent, `null` = provider default; state re-broadcast to all clients.
- [ ] **JD-MID-002** Set mode on a live agent; stored value is the provider's read-back mode.
- [ ] **JD-MID-003** Set thinking option on a live agent; stored value is the provider's effective option.
- [ ] **JD-MID-004** Set feature on a live agent; clear error when the provider cannot.
- [ ] **JD-MID-005** Provider notices ("applies next turn") returned in the response and shown as a toast.
- [ ] **JD-MID-006** Switch provider keeps the agent id, timeline, labels, workspace and usage totals; resets mode, thinking, features.
- [ ] **JD-MID-007** Switch provider cancels a running turn first.
- [ ] **JD-MID-008** Prior conversation carried as a curated text history attached to the next user message, with a user-visible notice saying so.
- [ ] **JD-MID-009** Send behaviour setting with three options (steer / interrupt / queue), default steer, and the modifier-key alternate.
- [ ] **JD-MID-010** Steer guarded by the expected turn id, with fallback to interrupt-and-replace only while that turn is still active.
- [ ] **JD-MID-011** Client-side queue track with edit and send-now, re-queue at head on failure.
- [ ] **JD-MID-012** Stop button with pending state; cancellation only reflected after the provider acknowledges.
- [ ] **JD-MID-013** Fork from an assistant message (or current context) into a draft in a new tab or new workspace, history attached, source agent untouched.
- [ ] **JD-MID-014** Fork boundary validation with the two stale-anchor errors.
- [ ] **JD-MID-015** Rewind menu offering only provider-supported modes among conversation / files / both, with the irreversible warning.
- [ ] **JD-MID-016** Rewind cancels a running turn, replaces the timeline with a new epoch, and refuses unacknowledged prompts.
- [ ] **JD-MID-017** Import-session sheet: recent native sessions per provider, already-imported filtered, history replayed into a new agent.
- [ ] **JD-MID-018** Out-of-band commands run without interrupting the active turn.

---

## 4. Orchestration (ORC)

Topology: Human → Supervisor → Lead → Peers. Config schema is quoted in `jagentdesk-reference.md` 4.2. Everything below is from function bodies.

### 4.1 Starting a run

Two entry points, same function (`A/orchestration/start-objective.ts:62-123`):

- Client slash command `/orc <text>` (alias `/orchestrate`), description "Start orchestration (Supervisor → Lead → Peer)", argument hint `<what should the team do>` (`A/client-slash-commands/index.ts:41-50`). Client slash commands are ignored when the message has attachments (`:63-66`). It works in both the live composer and the draft composer.
- The workspace Orchestration panel's request box ("What should the team do?", "Enter to send · Shift+Enter for a new line") (`A/screens/workspace/orchestration-workspace-panel.tsx:274-294`).

Steps:

1. Guard: empty text → "Enter what the team should do."; orchestration or the Supervisor role disabled → "Orchestration or the Supervisor role is disabled in Host > Orchestration."; no host/workspace → "Connect to the host and open a workspace before using /orc."
2. `orchestration.task.prepare.request { rawRequest, workspaceId, cwd }` → brief.
3. If the brief is `needs_clarification`, nothing starts and the open questions are shown ("Needs clarification before orchestration can start: …").
4. Supervisor prompt = the brief's `normalizedPrompt` + a "Runtime contract" block: you are the single contact; delegate only when the work needs parallel workstreams, otherwise do it yourself; if delegating call `orchestration.bootstrap_lead` exactly once; never use generic `create_agent` / `send_agent_prompt` to bypass the topology; the requested route and preferred target; the daemon enforces at most N Peer assignments.
5. Reuse: if the workspace already has an agent labelled role `supervisor`, its brief label is updated and the prompt is sent to it. Otherwise a new agent is created from the Supervisor role's **default profile** (provider, model, thinking option), titled with the first line of the request (cut to 60 chars), labelled `role=supervisor`, `workspace-id`, `brief-id`.

Observations: the Supervisor's configured `instructions` are not added to this prompt (only the hard-coded contract is); the Supervisor profile's `modeId` is not passed at creation (`start-objective.ts:106-121`).

### 4.2 Task brief preparation

`S/orchestration/task-brief.ts`. Pure text processing:

- Lines of the form `Label: text` are bucketed by label. Recognised labels: objective/goal, context, constraints/constraint, accepted decisions/decisions, requested outcome/outcome, acceptance criteria/acceptance, validation/validation plan, route/category (`:23-39`). Unlabelled text goes to the objective. List markers are stripped.
- Route category: explicit `route:` label, else the request's `routeCategory`, else keyword inference in this order — audit/review → `audit`; ui/ux/screen/layout/component → `ui`; search/find/investigate → `search` (or `research` if research/compare words also appear); architecture/protocol/security/migration → `impl_deep`; plan/design → `planning`; default `impl`. The keyword lists include Vietnamese terms (`:90-106`).
- Route resolution: primary then fallbacks; a target is dropped when its profile is missing, its profile or role is disabled, or the route's `guardProviderPrefix` does not prefix the profile's provider; no usable target → error "No usable orchestration route for <category>" (`:125-150`).
- Defaults when absent: acceptance "The requested behavior is implemented and verified with targeted tests."; validation "Run targeted unit/integration tests, build affected packages, and perform observable desktop E2E."
- `needs_clarification` only when the request is empty or the objective is shorter than 3 characters (`:211-218`).
- Output includes `normalizedPrompt` (objective, context, constraints, accepted decisions, requested outcome, acceptance criteria, validation plan, routing category, selected profile).

### 4.3 Role-scoped tools

Registered per caller from its orchestration labels (`S/agent/tools/jagentdesk-tools.ts:3258-3430`):

| Role | Tools |
| --- | --- |
| supervisor | `orchestration.bootstrap_lead` |
| lead | `orchestration.create_peer`, `orchestration.resolve_dissent`, `orchestration.accept_result` |
| peer (or any custom role) | `orchestration.handback` |

Guards on the generic tools:

- `create_agent` from any agent inside a run throws "Orchestration <role> cannot use generic create_agent; use the role-scoped orchestration tool" (`:4370-4374`).
- `send_agent_prompt`: a Peer cannot send at all; a Lead cannot prompt a Peer of its own brief; a Supervisor cannot prompt a Peer of its own brief (`:3233-3256`). A Supervisor can still prompt the Lead.

An agent is "in a run" when it has the role, workspace-id and brief-id labels (`S/orchestration/runtime.ts:280-288`).

### 4.4 `bootstrap_lead`

`S/orchestration/runtime.ts:427-537`. Supervisor only. Creates the run record on first use (only a Supervisor can create it; `:355-359`).

1. Run already has a Lead: alive → returned with `reused: true`; not alive → error "This orchestration run already has an unhealthy Lead. Replacement requires an explicit Human-authorized lifecycle operation."
2. Else, one active Lead per **workspace**: more than one → "Topology violation"; exactly one → its brief label is moved to the new brief, the relay prompt is sent to it, `reused: true`.
3. Else create: the Lead role must be enabled; candidates = default profile first, then the other enabled profiles; each is tried in turn and errors are collected; all fail → "Unable to bootstrap a Lead: <profile: error; …>".
4. Lead prompt: `<jagentdesk-orchestration>` block with role, ownership statement, workspace, brief, "Human relay:" text, and the Lead role's instructions (default text if none).

Created agents go through the normal create path with `background: true`, `notifyOnFinish: true`, the caller as parent, the profile's provider/model, thinking option and optional mode, in the caller's workspace (`:386-425`).

### 4.5 `create_peer`

`S/orchestration/runtime.ts:539-635`. Lead only, and only the run's registered Lead.

- Input: `routeCategory, assignment, ownershipBoundary, expectedHandback, title?`.
- Limit: count of this Lead's assignments in the run whose status is not `failed` must be below `limits.maxPeersPerLead` (1–12, default 3) → else "Peer fan-out limit reached (N) for this Lead's active brief". Handed-back and accepted assignments still count, so the limit is **total per brief, not concurrent**. No code path in this file sets an assignment to `failed`.
- Routing: `resolveConfiguredRouteCandidates` (primary, fallbacks, guard) filtered to non-supervisor, non-lead roles; none → "Route <category> does not resolve to a configured Peer; keep this work with the Lead or choose a Peer route". (The default `planning` route targets the Lead, so it cannot staff a Peer.)
- Each candidate is tried in order; a disabled or missing role fails that candidate; all fail → "Unable to create a Peer for <category>: …".
- Thinking option = route target's override, else the profile's.
- Peer prompt: role, route, execution profile, role instructions, route instructions, assignment, ownership boundary, expected handback, and the handback field list.
- Labels: role (the target's role id, so custom roles work), workspace-id, brief-id, route, profile-id, assignment-id.
- Run record gets `{ id, agentId, parentAgentId, routeCategory, profileId, status: "active", createdAtMs }`.

### 4.6 `handback`, `resolve_dissent`, `accept_result`

- `handback` (`:637-672`): caller must be a non-supervisor/non-lead role whose parent label equals the run's Lead. Stores the handback, marks the assignment `handed_back`, and sends the Lead a `<jagentdesk-orchestration-handback>` message. Fields: required `whatChangedOrInspected`, `evidence`, `remainingUncertainty`, `counterevidence`; optional `requestedResolution`, `currentDirection`, `claim`, `risk`; each up to 12 000 chars.
- `resolve_dissent` (`:674-734`): Lead only; target must be a Peer of this brief and workspace whose parent is this Lead. Outcomes `RESOLVED_BY_LEAD | NEEDS_MORE_EVIDENCE | ESCALATED_TO_HUMAN`. **At most one `NEEDS_MORE_EVIDENCE` per Peer** ("Only one bounded NEEDS_MORE_EVIDENCE round is allowed"). Records rationale, next action and verification round, and sends the Peer a resolution message ending "The Lead has closed this dissent. Do not reopen an unbounded debate." `ESCALATED_TO_HUMAN` has no extra side effect here (no notification to the human was found in this function).
- `accept_result` (`:736-776`): Lead only. Stores `{ summary, evidence, remainingUncertainty }`, turns every `handed_back` assignment into `accepted`, and sends the Supervisor a message that ends "The Supervisor should report this to the Human without changing the technical decision." Errors if the Supervisor agent is gone.

### 4.7 Run state and labels

File `$JAGENTDESK_HOME/orchestration/runtime.json`, atomic write, all mutations serialised through one promise chain (`:312-338`). Shape:

```ts
const OrchestrationRunStateSchema = z.object({
  id: z.string().min(1),                       // = brief id
  workspaceId: z.string().min(1),
  supervisorAgentId: z.string().min(1),
  leadAgentId: z.string().min(1).optional(),
  assignments: z.array(OrchestrationAssignmentStateSchema),   // status: active | handed_back | accepted | failed
  handbacks: z.array(OrchestrationHandbackRecordSchema),
  dissents: z.array(OrchestrationDissentRecordSchema),
  acceptedResult: OrchestrationAcceptedResultSchema.optional(),
  createdAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(),
});
```

Labels: `jagentdesk.orchestration.role`, `.workspace-id`, `.brief-id`, `.route`, `.profile-id` (`P/orchestration.ts:359-363`) and `.assignment-id` (`runtime.ts:604`). There is no RPC that returns the run record to the app; the UI derives everything from agent labels and agent state (see 4.9). Runs are never pruned in this file.

### 4.8 Settings page

`A/screens/settings/orchestration-page.tsx` (Host → Orchestration), saved with `orchestration.config.update.request` (patch; `removeRoleIds` for deleting custom roles):

- Section "Orchestration": switches "Enable orchestration", "Prepare a Task Brief automatically", "Ask when a decision is missing"; stepper "Maximum Peer fan-out" with − / + (`:1067-1145`). The two middle switches are persisted but nothing reads them.
- Section "Role profiles": one block per role (Supervisor, Lead, Peer, custom) with an enable switch, the profile list (the default is marked "· default"; others have a set-default action), add/edit profile, and a multi-line "Instructions" field ("System instructions injected into this role's agents at creation.") (`:640-800`). Custom roles can be removed. "Add role" opens a form: Role name, Label, Provider, Model, Thinking option (`:493-576`).
- Profile form: Label; Provider ("Use an installed provider id from Host > Providers."); Model — a picker when the host reports models, a free-text "Enter a model id" otherwise, with "Detecting available models on this host…" while loading; Thinking option ("Passed to the provider runtime exactly as configured.") (`:211-284`).
- Section "Semantic routing": one row per route category with "Primary profile" picker and "Route instructions" ("Extra guidance for how the Lead interprets this route.") (`:851-873`). Fallbacks and `guardProviderPrefix` have no editor on this page as far as the strings show. **UNVERIFIED**.
- Unavailable host: "Orchestration is unavailable on this host."

### 4.9 Workspace surfaces

- **Agents column** (`A/screens/workspace/orchestration-agents-column.tsx:44-130`): mounted only when the workspace has at least one agent with a role label. Header "WORKSPACE AGENTS" / "Human → Supervisor → Lead → Peer". Rows sorted supervisor, lead, peer; each shows role ("Peer · <route>"), status and provider/model; pressing a row focuses that agent's thread. Observability only — sending goes through the normal composer. A `compact` variant is full-width and height-capped for mobile.
- **Orchestration panel / dock** (`A/screens/workspace/orchestration-workspace-panel.tsx`): title "Orchestration"; brief card with "Objective", "Route", "Needs your decision" (open questions), "Acceptance"; "Runtime" card listing role agents with "Open thread"; request box; open/close dock buttons.
- **Lead plan card** (`orchestration-agents-column.tsx:150-200`, rendered in the agent panel at `A/panels/agent-panel.tsx:1622`): appears when the workspace has agents labelled role `peer`. Collapsed header "Lead plan · N bounded assignment(s)"; expanded lists each Peer with its route (default "impl"). It filters on the literal role `peer`, so custom-role workers are not listed.

### What a faithful reproduction must include

- [ ] **JD-ORC-001** `/orc <text>` client command (alias) and a workspace request box that share one start function.
- [ ] **JD-ORC-002** Start guards and their messages (empty, disabled, not connected).
- [ ] **JD-ORC-003** Deterministic brief: labelled-section parsing, keyword route inference with explicit override, defaults for acceptance and validation.
- [ ] **JD-ORC-004** Brief status `ready | needs_clarification`; a run does not start on `needs_clarification` and the questions are shown.
- [ ] **JD-ORC-005** One Supervisor per workspace, reused for later briefs; created from the Supervisor default profile with role/workspace/brief labels and a title from the request.
- [ ] **JD-ORC-006** Supervisor runtime contract: do simple work itself, delegate at most once, never bypass the topology.
- [ ] **JD-ORC-007** Role-scoped tool sets (supervisor / lead / peer-like) decided from agent labels.
- [ ] **JD-ORC-008** Generic agent creation refused for any agent inside a run; prompt-sending restrictions between roles.
- [ ] **JD-ORC-009** `bootstrap_lead`: reuse the run's Lead, else reuse the workspace's single active Lead (re-labelled), else create with default-then-other-profiles fallback.
- [ ] **JD-ORC-010** Unhealthy-Lead and multiple-Lead errors that demand human action.
- [ ] **JD-ORC-011** `create_peer` inputs (route, assignment, ownership boundary, expected handback) and the structured assignment prompt.
- [ ] **JD-ORC-012** Route resolution: primary, ordered fallbacks, disabled role/profile skip, provider-prefix guard, per-route thinking override.
- [ ] **JD-ORC-013** `maxPeersPerLead` (1–12, default 3) enforced as total assignments per brief.
- [ ] **JD-ORC-014** Structured handback (four required fields, four optional, 12 000-char cap) delivered to the Lead as a message.
- [ ] **JD-ORC-015** Dissent resolution with three outcomes and a single more-evidence round per Peer.
- [ ] **JD-ORC-016** `accept_result` marks handed-back assignments accepted and notifies the Supervisor.
- [ ] **JD-ORC-017** Durable run record (assignments, handbacks, dissents, accepted result) with serialised atomic writes.
- [ ] **JD-ORC-018** Agent labels for role, workspace, brief, route, profile, assignment.
- [ ] **JD-ORC-019** Settings: enable switch, fan-out stepper, per-role enable/profiles/default/instructions, custom roles add/remove, per-route primary profile and instructions.
- [ ] **JD-ORC-020** Profile form with provider, model picker (free text when no model list), thinking option, optional mode.
- [ ] **JD-ORC-021** Agents column shown only when a run exists, ordered by role, with status and provider/model, opening the thread on press.
- [ ] **JD-ORC-022** Brief card (objective, route, open questions, acceptance) and runtime list in the workspace panel.
- [ ] **JD-ORC-023** Lead plan card with assignment count and per-Peer route.
- [ ] **JD-ORC-024** Peer agents created in the background with the creator as parent and finish notification on.

---

## 5. Free multi-agent

### 5.1 Tool delivery

One tool catalogue (`S/agent/tools/jagentdesk-tools.ts`, `forum-tools.ts`). Providers that accept runtime tools get it natively; the rest get it through an MCP endpoint the daemon injects (`docs/providers.md:25`, Doc). The host switch is `daemon.mcp.injectIntoAgents` (`A/screens/settings/host-page.tsx:985-1006`; label "Enable JAgentDesk tools" per `public-docs/orchestration.md:38`, Doc). Agents must be started or reloaded after turning it on. The catalogue is built per caller: `callerAgentId` decides defaults and scoping (`jagentdesk-tools.ts:3441-3452`).

### 5.2 Agent tools

| Tool | Behaviour (line refs in `jagentdesk-tools.ts`) |
| --- | --- |
| `create_agent` (`:4350`) | Required: `title` (≤ 60 chars), `provider` as `provider/model`, `initialPrompt`. Optional: `workspaceId`, `labels`, `settings { modeId, thinkingOptionId, features }`. From an agent: always background, `notifyOnFinish` default **true**, the new agent is the caller's subagent in the caller's workspace unless `workspaceId` is given (placement never changes parentage). From a top-level caller (CLI/MCP without an agent): `background` default false (waits), no workspace → a new local workspace. Legacy `relationship` / `workspace` objects (incl. worktree `branch-off` / `checkout-branch` / `checkout-pr`) are still accepted (`:3773-3945`). Returns agent id, status, cwd, workspace id, current mode, available modes, last message, pending permission, and a guidance string "You will get notified when the created agent finishes… Do not poll". |
| `send_agent_prompt` (`:4817`) | `agentId, prompt, sessionMode?, skillIds?, background?, notifyOnFinish?`. Agent callers default to background + notify; top-level callers wait. A waiting call that times out while the target still runs arms the finish notification instead (`:4866-4874`). |
| `get_agent_status` (`:4919`) | Latest snapshot: lifecycle, capabilities, pending permissions. |
| `get_agent_activity` (`:5955`) | Curated summary of recent timeline entries: `{ updateCount, currentModeId, content }`. |
| `list_agents` (`:4969`) | Compact metadata; filters `includeArchived`, `cwd`, `statuses`; `limit` default 50, max 200. |
| `cancel_agent` (`:5028`) | Aborts the current run, keeps the agent. |
| `archive_agent` (`:5052`) | Soft delete; interrupts if running. |
| `kill_agent` (`:5081`) | Ends the session permanently. |
| `update_agent` (`:5102`) | Name, labels, runtime settings. |
| `set_agent_mode` (`:6011`) | Switch another agent's mode. |
| `list_pending_permissions` (`:6035`), `respond_to_permission` (`:6069`) | See and answer permission requests of any agent. |
| `list_providers`, `list_models`, `inspect_provider` (`:5844-5893`) | Discover provider/model ids. |
| `create_workspace`, `list_workspaces`, `archive_workspace`, `rename_workspace` (`:4156-5144`) | Workspace management. |
| `speak` (`:4097`) | Voice output (voice sessions). |

Waiting: the wait budget is 30 000 ms (`S/agent/mcp-shared.ts:61`). There is no dedicated wait tool; `background: false` plus the finish notification cover it.

Who can call whom: any agent with the tools can address any agent id on the host — no ownership check was found on `send_agent_prompt`, `cancel_agent`, `archive_agent`, `kill_agent`, `set_agent_mode` or `respond_to_permission` beyond the orchestration role guards (4.3). A caller context can lock the child's cwd (`lockedCwd`, `allowCustomCwd`) and add default labels (`:3523-3535`). Where that context is set was not read. **UNVERIFIED**.

### 5.3 Parentage, subagents track, detach, archive

From `docs/agent-lifecycle.md` (Doc) with code anchors:

- Agent-scoped creation stamps the label `jagentdesk.parent-agent-id`. Membership rule for the track: `parentAgentId === thisAgent.id && !archivedAt` (`A/subagents/select.ts`).
- The **Subagents track** is a collapsible lane above the composer (`A/subagents/track.tsx:93-300`). Rows show title and state; pressing opens the subagent as a tab. Row actions: "Detach subagent" and "Archive subagent" (confirm dialog). Header action: "Archive finished" (`en.ts:1616-1623`).
- A same-workspace subagent is not auto-opened as a tab; a cross-workspace subagent is auto-opened in its own workspace and still listed in the parent's track.
- Closing a subagent's tab is layout-only. Closing a root agent's tab archives it (confirm when running).
- **Detach** (`agent.detach.request`, CLI `jagentdesk agent detach`): removes the parent label only; the agent keeps running, keeps its cwd and workspace, leaves the track. It is a human action, deliberately not an agent tool.
- **Archive** is a global soft delete and cascades to children recursively (`S/agent/agent-manager.ts:1690-1714`). A child the parent should not take down is detached instead of archived (`shouldDetachFromArchivedParent`, `:1707`).
- Workspace status: a running same-workspace descendant counts as `running` for the nearest ancestor's workspace; its other states stay in the track.
- `autoArchive` on create archives the agent after its first terminal turn event, and its isolated workspace with it.

### 5.4 Native provider sub-agents

Sub-agents a provider spawns inside its own runtime (Claude task tool, Codex, OpenCode) are **not** managed agents. They arrive on a separate channel: stream event `provider_subagent`, RPCs `agent.provider_subagents.list.request`, `agent.provider_subagents.timeline.get.request`, push `agent.provider_subagents.update` (`P/messages.ts`, names listed by grep). The client keeps them in their own store (`A/subagents/provider-store.ts`) and merges only display rows into the track. Opening one gives a **read-only** pane: no composer, no archive, detach, rewind or fork (tab kind `provider_subagent`, `A/workspace-tabs/model.ts:37`). "Archive finished" only hides finished provider rows for the current app session; a hidden row reappears if it runs again. OMP is the exception: its child sessions are imported as managed subagents (`docs/providers.md:39`, Doc).

### 5.5 Agent-to-agent chat rooms

`S/chat/chat-service.ts`, `S/chat/chat-mentions.ts`. Storage: one file `$JAGENTDESK_HOME/chat/rooms.json` (`chat-service.ts:121`).

- RPCs `chat/create`, `chat/list`, `chat/inspect`, `chat/delete`, `chat/post`, `chat/read`, `chat/wait`. Exposed to agents through the CLI (`jagentdesk chat create|ls|inspect|delete|post|read|wait`, `packages/cli/src/commands/chat/`), not as catalogue tools.
- Room names are unique case-insensitively; rooms are addressed by name or id.
- Post: non-empty body and author required; optional `replyToMessageId` must exist in the room; mentions parsed with `@name` after start/space/"(" (`chat-service.ts:35-45`).
- Read: filters `since` (timestamp), `authorAgentId`, `limit` (last N).
- Wait: returns messages after a cursor message id immediately if any; unknown cursor → error; otherwise blocks until a post or the timeout (returns an empty list on timeout).
- Mentions wake agents: each mentioned agent gets a prompt "Chat mention from <author> in room "<room>" … Read the room with: jagentdesk chat read <room> --limit 20". `@everyone` expands to everyone who has posted in the room and is refused above 25 targets. The author, archived agents and agents in error are skipped (`chat-mentions.ts:5`, `:43-135`).
- No standalone chat-room screen exists in the app (only the forum's chat tab). The human sees the effect as prompts arriving in the mentioned agents' threads.

### 5.6 Agent forum and Team mode

Storage: per-topic JSON under `$JAGENTDESK_HOME/forums`; every change is pushed to all clients on `forum.stream` (`S/bootstrap.ts:1431-1437`).

Data model (`P/agent-forum/types.ts`):

- Topic phases `discussion → planning → building → review → done`, plus `archived` (`:13-20`).
- Task statuses `backlog, todo, in_progress, review, blocked, done` (`:25-32`); estimates `unknown, xs, s, m, l, xl`.
- Participant roles `supervisor, lead, peer, ba, tester, pentester, reviewer, user, system` (`:38-48`).
- Task reviews: verdict `approve | request_changes`, structured findings with category and severity `critical | high | medium | low` (`:80-120`).
- Messages have kinds (research, proposal, question, decision, review… `:163`), votes, replies; a banter side channel with rooms, text/sticker messages and emoji reactions (`:208-245`); versioned diagrams in `mermaid` or `archify` format (`:249-280`); `pendingHumanQuestion` when the team waits for the human (`:309-312`).

RPCs: `forum/create`, `forum/list`, `forum/get`, `forum/archive`, `forum/post`, `forum/vote` (up/down/clear), `forum/chat-post`, `forum/chat-react`, `forum/chat-room`, `forum/delete`, `forum.diagram.html.request` (`P/agent-forum/rpc-schemas.ts:8-100`).

Agent tools (`S/agent/tools/forum-tools.ts`): post message, set diagram, ask human, create task, create subtask, assign task, vote, comment on task, claim task, estimate task, set task status, set phase (lead only), review task, get topic, chat, chat sticker, chat react, open chat room.

Team mode flow:

1. User arms Team in the composer and sends (2.7). `forum/create` with `bootstrapLead: true`.
2. The **origin chat agent becomes the lead**: the daemon sends it a long team-lead prompt (`S/agent-forum/bootstrap.ts:8-144`, `:156-185`). This is separate from ORC — it uses generic `create_agent` + `send_agent_prompt` for peers and the forum tools for the board. The prompt prescribes the five phases, 1–2 debating peers, an architecture diagram before tasks, one coder per task, three named reviewers (BA, Tester, Pentester) per reviewed task, and the escalation path (forum "ask human" then the provider's ask-user tool).
3. Double sends are de-duplicated: one topic per lead within a 30 s window, concurrent creates join the in-flight one (`S/agent-forum/service.ts:175-250`).
4. No origin agent → topic created, no lead bootstrap (warning logged).

Human view (`A/screens/agent-forum-screen.tsx`): tabs thread, board, chat, office, architecture (`:1391`). Phase stepper Discussion / Planning / Building / Review / Done (`:93-97`); board columns Backlog / To do / In progress / Review / Blocked / Done (`:501-506`); overview charts "TASKS BY STATUS", "TASKS BY EPIC"; messages awaiting the human are tagged "NEEDS YOUR ANSWER" (`:1367`); task detail with description, comments, reviews. The **office** tab is an animated scene with one character per participant whose pose reflects real state (working, reviewing, waiting, talking, shipped, idle) (`A/screens/agent-forum-office.tsx:1-10`).

Human intervention: posting in the thread or chat wakes the lead always and any teammate @mentioned by a word of their label; others are woken with an "optional" instruction (`S/agent-forum/bootstrap.ts:197-260`). The human can also vote, react, open rooms, archive or delete a topic.

### 5.7 Loops (worker / verifier)

`S/loop-service.ts`, CLI `jagentdesk loop run|ls|inspect|logs|stop`, skill `skills/jagentdesk-loop/SKILL.md`. A loop repeats: start a worker agent with the worker prompt → run verification → stop on success or limits.

- Verification is required: a verifier prompt (a second agent that answers done/not done) and/or one or more shell checks ("Loop requires --verify or at least one --verify-check", `:425-426`).
- Options: worker provider, verifier provider, `sleepMs`, `maxIterations`, `maxTimeMs`, `archive` (`:79-98`, `:445-450`). The `--archive` help text in the skill says it keeps agents for inspection; the code archives worker/verifier agents when `archive` is true (`:570-571`, `:784-785`).
- End states `succeeded | failed | stopped`; reaching max iterations or max time = `failed` with a reason (`:604-609`).
- Each iteration is recorded with worker outcome, check results and verifier result; logs are tagged `loop | worker | verifier | verify-check`.
- Storage `$JAGENTDESK_HOME/loops/` (`jagentdesk-reference.md` section 6). No loop tool in the catalogue and no loop screen in the app were found; loops are a CLI primitive.

### 5.8 Heartbeats and schedules

One service (`S/schedule/service.ts`), 1 s tick (`:28`).

- **Heartbeat** = schedule whose target is an existing agent. Tool `create_heartbeat { prompt, cron, timezone?, name?, maxRuns?, expiresIn? }`, agent-scoped only ("create_heartbeat requires an agent-scoped session"); it targets the caller itself. Creating one with the same name and target replaces the previous (`createOrReplace`). `delete_heartbeat { id }` only for the caller's own heartbeats (`jagentdesk-tools.ts:5529-5600`). No update tool: delete and recreate (`public-docs/schedules-chat.md`, Doc).
- **Schedule** = starts a **new agent** each run. Tool `create_schedule { prompt, cron, timezone?, name?, provider (or provider/model, defaults to the caller's), cwd?, isolation?: local|worktree, maxRuns?, expiresIn? }` (`:5479-5527`). Management tools: list, inspect, pause, resume, delete, update, logs, run once.
- Completion: a schedule becomes `completed` when `expiresAt` passes or completed runs reach `maxRuns` (`S/schedule/service.ts:137-156`). Run-once on an already running schedule fails with "Schedule <id> is already running" (`:531`).
- New-agent runs archive the agent (and a worktree workspace) on finish unless `archiveOnFinish` is false (`:131-133`, `:929`).
- UI: Schedules screen (`A/screens/schedules-screen.tsx`, not read line by line) and CLI.

### 5.9 Autonomous mode (autorun)

`S/autorun/service.ts`. Re-prompts the **same agent** turn after turn toward its last request, feeding back a compact list of things already done.

- Each turn must end with a marker line `AUTORUN_RESULT {"done", "nothing_new", "note", "done_items"}` (`:43`, `:365-369`).
- Only `done: true` ends the run by itself. `nothing_new` means "wait": the next check backs off from 30 s up to 5 min (`:40-41`).
- Safety caps: 2000 turns, 12 h wall clock, 50 USD accumulated cost, 5 turns without new done-items, 3 consecutive failures (`:28-32`). The done-items record keeps the last 50 (`:33`).
- While the user is mid-turn the loop waits (re-check every 400 ms) instead of competing (`:34`, `:244`).
- State `{ agentId, status, iteration, startedAt_ms, updatedAt_ms, lastActivityAt_ms, doneItems, lastNote, spendUsd, stopReason, stopDetail }` (`P/messages.ts:2920-2937`); a daemon restart leaves the toggle off with the record intact (`service.ts:95-101`).

### What a faithful reproduction must include

- [ ] **JD-MA-001** One tool catalogue delivered natively or through an injected MCP endpoint, behind a host switch.
- [ ] **JD-MA-002** `create_agent` with required title, `provider/model`, initial prompt; agent callers always background with finish notification on by default.
- [ ] **JD-MA-003** Created agent is the caller's subagent in the caller's workspace by default; a workspace id changes placement only.
- [ ] **JD-MA-004** Top-level callers wait by default and get a new local workspace when none is given.
- [ ] **JD-MA-005** `send_agent_prompt` with background/notify defaults by caller type and timeout-to-notification hand-over.
- [ ] **JD-MA-006** Finish notification delivered to the creator as a prompt when the child finishes, errors, or needs permission, with "do not poll" guidance.
- [ ] **JD-MA-007** Status, curated activity, and list tools (list limit 50, max 200, status/cwd/archived filters).
- [ ] **JD-MA-008** Cancel (keep agent), archive (soft delete), kill (permanent), update (name/labels/settings), set mode.
- [ ] **JD-MA-009** Agents can list and answer other agents' permission requests.
- [ ] **JD-MA-010** Provider/model discovery tools so an agent can pick valid ids.
- [ ] **JD-MA-011** Parent label on creation; subagents track above the composer with open, detach and archive per row.
- [ ] **JD-MA-012** Closing a subagent tab is layout-only; closing a root agent tab archives with confirm when running.
- [ ] **JD-MA-013** Archive cascades to children; detach is human-only and changes nothing but the parent link.
- [ ] **JD-MA-014** Cross-workspace subagents open in their own workspace and stay in the parent's track.
- [ ] **JD-MA-015** Provider-native sub-agents shown in the same track as read-only timelines on a separate channel, with session-local "Archive finished".
- [ ] **JD-MA-016** Chat rooms: create/list/inspect/delete/post/read/wait, reply-to, name-or-id addressing.
- [ ] **JD-MA-017** `@mention` wakes the mentioned agent with a prompt; `@everyone` = room posters, capped at 25; ineligible targets skipped.
- [ ] **JD-MA-018** Blocking wait with cursor and timeout that returns empty on timeout.
- [ ] **JD-MA-019** Forum topic with five phases, task board with six statuses, estimates, epics, subtasks, comments.
- [ ] **JD-MA-020** Role reviews (BA / Tester / Pentester) with verdict and severity-graded findings.
- [ ] **JD-MA-021** Thread with message kinds, votes, replies; banter chat with rooms, stickers and reactions.
- [ ] **JD-MA-022** Versioned architecture diagrams published by agents and browsable by the human.
- [ ] **JD-MA-023** "Ask human" state surfaced on the board and in the thread; human posts wake the lead and mentioned teammates.
- [ ] **JD-MA-024** Team mode makes the origin chat agent the lead via a bootstrap prompt, with 30 s duplicate-create protection.
- [ ] **JD-MA-025** Forum screen tabs: thread, board, chat, office, architecture; overview charts.
- [ ] **JD-MA-026** Office view: one animated character per participant reflecting real state.
- [ ] **JD-MA-027** Loops: worker + verifier prompt and/or shell checks, sleep, max iterations, max time, per-iteration records and logs, stop.
- [ ] **JD-MA-028** Heartbeat: cron prompt into the calling agent itself, replace-by-name, own-only delete, max runs and expiry.
- [ ] **JD-MA-029** Schedule: cron job that starts a new agent, with pause/resume/update/run-once/logs and archive-on-finish.
- [ ] **JD-MA-030** Autonomous mode: self-reprompt with done-items memory, result marker, idle back-off, and the five safety caps.

---

## 6. Skills

### 6.1 Model

A skill is a standard folder `<name>/SKILL.md` with `name` and `description` front matter. JAgentDesk does not inject skill text into prompts; it installs folders where each provider CLI already looks and asks the provider to load them (`P/native-skills.ts:3-13`, `docs/skills.md:3-6`).

```ts
export const SkillEntrySchema = z.object({
  skillId: z.string(),                 // "<scope>:<dir label>:<directory name>"
  name: z.string(), description: z.string(),
  scope: SkillScopeSchema,             // "global" | "project"
  projectRoot: z.string().nullable(),
  dir: SkillDirLabelSchema.nullable(),
  realPath: z.string(),
  links: z.array(SkillLinkSchema),
  visibleTo: z.array(z.string()),      // provider ids that can see it
  owned: z.boolean(), enabled: z.boolean(),
  status: z.enum(["ok", "invalid"]), invalidReason: z.string().nullable(),
  source: SkillSourceInfoSchema,       // kind: github|npm|authored|migrated|fork|local|provider-runtime; ref; revision
  hasScripts: z.boolean(),
  contentHash: z.string().nullable().optional(),
  training: SkillTrainingSchema.nullable(),   // lessons, approvals, runs, xp, consecutiveApprovals, status: training|graduated
  legacyId: z.string().nullable(),
});
```

(`P/native-skills.ts:55-110`.) Name rule: lowercase letters, digits, single hyphens, ≤ 64 chars; description ≤ 1024 (`:614-621`).

Scan directories, global and per project (`docs/skills.md:14-27`, Doc; labels in `P/native-skills.ts:15-26`): `.agents/skills`, `.claude/skills`, `.kiro/skills`, `.codex/skills`, opencode, copilot, cursor, pi, omp, kimi locations. Copies reached through different directories are de-duplicated by real path; same-name copies with separate files form a "family", and `contentHash` tells whether they differ.

### 6.2 Install, remove, enable, lock file

- Install writes one real copy to `.agents/skills/<name>` and symlinks it into `.claude/skills` and `.kiro/skills`. Every written path is recorded in `$JAGENTDESK_HOME/skills/lock.json`; uninstall removes exactly those paths. A directory JAgentDesk did not write is never overwritten (`P/native-skills.ts:6-10`, `docs/skills.md:33-39`).
- RPCs (`P/native-skills.ts`, names by grep): `skills.catalog.list`, `skills.catalog.get`, `skills.install { item, scope, cwd, rename? }`, `skills.uninstall { skillId, cwd, confirm? }` (confirm required for a skill JAgentDesk does not own; it is backed up first, `:374-381`), `skills.set_enabled`, `skills.author { skillId?, name, description, body, scope, cwd }`, `skills.learn { skillId, lesson, approved, agentId? }`, `skills.fork { skillId, name? }`, plus `skills.sources.*`.
- Error codes: `skill_name_conflict, skill_not_found, skill_not_owned, confirmation_required, invalid_skill, invalid_request, path_not_allowed, source_fetch_failed, catalog_item_not_found, source_not_found` (`:41-52`).
- Disabling a non-owned skill moves it aside reversibly (`docs/skills.md:38-39`, Doc).
- **Update from source**: no update RPC and no "update available" flag were found (grep for update/outdated/reinstall in `S/skills-native`, `A/skills`, `P/native-skills.ts`). The lock records `revision`, but an update flow is **UNVERIFIED** / likely absent; reinstalling is the apparent path.

### 6.3 Sources

`$JAGENTDESK_HOME/skills/sources.json`; when missing, the official `anthropics/skills` and `openai/skills` repositories (`P/native-skills.ts:117`). Kinds (`:118-131`): `github` (repo, optional ref and sub-path; listed with one tree call and front matter only, pinned to the resolved commit), `npm` (package; listed from registry metadata), `index` (https URL to a JSON index), `local` (absolute folder on the daemon host). Listing reads metadata only; install downloads only the chosen skill (npm downloads the tarball). Sources are cached and refreshed in the background. Claude and Codex plugin marketplaces already added on the host are listed through the provider CLI. One searchable directory host is supported (`skillsmp.com`), 20 results per page, cached 10 minutes, with an optional API key stored in `$JAGENTDESK_HOME/skills/credentials.json` (mode 0600) (`docs/skills.md:43-66`, Doc).

### 6.4 Invocation rewriting

A send with `skillIds` is rewritten for the agent's provider by `buildSkillInvocationLine` (`P/native-skills.ts:601-612`):

| Provider | First skill | Other skills |
| --- | --- | --- |
| Claude, Cursor, Copilot, Kiro | `/name` | sentence "Before you answer, load these skills: …" on the next line |
| Codex | `$name` | further `$name` on the same line |
| Pi, Oh My Pi, Kimi | `/skill:name` | sentence |
| OpenCode, generic ACP | — | one sentence for all |

Only the first skill can be a leading command. The same rewrite applies to `send_agent_prompt` (its `skillIds` input) and to `jagentdesk agent send --skill` (`docs/skills.md:80-81`, Doc; table rows from the doc, function structure from code).

### 6.5 Skills screen and composer attach

Screen (`A/screens/skills-screen.tsx`, strings `en.ts:2500-2560`): title "Skills", subtitle "One list of skills for every agent provider: install, enable, create and train them.", button "Create skill", tabs "Installed (N)" and "Browse", a project picker ("Global only" / "Choose a project"). Installed filters: search, "Visible to" (provider), "Scope", "Source", "Installed by" (JAgentDesk / Other). Badges: JAgentDesk, Disabled, Invalid, Has scripts, Plugin, Skill, Installed, Graduated, Training. Row actions include enable, Details, "Copy folder path", Train, Fork. Offline: "Connect to a host to manage skills." Editor sheet for authoring (`A/skills/ui/skill-editor-sheet.tsx`), sources sheet (`sources-sheet.tsx`), catalogue item sheet with install scope picker.

Composer attach: section 2.6. Selections can also be saved server-side (`agent.skills.save_selection.request`, name by grep; body not read).

### 6.6 Agent tools and training

- `create_skill { name (≤ 64, normalised to the name rule), description, instructions, … }` creates an owned skill folder that all providers load; `update_skill { id, instructions?, description? }` edits an owned skill, keeps learned lessons, cannot rename, and is auto-approved (`S/agent/tools/jagentdesk-tools.ts:3094-3194`).
- Training: approving a lesson writes it into a lessons section of the skill's `SKILL.md`; training a non-owned skill forks it first (`docs/skills.md:85-88`, Doc). XP / graduation thresholds were not read. **UNVERIFIED**.

### 6.7 Bundled skills

Repo folder `skills/`: `jagentdesk` (base orchestration skill), `jagentdesk-loop`, `jagentdesk-advisor`, `jagentdesk-committee`, `jagentdesk-handoff`. They are installed by the **desktop app** into the agents/claude/codex skill directories (`packages/desktop/src/integrations/skills/operations.ts:30-56`), with a selection store so the user can choose which to install (`selection-store.ts`). That file lists these five names as "predecessor" names kept only for cleanup, so the currently shipped bundle may use different names. **UNVERIFIED** which names ship today.

### What a faithful reproduction must include

- [ ] **JD-SKL-001** Skills are plain `<name>/SKILL.md` folders; never injected as prompt text.
- [ ] **JD-SKL-002** Scan of provider skill directories, global and per project, reporting which providers see each skill.
- [ ] **JD-SKL-003** De-duplication by real path and grouping of same-name copies into families with a content hash.
- [ ] **JD-SKL-004** Install = one real copy plus symlinks, at global or project scope, with optional rename on name conflict.
- [ ] **JD-SKL-005** Lock file of every written path; uninstall removes only those; foreign directories never overwritten.
- [ ] **JD-SKL-006** Removing a non-owned skill needs explicit confirmation and makes a backup; disabling one is reversible.
- [ ] **JD-SKL-007** Four source kinds (github, npm, index, local) with metadata-only listing and per-skill download.
- [ ] **JD-SKL-008** Default official sources when no source file exists; add/remove/enable sources.
- [ ] **JD-SKL-009** Per-provider invocation rewrite for attached skills (slash, dollar, `/skill:`, sentence).
- [ ] **JD-SKL-010** Skills attached to a turn travel as ids, from the composer and from agent-to-agent prompts.
- [ ] **JD-SKL-011** Skills screen with Installed and Browse tabs, project picker, filters (provider, scope, source, owner), badges.
- [ ] **JD-SKL-012** Create and edit owned skills in the app; fork a non-owned skill into an owned copy.
- [ ] **JD-SKL-013** Agent tools to create and update owned skills.
- [ ] **JD-SKL-014** Typed error codes for conflict, not owned, confirmation required, invalid, fetch failed.
- [ ] **JD-SKL-015** Training: approved lessons appended to the skill file, with training/graduated status.
- [ ] **JD-SKL-016** Bundled orchestration skills installed by the desktop app with a user selection.

---

## 7. Usage

### 7.1 Provider plan usage

Fetch-on-demand: the app calls `provider.usage.list.request` when a usage surface is shown; the daemon caches the combined result for 5 minutes and de-duplicates concurrent calls (`packages/server/src/services/quota-fetcher/service.ts:15`, `:35-58`). A failing fetcher yields an "unavailable" row, not a failed request (`:60-75`).

Fetchers exist for `claude, codex, copilot, cursor, zai, grok, kimi, minimax` (`.../quota-fetcher/manifest.ts:15-55`). Each reads the vendor CLI's local credentials (section 1.10) and calls a vendor endpoint: Claude `https://api.anthropic.com/api/oauth/usage` (`claude.ts:469`), Codex `https://chatgpt.com/backend-api/wham/usage` (`codex.ts:228`), Copilot `https://api.github.com/copilot_internal/user` (`copilot.ts:63`), Cursor a dashboard usage endpoint (`cursor.ts:132`).

Normalised shape (`P/messages.ts:7243-7287`):

```ts
export const ProviderUsageWindowSchema = z.object({
  id: z.string(), label: z.string(),
  usedPct: z.number().nullable().optional(), remainingPct: z.number().nullable().optional(),
  resetsAt: z.string().nullable().optional(), runsOutAt: z.string().nullable().optional(),
  shortfallPct: z.number().nullable().optional(), tone: ProviderUsageToneSchema.optional(),
});
export const ProviderUsageBalanceSchema = z.object({
  id: z.string(), label: z.string(),
  used: z.number().nullable().optional(), remaining: z.number().nullable().optional(), limit: z.number().nullable().optional(),
  unit: z.enum(["usd", "credits", "requests", "tokens"]),
  resetsAt: z.string().nullable().optional(), tone: ProviderUsageToneSchema.optional(),
});
export const ProviderUsageSchema = z.object({
  providerId: z.string(), displayName: z.string(),
  status: ProviderUsageStatusSchema,          // available | unavailable | error
  planLabel: z.string().nullable(), sourceLabel: z.string().nullable().optional(),
  fetchedAt: z.string().nullable().optional(), nextRefreshAt: z.string().nullable().optional(),
  windows: z.array(ProviderUsageWindowSchema),
  balances: z.array(ProviderUsageBalanceSchema).optional(),
  details: z.array(ProviderUsageDetailSchema).optional(),
  error: z.string().nullable().optional(),
});
```

What is shown per provider: plan label; windows such as Claude "Session" (5-hour) and "Weekly" plus an "Extra usage" balance (`claude.ts:126-127`, `:392`), Codex "Session", "Weekly", "Code review" and a "Credits" balance (`codex.ts:144-178`), Copilot plan and a "Quota reset" detail (`copilot.ts:83-90`), Cursor "Plan usage" (`cursor.ts:158`). Tone `default | ok | warning | danger` colours the bars. The UI is generic: window bars and balance bars, no provider-specific renderer (`A/provider-usage/window-bar.tsx`, `balance-bar.tsx`, `card.tsx`).

UI locations:

- Host settings → usage section titled "Plan usage" with Refresh, states "Loading usage...", "No usage data", "Unable to load usage", "Connect to this host to see provider usage", "Update the host to see provider usage" (`A/provider-usage/copy.ts:7-17`, `settings-section.tsx`, mounted in `A/screens/settings/host-page.tsx`).
- The composer's context-window meter tooltip includes a plan-usage section for the active provider (`A/components/context-window-meter.tsx:7-8`, `:112`, `:236`).

### 7.2 Per-agent usage

- Per turn: `AgentUsage { inputTokens?, cachedInputTokens?, outputTokens?, totalCostUsd?, contextWindowMaxTokens?, contextWindowUsedTokens? }` on `turn_completed` and `usage_updated` events (`P/agent-types.ts:175-182`). `lastUsage` drives the context-window meter (percentage label, `context-window-meter.tsx:215`).
- Cumulative: `AgentUsageTotals { inputTokens, cachedInputTokens, outputTokens, totalCostUsd, turns }`, persisted with the agent, only ever grows (`P/agent-types.ts:190-196`). Added on turn completed **and** on cancelled/failed turns using the partial usage streamed so far (`S/agent/agent-manager.ts:4410-4431`, `:4463`, `:4513`, `:4562`). Totals survive a provider switch (3.2).
- Cost is whatever the provider reports; subscription plans often report 0 (`A/insights/use-usage-insights.ts:48`).

### 7.3 Usage history and insights

- Daemon time series: one rollup per **local** calendar day with a per-model breakdown, plus a lifetime total that does not shrink when agents are deleted (`P/usage-history.ts:9-36`). RPCs `UsageHistoryGet` / `UsageHistoryReset` (`P/messages.ts:38-41`; exact type strings not copied). Each billed turn is recorded with timestamp, provider, model (`S/agent/agent-manager.ts:4432-4438`).
- Insights screen (`A/screens/insights-screen.tsx`, `A/insights/`): totals (input, cached, output, total tokens, cost), average per agent, by-model table, top agents, active context usage, a usage timeline card, and an estimate of cache savings from a built-in price table (`A/insights/token-pricing.ts:51-98`). Deliberately absent: per-tool cost (`use-usage-insights.ts:14-16`). The header comment there says the daemon keeps no usage history, which predates `usage-history.ts`; the timeline card uses the history hook (`A/insights/use-usage-history.ts`). Exact screen layout **UNVERIFIED** (labels not read).

### What a faithful reproduction must include

- [ ] **JD-USE-001** On-demand plan-usage request with a 5-minute daemon cache and in-flight de-duplication.
- [ ] **JD-USE-002** Provider-agnostic usage shape: status, plan label, windows (used/remaining %, reset time, tone), balances (unit), detail rows.
- [ ] **JD-USE-003** Per-provider fetchers that read the vendor CLI's own credentials read-only and degrade to "unavailable".
- [ ] **JD-USE-004** Generic window bar and balance bar rendering; no provider-specific UI.
- [ ] **JD-USE-005** Plan-usage section in host settings with refresh and the listed states.
- [ ] **JD-USE-006** Plan usage for the active provider inside the composer's context-meter tooltip.
- [ ] **JD-USE-007** Context-window meter from the last turn's used/max tokens.
- [ ] **JD-USE-008** Per-agent cumulative totals (input, cached input, output, cost, turns), persisted, counting interrupted turns.
- [ ] **JD-USE-009** Daily usage rollups by local day with per-model breakdown and a deletion-proof lifetime total.
- [ ] **JD-USE-010** Insights screen: totals, by model, top agents, active context, timeline.
- [ ] **JD-USE-011** Cost shown only when a provider reports it; cache-savings estimate labelled as an estimate.
- [ ] **JD-USE-012** Usage history reset action.

---

## 8. Terminal

### 8.1 Architecture

Pipeline (`docs/terminal-performance.md:7-16`, Doc): node-pty in a forked **worker process** → headless xterm in the worker (for snapshots) → output coalescer (≤ 1 IPC message per 5 ms per terminal) → daemon main process → per-client coalescer → binary WebSocket frame → client emulator → xterm.

- Worker headless terminal scrollback: 1000 lines (`packages/server/src/terminal/terminal.ts:848`). Client scrollback is a user setting (`terminalScrollbackLines`, `A/components/terminal-pane.tsx:1061`). Restore sends the visible screen plus 200 scrollback lines by default (`packages/server/src/terminal/terminal-restore.ts:19`).
- Binary stream opcodes: `Output 0x01, Input 0x02, Resize 0x03, Snapshot 0x04, Restore 0x05`; first byte is the opcode (`P/binary-frames/terminal.ts:10-16`, `:72`, `:82`). The performance doc describes a 2-byte header; the second byte was not read. **UNVERIFIED**.
- Backpressure: a stream falls back to a full snapshot only when more than 256 KB of output accumulated since the last snapshot **and** the client socket has more than 4 MB buffered (Doc).
- Size ownership: one claimant per terminal. Focus or direct interaction sends a `claim`; later geometry changes from the same connection send `update`; updates from other connections are ignored (`packages/server/src/terminal/terminal-size-ownership.ts`, Doc). Initial size 80×24 unless the create request passes one (`P/messages.ts:3566-3575`).
- Terminals are runtime-only: not persisted across daemon restarts (`docs/data-model.md:168` heading "Runtime-only Terminal Sessions"; section body not read).

### 8.2 Create, kill, list, rename

RPCs: `create_terminal_request { cwd, workspaceId?, name?, agentId?, command?, args?, size? }`, `kill_terminal_request`, `list_terminals_request`, `subscribe_terminals_request` (+ push `terminals_changed`), `subscribe_terminal_request` / `unsubscribe_terminal_request`, `terminal_input`, `capture_terminal_request`, `terminal.rename.request`, pushes `terminal_stream_exit`, `terminal_attention_required` (`P/messages.ts:3558-3580`, names by grep). All terminal mutations require the `workspace.write` permission class (`S/authorization/operation-permissions.ts:62`, `:169`, `:245-246`).

A terminal belongs to the workspace that created it and is listed only there, even if another workspace shares the cwd (`docs/terminal-activity.md:36`, Doc). In the UI a terminal is a workspace tab (kind `terminal`).

### 8.3 Terminal profiles

```ts
export const TerminalProfileSchema = z.object({
  id: z.string(), name: z.string(), command: z.string(),
  args: z.array(z.string()).optional(), icon: z.string().optional(),
}).passthrough();
```

(`P/messages.ts:297-305`.) Stored in daemon config `daemon.terminalProfiles`; edited in host settings (`A/screens/settings/terminal-profile-edit-modal.tsx`, `host-page.tsx`); offered when opening a new terminal from the tab row (`A/screens/workspace/workspace-desktop-tabs-row.tsx`). A profile launches `command args` instead of the default shell. Per-repo `jagentdesk.json` can also declare `worktree.terminals` (`jagentdesk-reference.md` 4.3; behaviour not read, **UNVERIFIED**).

### 8.4 Shell integration

zsh only (`packages/server/src/terminal/shell-integration/zsh/jagentdesk-integration.zsh`): the daemon points `ZDOTDIR` at a generated directory and keeps the user's original in `JAGENTDESK_ZSH_ZDOTDIR` (`terminal.ts:426-430`). Hooks emit OSC 633 marks — `A` prompt start, `B`/`C` command start, `D;<exit code>` command end — and set the window title to the cwd (`~`-shortened) at the prompt and to the command line while it runs. Other shells run without integration.

### 8.5 Agent hooks and activity indicators

From `docs/terminal-activity.md` (Doc). Purpose: show a running/finished/needs-input dot on a terminal tab when an agent CLI runs inside a plain terminal.

- Each terminal shell gets `JAGENTDESK_TERMINAL_ID`, `JAGENTDESK_ACTIVITY_TOKEN`, `JAGENTDESK_TERMINAL_ACTIVITY_URL`, `JAGENTDESK_HOOK_CLI`.
- Hook command `jagentdesk hooks <agent> <event>` posts `{ terminalId, token, state }` to the daemon; any failure is a silent no-op.
- Mappings: Claude `UserPromptSubmit` → running; `Stop`/`StopFailure`/`SessionEnd` → idle; idle-prompt `Notification` → needs-input. Codex `UserPromptSubmit`/`PreToolUse`/`PostToolUse` → running; `PermissionRequest` → needs-input; `Stop` → idle. OpenCode via a generated plugin listening to session status and permission events.
- `working → idle` records "finished" attention (green dot) and sends a "Terminal finished" notification; focusing the terminal on a visible client clears it.
- Installing hooks edits the user's agent config files, so it is opt-in: host setting "Enable terminal agent hooks" (`daemon.enableTerminalAgentHooks`, default false). Enable installs marker-tagged hooks into `~/.claude/settings.json`, `~/.codex/hooks.json`, and an OpenCode plugin file; disable removes only JAgentDesk's own.

### 8.6 Mobile terminal

Native has two renderers (`A/components/terminal-emulator.native.tsx:5-40`): a **native grid** renderer (default; headless terminal state drawn as native rows — `A/terminal/native-renderer/`, with its own selection gesture, key events, resize policy, custom glyphs) and a **WebView** renderer running xterm in a web view (`A/terminal/webview/`), selected by the app setting `useLegacyTerminalRenderer`. Shared runtime pieces: virtual keyboard row, paste handling, key dispatch, find-in-terminal (`A/terminal/find/`), clickable local file links (`A/terminal/local-links/`), file drop into the terminal (`A/terminal/drop/`).

### 8.7 Terminal tools for agents

(`S/agent/tools/jagentdesk-tools.ts:5281-5478`.)

- `list_terminals { cwd?, all? }`.
- `create_terminal { cwd?, name? … }` — "Create a terminal session for a working directory"; the terminal is attached to the caller agent's workspace, a workspace is created for the cwd only when the caller has none (`:3553-3560`).
- `kill_terminal { terminalId }`.
- `capture_terminal { terminalId, start?, end?, scrollback?, stripAnsi = true }` → `{ lines, totalLines }`.
- `send_terminal_keys { terminalId, keys, literal? }` — literal text or special key tokens.

No ownership check between an agent and the terminals it can read or type into was found in the parts read. **UNVERIFIED**. Guests of a shared session can be granted read-only terminal viewing (2.9).

### What a faithful reproduction must include

- [ ] **JD-TRM-001** PTYs in a separate worker process with a headless emulator for snapshots.
- [ ] **JD-TRM-002** Leading+trailing output coalescing (~5 ms) before IPC and per client.
- [ ] **JD-TRM-003** Binary frames with opcodes output / input / resize / snapshot / restore.
- [ ] **JD-TRM-004** Snapshot fallback gated on both output volume (256 KB) and client buffer (4 MB).
- [ ] **JD-TRM-005** Single size claimant per terminal (claim on focus, update only from the claimant).
- [ ] **JD-TRM-006** Scrollback: 1000 lines server-side, client setting for display, 200-line restore.
- [ ] **JD-TRM-007** Create (cwd, optional name/command/args/size), kill, list, rename, subscribe; terminal scoped to the creating workspace.
- [ ] **JD-TRM-008** Terminals are workspace tabs and are not persisted across daemon restarts.
- [ ] **JD-TRM-009** Terminal profiles (name, command, args, icon) in host settings, selectable for new terminals.
- [ ] **JD-TRM-010** zsh shell integration with prompt/command/exit-code marks and title updates.
- [ ] **JD-TRM-011** Opt-in agent hooks that report running / idle / needs-input for agent CLIs in terminals.
- [ ] **JD-TRM-012** Terminal activity dot and "finished" attention cleared on focus, with a notification.
- [ ] **JD-TRM-013** Mobile: native grid renderer by default, WebView renderer as a fallback setting, virtual key row.
- [ ] **JD-TRM-014** Find, clickable local file links, paste and file drop in the terminal.
- [ ] **JD-TRM-015** Agent tools: list, create, kill, capture (range, scrollback, ANSI strip), send keys.
- [ ] **JD-TRM-016** Terminal mutations require write permission; shared-session guests get read-only viewing only when granted.

---

## 9. Workspace / project model

### 9.1 Concepts

(`docs/glossary.md`, `docs/data-model.md:3-36`, `:492-560`, Doc; schemas in `P/messages.ts`.)

- **Project**: an exact selected root directory on one host. Id `prj_<16 hex>`; `rootPath` normalised lexically, never realpathed; `kind: git | non_git` (mutable observation); `displayName` (basename), `customName`, custom icon; `projectKey` groups the same logical project across hosts; soft delete by `archivedAt`. File `$JAGENTDESK_HOME/projects/projects.json`.
- **Workspace**: one execution `cwd` inside one project. Id `wks_<hex>`, opaque, never a path. Fields `projectId, cwd, kind: local_checkout | worktree | directory, displayName, title (user override), branch, worktreeRoot, baseBranch, isJAgentDeskOwnedWorktree, mainRepoRoot, archivedAt, pinnedAt, autoArchivedChangeRequestUrl`. File `$JAGENTDESK_HOME/projects/workspaces.json`. Several workspaces may share one directory.
- **Isolation** is a create-time choice (`Local` / `New worktree`), remembered as a form preference, not stored on the workspace.
- State split: git status, diff, file tree are keyed by `(host, cwd)` and shared by same-cwd workspaces; tabs, agents, terminals, panes, title, review drafts, attachments and explorer expand state are per workspace.

### 9.2 Creating workspaces and worktrees

`workspace.create.request` always creates a fresh workspace (never de-duplicates by directory) (`P/messages.ts:3304-3339`):

```ts
source: z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("directory"), path: z.string(), projectId: z.string().optional() }),
  z.object({
    kind: z.literal("worktree"),
    cwd: z.string().optional(), projectId: z.string().optional(),
    action: z.enum(["branch-off", "checkout"]).optional(),
    refName: z.string().min(1).optional(), baseBranch: z.string().optional(),
    branchName: z.string().min(1).optional(),
    checkoutSource: ChangeRequestCheckoutSourceSchema.optional(),
    worktreeSlug: z.string().optional(),
  }),
]),
```

Three worktree shapes (CLI flags in `public-docs/worktrees.md`, Doc): **branch-off** (new branch from a base), **checkout-branch** (existing branch), **checkout-pr** (a pull/merge request, forge inferred or named). Worktrees live under `$JAGENTDESK_HOME/worktrees/<hash of source path>/<slug>/`, root configurable with `worktrees.root`. A managed worktree is removed after its **last** referencing workspace is archived.

New-workspace screen (`en.ts:1125-1153`): title "New workspace"; "Isolation" control (Local / New worktree); fields "Project" and "Base" ("Not applicable" for local); "Title (optional)"; a ref picker "Start from" with search "Search branches and PRs"; a composer for the first prompt (errors "Select a model", "Failed to create worktree", "Host is not connected"); button "Create". The first prompt can drive workspace name and branch generation (`firstAgentContext`). A workspace can also be created with no agent.

Open-project start tiles (`en.ts:1293-1312`): "Add a project — Open a folder on your machine", "Import session", "Setup providers", "Pair device". Project RPCs: `project.add`, `project.create_directory`, `project.github.clone`, `project.list`, `project.remove`, `project.rename`, `project.icon.get/set`, plus `open_project_request` (names by grep; bodies not read).

### 9.3 Per-repo config file

`jagentdesk.json` at the repo root, read from the **committed version on the chosen base branch** (`public-docs/worktrees.md`, Doc):

- `worktree.setup` — runs once after the worktree is created, cwd = worktree; multi-line script or array, sequential; `$JAGENTDESK_SOURCE_CHECKOUT_PATH` points at the original checkout. Progress is pushed as `workspace_setup_progress` and shown in a "setup" tab (`A/workspace-tabs/model.ts:43`).
- `worktree.teardown` — runs during archive, before the directory is removed.
- `scripts.<name> = { command, type?: "service", port? }` — plain scripts run on demand; services are supervised long-running processes with an assigned port in `$JAGENTDESK_PORT` and a reverse-proxy URL `http://<script>--<branch>--<project>.localhost:<daemon-port>` (branch label dropped on the default branch; WebSocket upgrades supported).
- `worktree.servicePorts` — `{ range: "3000-4000" }` or `{ portScript: <executable> }` (called with script name, workspace id, branch, worktree path; must print one port); a project block replaces the global `worktrees.servicePorts`; an explicit `port` always wins.
- The app can read and write this file (`read_project_config_request`, `write_project_config_request`) with a stale-write guard ("Config changed on disk").
- Run surfaces: a scripts button in the workspace header (`A/screens/workspace/workspace-scripts-button.tsx`), RPCs `workspace.script.list/start/stop`, agent tools `list_workspace_scripts`, `start_workspace_script`, `stop_workspace_script`.

### 9.4 Workspace screen layout

- Tab kinds (`A/workspace-tabs/model.ts:34-44`): `draft` (new-agent composer), `agent`, `provider_subagent` (read-only), `terminal`, `browser`, file tab, `working_diff`, `plugin`, `setup`, `commit_diff`.
- Desktop: left sidebar (projects → workspaces), centre tab area with split panes (tab layout per workspace, per client), right **explorer** sidebar with two tabs "Changes" and "Files" (`en.ts:589-595`), optional orchestration agents column (4.9).
- Compact: three mutually exclusive destinations — agent list (left), agent (centre), file explorer (right) — driven by one gesture position; selection is not persisted and a cold start opens the agent (`docs/mobile-panels.md:3-23`, Doc).
- Tab layout is per client; archive is global (5.3).

### 9.5 Files

- Explorer tree from `file_explorer_request`; file content subscriptions `fs.file.subscribe/unsubscribe` with pushed `fs.file.update` (live reload).
- Viewing: file tab with preview; HTML preview; states "Loading file...", "No preview available", "Binary preview unavailable", "Failed to load file" (`en.ts:1629-1636`).
- **Editing exists**: `fs.file.write.request { cwd, path, content, expectedModifiedAt, expectedRevision? }` (`P/messages.ts:3447-3455`), used by the file pane editor (`A/file-pane/pane.tsx:645`) when the host advertises the feature (`:456`), with a conflict alert when the file changed underneath (`A/file-pane/conflict-alert.tsx`). Editor component under `A/file-pane/editor/` (not read).
- Upload (`file.upload.request`) and tokenised download (`file_download_token_request`).
- "Open in editor" / file manager buttons on desktop (`A/screens/workspace/workspace-open-in-editor-button.tsx`, `A/workspace/open-in-file-manager/`).

### 9.6 Changes, diff, git

- Changes view: working-tree diff against the base, pushed live (`subscribe_checkout_diff_request` → `checkout_diff_update`); tree or flat file list, per-file headers, a "too large" state (`A/git/diff-pane.tsx`, `diff-tree.ts`, `diff-too-large-state.tsx`). Commits section with per-commit file diffs (`checkout.commits.list`, `checkout.commits.file_diff`; tab kind `commit_diff`).
- Review comments on diffs can be attached to a prompt as a review attachment (`A/review/`).
- Git actions split button (`A/git/actions-split-button.tsx`, labels `en.ts:692-752`): Commit, Pull, Push, Pull and push, Create PR/MR, View PR/MR, Merge PR (squash / merge / rebase), Merge locally, Update from <base>, Archive workspace — each with pending and success labels. RPCs: `checkout_commit_request`, `checkout_pull_request`, `checkout_push_request`, `checkout_merge_request`, `checkout_merge_from_base_request`, `checkout_pr_create_request`, `checkout_pr_merge_request`, `checkout_pr_status_request`, `checkout_switch_branch_request`, `checkout.rename_branch`, `checkout.discard_changes`, `checkout.refresh`, forge check details and auto-merge.
- Branch switcher (`A/components/branch-switcher.tsx`). Commit messages, branch names, titles and PR text are generated by a configurable provider/model (`agents.metadataGeneration`, `jagentdesk.json` `metadataGeneration`).
- Auto-archive after merge: `daemon.autoArchiveAfterMerge` config and `autoArchivedChangeRequestUrl` on the workspace (behaviour not read, **UNVERIFIED**).

### 9.7 Archive, pin, labels, recovery

- "Archive workspace" archives everything it owns; ordinary directories are left on disk; an owned worktree is removed when no active workspace references it (`docs/glossary.md`, Doc). RPC `archive_workspace_request`; agent tool `archive_workspace`.
- Pin to top of sidebar: `workspace.pin.set.request`, `pinnedAt`.
- User title: `workspace.title.set.request`; agent tool `rename_workspace`.
- Workspace labels: `workspace.label.list/update/delete/assignment.set` (bodies not read).
- Recovery: `workspace.recovery.inspect/restore` restores an archived workspace, recreating a worktree from `mainRepoRoot` and optionally un-archiving the selected agent in one action (`docs/agent-lifecycle.md:74-83`, Doc).
- Attention: `workspace.clear_attention.request`.

### 9.8 How agents bind

An agent has both `workspaceId` and `cwd`. Ownership and visibility come from `workspaceId`, never from `cwd` (`docs/agent-lifecycle.md:38`, Doc). Agent storage on disk is keyed by cwd (`$JAGENTDESK_HOME/agents/{cwd-with-dashes}/{agent-id}.json`). An agent can be created with a `worktree` target so the workspace and worktree are made in the same request (`CreateAgentRequest.worktree`, `jagentdesk-reference.md` 3.3).

### What a faithful reproduction must include

- [ ] **JD-WS-001** Project = exact selected root with opaque id, display name, custom name and icon, soft delete.
- [ ] **JD-WS-002** Workspace = opaque id + exact cwd + project membership + kind + branch + base + worktree ownership + pinned/archived timestamps.
- [ ] **JD-WS-003** Several workspaces may share a directory; directory-backed state shared, workspace-owned state separate.
- [ ] **JD-WS-004** Create workspace from an existing directory (Local) or a managed worktree (New worktree); creation never de-duplicates.
- [ ] **JD-WS-005** Worktree shapes: branch-off from base, check out existing branch, check out a PR/MR.
- [ ] **JD-WS-006** Managed worktree location by source-path hash and slug; removed after the last referencing workspace is archived.
- [ ] **JD-WS-007** New-workspace screen: isolation, project, base/ref picker with branch and PR search, optional title, first-prompt composer.
- [ ] **JD-WS-008** Workspace can exist with no agent; first prompt can name the workspace and branch.
- [ ] **JD-WS-009** Per-repo config read from the committed base branch: setup, teardown, scripts, services, port policy.
- [ ] **JD-WS-010** Setup runs once after worktree creation with progress shown in a setup tab; teardown runs on archive.
- [ ] **JD-WS-011** Services supervised with an assigned port variable and a deterministic local proxy hostname.
- [ ] **JD-WS-012** Scripts runnable from the workspace header, CLI, and agent tools.
- [ ] **JD-WS-013** Tab kinds: draft, agent, read-only subagent, terminal, browser, file, working diff, commit diff, setup, plugin.
- [ ] **JD-WS-014** Split panes with per-client tab layout.
- [ ] **JD-WS-015** Explorer sidebar with "Changes" and "Files" tabs.
- [ ] **JD-WS-016** Compact layout with three exclusive destinations (list / agent / explorer).
- [ ] **JD-WS-017** File viewing with live reload, binary and error states, HTML preview.
- [ ] **JD-WS-018** File editing with optimistic concurrency and a conflict alert, host-feature gated.
- [ ] **JD-WS-019** Live working diff against base, tree/flat list, too-large state, commit list with per-commit diffs.
- [ ] **JD-WS-020** Git actions: commit, pull, push, pull-and-push, create/view/merge PR (three strategies), merge locally, update from base, switch/rename branch, discard changes.
- [ ] **JD-WS-021** Archive workspace (global, owns its agents and terminals), pin, rename, labels.
- [ ] **JD-WS-022** Recovery of an archived workspace including worktree re-creation and optional agent un-archive.
- [ ] **JD-WS-023** Agents bind by workspace id; cwd is execution directory only; agent creation can create the worktree in the same request.
- [ ] **JD-WS-024** Open-project start tiles (add project, import session, setup providers, pair device) and project add / create directory / clone.

---

## 10. Other agent-area features a "like JAgentDesk" request would reasonably include

Listed briefly; none of these bodies were read for this file unless a section above cites them.

| Feature | Where |
| --- | --- |
| Permission cards in the stream (tool / plan / question / mode), answerable from any device, cleared on all | `A/agent-stream/view.tsx`, `A/components/plan-card.tsx`, `A/components/question-form-card.tsx`; wire in `jagentdesk-reference.md` 3.5 |
| Attachments: images, uploaded files, text, forge issue / PR / MR, review comments, chat history, browser element; attachment tray; drag and paste | `A/composer/attachments/`, `A/attachments/`, strings `en.ts:139-159` |
| Slash commands: provider commands from `listCommands`, client commands `/exit` `/clear` `/orc`, `@file` autocomplete | `A/client-slash-commands/index.ts`, `en.ts:1343` (`agentAutocomplete`) |
| Dictation and realtime voice mode | `jagentdesk-reference.md` 3.7 |
| Timeline search, prompt list, chat find, chat outline, pane find | `A/agent-stream/chat-find/`, `chat-outline/`, `A/pane-find/`, RPCs `agent.timeline.search`, `agent.timeline.list_prompts` |
| Tool-call rendering with normalised details and grouped tool calls | `A/tool-calls/`, `S/agent/providers/tool-call-detail-primitives.ts` |
| Agent attention and push notifications (finished / error / permission), routed by client focus | `S/agent-attention-policy.ts`, `S/push/` |
| History screen for archived agents and workspaces, unarchive | `docs/agent-lifecycle.md:74-83` |
| Title, branch-name, commit-message and PR-text generation by a chosen provider/model | `S/agent/structured-generation-providers.ts`, `public-docs/metadata-generation.md` |
| Daemon-wide appended system prompt and operator context | config keys `daemon.appendSystemPrompt`, `daemon.operatorContext` |
| Command centre (keyboard palette for model / mode / thinking / feature actions) | `A/command-center/agent-control-registration` (used at `A/composer/agent-controls/index.tsx:1631`) |
| Artifacts ("Canvas") produced by agents | `A/artifacts/` |
| Agentic browser tab and browser tools | `S/browser-tools`, `docs/agentic-browser.md` |
| Plugins contributing providers, panels, timeline items | `packages/plugin`, `docs/plugins.md` |
| CLI parity: `jagentdesk run / ls / logs / wait / send / stop / attach / detach / import / mode / inspect / reload / archive / delete` | `packages/cli/src/commands/agent/` |
| Bundled workflow skills: handoff, committee, advisor, loop | `skills/` |
| Agent reload (restart the session to pick up new tools/config) | `packages/cli/src/commands/agent/reload.ts`, `refresh_agent_request` |
| Host tools installer, docker, kubernetes, SQL, simulators, HTTP proxy tool families | `S/agent/tools/jagentdesk-tools.ts:681-2600` (dev-tool surfaces; not relevant to a video editor) |

---

## 11. UNVERIFIED list (consolidated)

1. Whether provider `order` changes list order anywhere (schema field with no consumer found).
2. Whether the app has a form for authoring `extends: <builtin>` profiles with `env`; only enable/remove/add-model/add-from-catalogue were seen.
3. `refreshSettingsSnapshot` body ("clear all scopes, refresh global only") — doc only.
4. Codex quota fetcher: whether it writes a refreshed OAuth token back to `auth.json`.
5. Composer queue: automatic drain when a turn finishes.
6. Orchestration settings: editors for route `fallbacks` and `guardProviderPrefix`.
7. Where `callerContext` (`lockedCwd`, `allowCustomCwd`, default child labels) is set for agent-created agents.
8. Ownership checks on agent-management and terminal tools (none seen in the parts read).
9. Skill update-from-source flow; XP and graduation thresholds for training; which bundled skill names currently ship.
10. Insights screen layout and labels; exact `usage history` RPC type strings.
11. Terminal binary frame second header byte; `worktree.terminals` behaviour in `jagentdesk.json`; persistence statement for terminals (heading only).
12. Auto-archive after merge behaviour; workspace labels behaviour; project add / clone / create-directory bodies.
13. File editor component internals (`A/file-pane/editor/`), rewind composer-restore body, `agent.skills.save_selection` body, Schedules screen body.
14. Everything marked "Doc" was taken from `docs/` or `public-docs/` and not re-derived; the repo is known to contain stale docs (see `jagentdesk-reference.md` 7.6), and one stale line was found here (provider config change does re-warm, 1.3 rule 6).
15. ACP "Auto Accept" rules, Pi/OMP specifics, OpenCode mode normalisation, and Claude model discovery from `settings.json` come from docs only.
16. All of section 10.

## 12. Id counts

| Area | Prefix | Count |
| --- | --- | --- |
| 1 Providers | JD-PRV | 20 |
| 2 Composer row | JD-CMP | 18 |
| 3 Mid-conversation | JD-MID | 18 |
| 4 Orchestration | JD-ORC | 24 |
| 5 Multi-agent | JD-MA | 30 |
| 6 Skills | JD-SKL | 16 |
| 7 Usage | JD-USE | 12 |
| 8 Terminal | JD-TRM | 16 |
| 9 Workspace | JD-WS | 24 |
| Total | | 178 |
