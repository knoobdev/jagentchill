## ADDED Requirements

### Requirement: ORC configuration store
The ORC configuration SHALL be a single document stored by the server in its host data store (`server-api.Host data store`) — not in the Gateway configuration, which receives only the projection of `orc-model-routing.Mapping onto Gateway agent and provider configuration` — with the shape `{version: 1, enabled, autoPrepareBrief, askWhenAmbiguous, roles: {<roleId>: RoleConfig}}` and a monotonically increasing `revision`. ORC owns roles, profiles and routes only: agent-tree and team limits live in `multi-agent-orchestration.Tree limits` and `multi-agent-orchestration.Team limits`, retries, budgets and approval thresholds in `generation-providers`, runtimes and endpoints in `agent-runtimes`. The document is read with `jagentchill.orc.config.get` (scope `jagentchill.config.read`) and changed with `jagentchill.orc.config.update {patch, removeRoleIds?, expectedRevision}` (scope `jagentchill.config.write`, which only the `admin` role holds) on channel P; an update whose `expectedRevision` differs from the stored revision MUST fail with `CONFLICT` and `details.currentRevision` and change nothing. Every successful update SHALL be sent as the targeted event `jagentchill.orc.config.changed {revision}` to subscribed connections holding `jagentchill.config.read` within 1 s. A device without the write scope receives `SCOPE_DENIED`. The document MUST NOT contain API keys or other secrets. Defaults: `enabled: true`, `autoPrepareBrief: true`, `askWhenAmbiguous: true`. [JAD] [NEW]

#### Scenario: Concurrent edits
- **WHEN** two devices load revision 12 and both submit an update
- **THEN** the first update succeeds with revision 13 and the second fails with `CONFLICT`
- **AND** the second device's settings page shows "Settings changed on another device" with a "Reload" button

#### Scenario: Change is pushed
- **WHEN** the desktop changes the default image profile
- **THEN** the phone's ORC settings and quick switch show the new default within 1 s

#### Scenario: Device without the write scope
- **WHEN** an `editor` device submits an update
- **THEN** the update fails with `SCOPE_DENIED` and the settings page shows its controls as read-only

### Requirement: Role catalogue
ORC SHALL define these built-in roles, each bound to one capability type that cannot be changed. **Coordination roles** (llm): `supervisor` (owns a team run's brief and acceptance), `lead` (plans, staffs and integrates) and `peer` (the default role of a worker with no more specific creative role) — the three tiers used by `multi-agent-orchestration.Team roles and tiers`. **Creative roles** (llm): `director`, `screenwriter`, `storyboard`, `editor`, `reviewer`. **Understanding roles**: `vision` (llm with image input), `translation` (llm or translation), `transcription` (transcription). **Generation roles**: `image` (image), `video` (video), `voice-tts` (tts), `voice-design` (voice-design), `music` (music), `sfx` (sfx), `lipsync` (lipsync). Built-in roles cannot be deleted; they can be disabled, except `director`, which is always enabled. A coordination role that has no profile of its own resolves through `director`'s routes, so that team runs work on a host where only `director` was configured. Each role has a localised label and a one-line description shown in the UI. [JAD JD-ORC-007] [NEW]

#### Scenario: Built-in roles are present
- **WHEN** ORC configuration is created on a fresh host
- **THEN** the 18 built-in roles exist with their capability types, including `supervisor`, `lead` and `peer`

#### Scenario: Coordination role without a profile
- **WHEN** a team run needs the `lead` role and `lead` has no profile
- **THEN** the lead is served by the `director` role's default route and the assignment row states "using Director's model"

#### Scenario: Deleting a built-in role
- **WHEN** an update lists `image` in `removeRoleIds`
- **THEN** the update fails with `ROLE_PROTECTED` and nothing changes

#### Scenario: Disabling the director
- **WHEN** an update sets `roles.director.enabled` to false
- **THEN** the update fails with `ROLE_PROTECTED`

### Requirement: Custom roles
Users SHALL be able to add up to 20 custom roles, each with an id matching `^[a-z][a-z0-9-]{1,39}$` that does not collide with a built-in id, a label of 1–40 characters, a description of 0–200 characters, and a capability type chosen at creation from the capability types of `generation-providers.Provider registry by capability type`. The capability type is immutable after creation. A custom llm role is a creative role: it can be bound to a persona and used as the `orcRole` of a team role. A custom role is addressable by tools through their `role` parameter and by workflow nodes and film steps. Deleting a custom role that is referenced by a project or film override, a Team, a workflow or workflow template, a film setting or an automation SHALL be refused with `ROLE_IN_USE` listing the references. [JAD] [NEW]

#### Scenario: Add a custom image role
- **WHEN** the user creates the role `thumbnail` with capability `image` and one profile
- **THEN** `jc_generate_image {role: "thumbnail"}` routes through that role

#### Scenario: Role in use
- **WHEN** the user deletes a custom role that a workflow template references
- **THEN** deletion is refused with `ROLE_IN_USE` and the dialog lists the template

#### Scenario: Invalid id
- **WHEN** the id "Image 2" is entered
- **THEN** the form shows "Use lowercase letters, digits and hyphens, starting with a letter" and the role is not created

#### Scenario: Role limit
- **WHEN** 20 custom roles exist and the user adds another
- **THEN** the update fails with `VALIDATION_FAILED` stating the limit of 20

### Requirement: Role configuration schema
A `RoleConfig` SHALL have: `enabled` (boolean, default true), `label?`, `instructions?` (0–8,000 characters), `profiles[]` (1–12), `defaultProfileId` (must name an enabled profile of the role), `routes: {default: Route, <taskRouteId>: Route}`, and `limits`. A role whose only profiles are disabled or unusable is in state `not_configured`; requests routed to it fail with `NO_ROUTE`. [JAD]

#### Scenario: Default profile must exist
- **WHEN** an update sets `defaultProfileId` to an id that is not in `profiles`
- **THEN** the update fails with `VALIDATION_FAILED` and the issue path `roles.<id>.defaultProfileId`

#### Scenario: Role without a usable profile
- **WHEN** every profile of `video` is disabled
- **THEN** the role card shows "Not configured" and `jc_generate_video` fails with `NO_ROUTE`

### Requirement: Profile schema
A profile SHALL have: `id` (matching `^[a-z][a-z0-9-]{0,39}$`, unique within the role); `label?` (1–60 characters; when absent the UI shows "<provider label> · <model label>"); `runtime` (a runtime id of `agent-runtimes.Runtime model and the two access methods`; required for llm roles, default `builtin`; absent for generation roles, whose calls are made by the server's generation service); `provider` (a bundled provider id, or the id of an endpoint record of `agent-runtimes.Shared endpoint record` — the two id spaces are disjoint by that requirement's uniqueness rule); `model` (a model id of that provider or endpoint on that runtime); `thinking?` (one of the thinking options the model advertises on that runtime; llm roles only); `mode?` (a product mode id `ask` | `plan` | `edit` | `auto` that the runtime supports and that is not an unattended mode; llm roles only; the starting mode of sessions and agents created from this profile); `params` (an object of option values validated against the model's capability metadata — for example resolution, aspect ratio, duration, fps, audio on or off, voice id, speed, temperature, max output tokens — plus the reserved key `params.extraBody`); and `enabled` (default true). `params.extraBody` is a JSON object merged into the provider request body after the mapped options, for options a proxy, router or aggregator needs that the catalogue does not model: its serialised size is at most 8 KiB (8,192 bytes), it MUST NOT contain a key that the request mapping already sets (model, messages, prompt, stream, tools, credentials) or any header, and it is honoured only for providers and endpoints whose dialect accepts pass-through fields; elsewhere saving succeeds with the warning `extra_body_ignored`. Validation of `runtime`, `provider`, `model`, `thinking` and `mode` against the live snapshot, and the rule that a creative role accepts only runtimes that can use the server's `jc_*` tools (flag `jcTools`), are `agent-runtimes.Per-role defaults through ORC`. The same provider and model can appear in several profiles with different options — with one limit that comes from the Gateway: an agent has exactly one `params` object per `provider/model` (`agents.entries.<persona>.models["<provider>/<model>"].params`), so within one **llm role** two enabled profiles on the same runtime, provider and model MUST have identical `params` (including `params.extraBody`); an update that breaks this fails with `VALIDATION_FAILED` at the second profile's `params` and the message "Two profiles of one agent cannot send different options to the same model — use one profile, or a different model alias". Profiles of generation roles, whose requests the server makes itself, have no such limit. A bare model id without a provider MUST be rejected. [JAD] [NEW]

#### Scenario: Two profiles on one model
- **WHEN** the user creates profiles `fast` and `quality` on the same video model with resolutions 720p and 1080p
- **THEN** both are saved and selectable

#### Scenario: Two llm profiles with different options on one model
- **WHEN** an admin saves two enabled `director` profiles on the same runtime, provider and model, one with `temperature: 0.2` and one with `temperature: 0.9`
- **THEN** the update fails with `VALIDATION_FAILED` at the second profile's `params` with the stated message

#### Scenario: Profile on an endpoint
- **WHEN** an admin creates a `director` profile whose `provider` is the endpoint id `my-router` and whose `runtime` is `builtin`
- **THEN** the profile is saved and turns of that role are sent to that endpoint

#### Scenario: Extra body too large
- **WHEN** `params.extraBody` serialises to 9,000 bytes
- **THEN** the update fails with `VALIDATION_FAILED` at `roles.<id>.profiles.<n>.params.extraBody` stating the 8 KiB limit

#### Scenario: Extra body overrides a mapped field
- **WHEN** `params.extraBody` contains the key `model`
- **THEN** the update fails with `VALIDATION_FAILED` naming the key

#### Scenario: Unattended mode in a profile
- **WHEN** a profile sets `mode` to a runtime's unattended mode
- **THEN** the update fails with `VALIDATION_FAILED`

#### Scenario: Option not supported by the model
- **WHEN** a profile sets `resolution: "4K"` on a model whose resolutions are 720p and 1080p
- **THEN** the update fails with `VALIDATION_FAILED` and the message lists the allowed resolutions

#### Scenario: Thinking on a non-LLM profile
- **WHEN** `thinking` is set on an image profile
- **THEN** the update fails with `VALIDATION_FAILED`

### Requirement: Default profiles from the enabled catalogue
ORC MUST NOT ship hard-coded default model ids. When a role has no profile, and whenever a provider, endpoint or runtime becomes usable for the first time, ORC SHALL propose a default profile for each unconfigured role by choosing, among enabled models whose capability fits the role, the model flagged `recommended` for that capability in the catalogue, and otherwise the first model in catalogue order of the earliest-connected provider; unpriced, deprecated and deferred-delivery models are never chosen. For llm roles the proposed profile uses the runtime `builtin` and no `mode` (the product default mode applies); a CLI or ACP runtime is never proposed automatically. Proposed profiles get the id `default`, are written to the configuration, and are marked `source: "auto"` until the user edits them. A role with no fitting enabled model stays `not_configured`, with one exception that keeps two roles always routable: on every host the roles `music` and `sfx` have the built-in profile `library` on the provider `jc-sound-pack` (the bundled CC0 sound pack searched by keyword, `generation-providers.Provider registry by capability type`), marked `source: "auto"`, cost 0, usable offline (the agent tool `jc_generate_music` is the one caller that does not take this profile by itself: it uses it only when called with `source: "library"` and otherwise fails with a suggestion, owner decision E6, `agent-editing-tools.Voice, music and sound generation tools`); it is the default profile until a generative profile is added, stays in the route as the last fallback afterwards unless the admin removes it from the route, and cannot be deleted (it can be disabled). [NEW]

#### Scenario: First provider connected
- **WHEN** the user connects a provider that offers LLM and image models on a fresh host
- **THEN** every llm-capability role and the `image` role get a `default` profile on that provider, the llm ones with `runtime: "builtin"`
- **AND** `music` and `sfx` show the built-in "Sound library" profile, and `video`, `voice-tts` and the other roles remain "Not configured"

#### Scenario: Only a CLI runtime is available
- **WHEN** the only usable model source is a signed-in CLI runtime
- **THEN** no profile is proposed automatically and the ORC page shows "Choose a model for Director" with a link to the profile form

#### Scenario: User edits are not overwritten
- **WHEN** the user changed the `image` default profile and then connects a second provider
- **THEN** the `image` role's profiles are unchanged

### Requirement: Capability matching
A role SHALL accept only models whose capability type fits the role's capability, and a task route SHALL accept only models whose capability metadata (`generation-providers.Capability metadata`) declares what the route needs:

| Role or route | Requires |
|---|---|
| `vision` | llm model with image input |
| `translation` | llm or translation model |
| `video.image` | `modes` contains `image` |
| `video.first_last_frame` | `modes` contains `first_last_frame` |
| `video.reference` | `modes` contains `reference` |
| `image.edit`, `image.inpaint` | `inpaint` or edit support |
| `image.expand` | `outpaint` |
| `image.restyle` | `restyle` |
| `video.restyle` | `videoToVideo`, and the input clip no longer than `maxInputSeconds` |
| `video.text` | `modes` contains `text` |
| `image.character`, `image.location`, `image.prop`, `image.panel` | any image model; when the request carries reference images, reference-image support with a sufficient maximum count |
| `image.upscale`, `video.upscale` | non-empty `upscaleFactors` |
| `video.inpaint` | `inpaint` |
| `voice-design.convert` | `speechToSpeech` |
| `lipsync.avatar` | `inputs` contains `image` |
| `transcription.realtime` | `streaming` |
| `voice-tts` profile with a `voiceId` | the voice exists for the model |
| creative and coordination llm roles | a runtime whose `jcTools` is not `none` (`agent-runtimes.Per-role defaults through ORC`) |

Flags that describe the quality of a result rather than the ability to serve the request do not exclude a model: `diarisation` on a transcription model, word timestamps, `cloning` on a voice-design model, reference-audio support and `structuredOutput` on an llm model are returned in the resolution result as `capabilities` so that the caller adapts (for example `ai-editing-tools.Dubbing` assigns one speaker when `diarisation` is false), and a request can make any of them mandatory with `requires: [<flag>]`, in which case models lacking the flag are removed from the candidate list. The flag names are exactly those of `generation-providers.Capability metadata`. The profile editor and route editor SHALL list only fitting models. A stored profile whose target no longer fits or is not selectable (model removed from the catalogue, provider or endpoint disconnected or disabled, runtime disabled or signed out, capability changed) is marked `unusable` with a reason, is skipped by routing, and is shown with a warning badge. [NEW]

#### Scenario: Only fitting models are offered
- **WHEN** the profile modal is opened for the `video` role
- **THEN** only models of capability `video` are listed

#### Scenario: Provider disconnected
- **WHEN** the provider of a role's default profile is disconnected
- **THEN** the profile is marked unusable with "Provider not connected" and routing uses the next usable target

#### Scenario: First/last-frame route
- **WHEN** a model without first/last-frame support is chosen for the `video.first_last_frame` route
- **THEN** the update fails with `CAPABILITY_MISMATCH`

#### Scenario: Real-time transcription route
- **WHEN** a file-only transcription model is chosen for `transcription.realtime`
- **THEN** the update fails with `CAPABILITY_MISMATCH` naming `streaming`

#### Scenario: Diarisation requested as mandatory
- **WHEN** a transcription request carries `requires: ["diarisation"]` and the primary model declares `diarisation: false` while a fallback declares it
- **THEN** the primary is skipped as `capability_mismatch` and the fallback serves the request

#### Scenario: Diarisation not mandatory
- **WHEN** the same request carries no `requires` and the primary lacks `diarisation`
- **THEN** the primary serves it and the resolution result states `capabilities.diarisation: false`

### Requirement: Routes with primary and ordered fallbacks
A `Route` SHALL be `{primary: RouteTarget, fallbacks: RouteTarget[] (0–5), fallbackOn?: Trigger[], instructions? (0–4,000 characters)}` where `RouteTarget` is `{profileId, thinking?, params?}`; `thinking` and `params` on a target override the profile's values for that route only. Every role has a `default` route. Routes are addressed everywhere as `<roleId>.<routeId>`. This requirement holds the **one list of built-in task route ids**; `film-production`, `prompt-to-video-workflow`, `ai-editing-tools`, `agent-editing-tools`, `chat-agent` and `agent-workflows` use these ids verbatim and define none of their own:

| Role | Built-in task routes (besides `default`) | Used by |
|---|---|---|
| every llm role | `quick` (short utility calls such as titles, summaries and brief preparation); `planning`, `script`, `edit`, `search`, `research`, `audit`, `ui` (the route categories of `multi-agent-orchestration.Task brief`) | chat, teams, workflows |
| `image` | `image.character`, `image.location`, `image.prop`, `image.panel`, `image.edit` (film assets, panels and instruction edits); `image.inpaint`, `image.expand`, `image.upscale`, `image.restyle` (AI editing tools) | `film-production`, `ai-editing-tools` |
| `video` | `video.text`, `video.image`, `video.first_last_frame`, `video.reference` — written `video.<mode>`, one per video generation mode of `generation-providers.Capability metadata`; `video.inpaint`, `video.upscale`, `video.restyle` (AI editing tools) | tools, workflows, `film-production`, `ai-editing-tools` |
| `voice-tts` | `voice-tts.narration`, `voice-tts.dialogue`, `voice-tts.conversation` | `film-production`, `prompt-to-video-workflow`, `chat-agent` |
| `voice-design` | `voice-design.convert` (speech-to-speech voice change) | `ai-editing-tools` |
| `lipsync` | `lipsync.avatar` (lip-sync driven from a still image) | `ai-editing-tools` |
| `transcription` | `transcription.realtime` | `chat-agent` dictation |

The roles `music`, `sfx`, `translation` and `vision` have only `default`. Custom roles can define up to 12 extra task routes with ids matching `^[a-z][a-z0-9_]{1,23}$`. A task route that is not configured resolves to the role's `default` route when the default's model satisfies the route's requirement of `orc-model-routing.Capability matching`, and otherwise to `NO_ROUTE`. Targets within one route MUST reference distinct profiles, and can reference profiles on different runtimes, providers and endpoints. [JAD] [NEW]

#### Scenario: Task route falls back to default
- **WHEN** a panel image is requested and the `image.panel` route is not configured
- **THEN** the `image.default` route is used

#### Scenario: Unconfigured route whose default cannot serve it
- **WHEN** `transcription.realtime` is not configured and the `transcription.default` model has no streaming support
- **THEN** resolution fails with `NO_ROUTE` naming `transcription.realtime`

#### Scenario: Route-level override
- **WHEN** the `director.quick` route targets profile `default` with `thinking: "low"`
- **THEN** quick calls use low thinking while the default route keeps the profile's thinking level

#### Scenario: Duplicate target
- **WHEN** a route lists the same profile as primary and as a fallback
- **THEN** the update fails with `VALIDATION_FAILED`

#### Scenario: Route ids used by other capabilities resolve
- **WHEN** the route ids named in `film-production`, `prompt-to-video-workflow`, `ai-editing-tools`, `agent-editing-tools` and `chat-agent` are checked in CI against the table of this requirement
- **THEN** every id is a row of the table or a custom role's route, and the check fails for any other id

#### Scenario: Restyle route
- **WHEN** the `restyle` tool runs on a video clip and `video.restyle` is not configured
- **THEN** the request resolves to `video.default` when that model declares `videoToVideo`, and fails with `NO_ROUTE` otherwise

### Requirement: Route resolution and fallback
To serve a request for a role and route, ORC SHALL: (1) apply overrides in the precedence of `orc-model-routing.Override precedence`; (2) build the candidate list primary then fallbacks, removing disabled and unusable profiles, profiles whose model does not support the request's required options, and targets whose endpoint or runtime health marks them to be skipped (`agent-runtimes.Failover across keys and endpoints`); (3) try candidates in order. ORC owns the **order** and the **fallback triggers** only. How often one candidate is attempted, with which delays and on which error classes, is the single retry policy of `generation-providers.Retry policy` (three attempts per route — the initial one, then after 2 s and 8 s — and a 30 s wait before the first attempt on the next route; the values are stated there and only quoted here); this capability defines no retry count or delay, and the job queue never re-queues a provider job. After that policy is exhausted on a candidate, ORC moves to the next candidate only when the failure class is in the route's `fallbackOn` set. The default `fallbackOn` set is `auth_error`, `rate_limited`, `quota_exhausted`, `timeout`, `server_error`, `network`, `model_unavailable`, `capability_mismatch`, `invalid_output`, `unknown`. The classes `content_blocked`, `invalid_request`, `budget_exceeded`, `forbidden` and `cancelled` MUST NOT trigger fallback unless `content_blocked` is explicitly added to `fallbackOn`. A fallback applies to the current request only and never changes the stored configuration. When all candidates fail the request fails with the last error and `details.attempts[]` listing each candidate, attempt number, error class and duration. **Agent turns are different, and this is stated plainly.** For llm roles on a Gateway runtime the candidate order is projected into the agent's model fallback chain (`orc-model-routing.Mapping onto Gateway agent and provider configuration`), and from there the Gateway's own failover decides everything else: how many attempts are made, with which delays, when a key is rotated, and which error classes advance the chain. The three attempts at 2 s and 8 s, the 30 s wait, the editable `fallbackOn` set and the `content_blocked` opt-in of this requirement therefore apply to **generation calls and to LLM steps the server makes itself** (titles, brief preparation, `jc-llm-translation`, one-shot workflow and test runs driven through the Gateway methods `agent` and `agent.wait` over the gateway link, where the server starts each attempt) and **not** to interactive agent turns relayed to a Gateway runtime; for those, a turn that the Gateway's chain did not serve fails with the last error, the hops are disclosed by `agent-runtimes.Served-by attribution`, and `details.attempts[]` lists what the Gateway's events reported. Per-profile `params` and `extraBody` on agent turns are limited as `orc-model-routing.Profile schema` states. Every attempt is recorded once by its owner: generation attempts in the cost ledger of `generation-providers.Usage ledger`, agent turns in `usage-tracking.Per-turn usage record`. [JAD] [NEW]

#### Scenario: Primary is rate limited
- **WHEN** the primary video profile returns a rate-limit error on each of the three attempts of the retry policy and one fallback exists
- **THEN** the request is sent to the fallback after the third failure
- **AND** the result records `usedFallback: true` with four attempts in `details.attempts[]`

#### Scenario: Content block does not fall back
- **WHEN** the primary image model refuses a prompt for content-safety reasons and `fallbackOn` is the default set
- **THEN** the request fails with `CONTENT_BLOCKED` and no fallback is tried

#### Scenario: Network failure falls back
- **WHEN** the primary fails with class `network` on all attempts
- **THEN** the next candidate is tried

#### Scenario: Budget does not fall back
- **WHEN** the primary's estimate is refused with `BUDGET_EXCEEDED`
- **THEN** the request fails with `BUDGET_EXCEEDED` and no fallback is tried

#### Scenario: No candidates
- **WHEN** every target of the route is disabled or unusable
- **THEN** the request fails with `NO_ROUTE` naming the role and route

#### Scenario: Interactive agent turn uses the Gateway's failover
- **WHEN** the primary model of a Director session returns a rate-limit error and the route has one same-runtime fallback
- **THEN** key rotation and the move to the fallback happen as the Gateway's failover decides, the server adds no 2 s / 8 s attempts and no 30 s wait of its own, and the footer discloses the hop

#### Scenario: Server-made LLM step uses the retry policy
- **WHEN** the automatic session title call on the `quick` route fails twice with `server_error` and then succeeds
- **THEN** three attempts were made at 0 s, 2 s and 8 s by the server

### Requirement: Fallback disclosure
Whenever a request is served by a fallback target, ORC SHALL attach `{usedFallback: true, primary: {runtime?, provider, model}, served: {runtime?, provider, model}, reason}` to the result, and the product surfaces SHALL show it: chat message footers (`chat-agent.Message footer and actions`), media cards, generation job details, workflow node details, team assignment rows and film step details show "Fallback: <served model> (primary <model> failed: <reason>)". Hops inside one target — another key or an equivalent endpoint — are disclosed by `agent-runtimes.Served-by attribution`, not here. When the same route has fallen back 3 times within 10 minutes, a notice SHALL be raised in ORC settings on the role card: "Primary failing — <reason>". [NEW]

#### Scenario: Job detail shows the fallback
- **WHEN** a video job was served by the fallback profile
- **THEN** the job detail shows the served model, the primary model and the failure reason

#### Scenario: Repeated fallback
- **WHEN** the image default route falls back three times within 10 minutes
- **THEN** the `image` role card shows a warning badge "Primary failing"

### Requirement: Per-role instructions
A role's `instructions` SHALL be added to every request served by that role, in a way that depends on the role's capability. **llm roles**: appended to the agent or step system instructions after the persona instructions (and before a team role's own instructions). **`image`, `video`, `music`, `sfx`, `voice-design`**: prepended to the prompt as a style preamble separated by a blank line. **`voice-tts`**: never added to the text to speak; passed only through the model's style or emotion parameter when its capability metadata declares one, and otherwise ignored with the warning `instructions_unsupported` on the result. **`transcription`, `lipsync` and non-llm `translation`**: not applicable — the instructions field is disabled in the role card with the caption "This role takes no instructions". A route's `instructions` are appended after the role's under the same rule. Instructions are plain text; template variables `{{project.name}}`, `{{project.aspectRatio}}`, `{{project.language}}` and `{{date}}` are substituted, and an unknown variable fails validation. The combined instructions and prompt MUST respect the model's maximum prompt length from its capability metadata; when they exceed it the request fails with `INVALID_PARAMS` before any provider call. [JAD] [NEW]

#### Scenario: Style preamble on images
- **WHEN** the `image` role has the instructions "Flat pastel illustration, no text" and a tool requests "a cat on a roof"
- **THEN** the provider receives the instructions followed by a blank line and the prompt

#### Scenario: Speech text is never prefixed
- **WHEN** the `voice-tts` role has the instructions "Warm and calm" and a line "Welcome back" is synthesised on a model with a style parameter
- **THEN** the text sent to be spoken is exactly "Welcome back" and "Warm and calm" is sent as the style parameter

#### Scenario: Speech model without a style parameter
- **WHEN** the same call uses a model that declares no style parameter
- **THEN** only "Welcome back" is sent and the result carries the warning `instructions_unsupported`

#### Scenario: Unknown variable
- **WHEN** instructions contain `{{user.name}}`
- **THEN** the update fails with `VALIDATION_FAILED` naming the variable

### Requirement: Role limits
Each role SHALL have `limits {maxConcurrent, timeoutSeconds, maxCostPerCallUsd?, maxCallsPerRun?}`. Defaults: `maxConcurrent` — llm roles 4, image 4, video 2, voice-tts 4, voice-design 1, music 1, sfx 2, lipsync 2, transcription 2, translation 4; `timeoutSeconds` — llm 300, image 180, video 900, voice-tts 120, voice-design 120, music 300, sfx 120, lipsync 900, transcription 600, translation 120. Ranges: `maxConcurrent` 1–32, `timeoutSeconds` 10–3,600, `maxCostPerCallUsd` 0.01–1,000, `maxCallsPerRun` 1–10,000. There is no retry setting on a role: retries are `generation-providers.Retry policy`. `timeoutSeconds` bounds one attempt; for a model whose capability metadata declares `delivery: "deferred"` it bounds the submission only and the wait for the result is bounded by that model's `maxWaitSeconds`. Requests beyond `maxConcurrent` wait in the single job queue in first-in-first-out order within their priority class. The effective concurrency is the minimum of the role limit, the provider limit of `generation-providers.Concurrency and rate limits` and the endpoint's `maxConcurrency`. A request whose estimate exceeds `maxCostPerCallUsd` fails with `BUDGET_EXCEEDED` (scope `role`) before any provider call. The `(maxCallsPerRun + 1)`-th call of one role within one run (workflow run, team run, film step batch or session turn) fails with `RATE_LIMITED` and `details.limit`. [JAD] [NEW]

#### Scenario: Concurrency cap
- **WHEN** 5 video requests arrive with `maxConcurrent` 2
- **THEN** 2 run and 3 wait in order

#### Scenario: Per-call cost cap
- **WHEN** `video.limits.maxCostPerCallUsd` is 2.00 and a request is estimated at 3.10 USD
- **THEN** the request fails with `BUDGET_EXCEEDED` and no provider call is made

#### Scenario: Timeout
- **WHEN** an image attempt runs longer than 180 s
- **THEN** the attempt ends with class `timeout` and the retry policy and fallback rules apply

#### Scenario: Calls per run
- **WHEN** `image.limits.maxCallsPerRun` is 50 and a workflow run issues its 51st image call
- **THEN** that call fails with `RATE_LIMITED` and `details.limit` is 50

#### Scenario: Deferred model
- **WHEN** a video model with `delivery: "deferred"` and `maxWaitSeconds` 43,200 accepts a job within 20 s and delivers after 3 hours
- **THEN** the job succeeds and no timeout or fallback occurred

### Requirement: Override precedence
The effective target for a request SHALL be chosen by the first of these that specifies one: (1) per-run override, (2) per-session override, (3) per-container override — the video project's, or for film work the film's `roleOverrides` (the per-film level; when a film episode's editor project also carries overrides, the film's entry wins for requests made by the film pipeline and the project's for requests made in the editor) — (4) the Team's route for requests made inside a team run (`multi-agent-orchestration.Team route selection`), (5) the role's route in the global ORC configuration. Overrides can change `profileId`, `thinking` and `params` for a role or a role's task route; they cannot add profiles or change limits, instructions or capability. An override naming a profile that does not exist or is unusable is ignored with a warning `override_ignored` attached to the result, and resolution continues with the next level. Device-remembered composer preferences are not an override level (`agent-runtimes.Per-role defaults through ORC`). [NEW]

#### Scenario: Project beats global
- **WHEN** the global `image` default is profile `a` and the project override selects `b`
- **THEN** image requests in that project use `b` and other projects use `a`

#### Scenario: Film override
- **WHEN** a film stores the override `image.character` → profile `c` and its project stores none
- **THEN** character images of that film use `c`

#### Scenario: Stale override
- **WHEN** a project override names a profile that was deleted
- **THEN** the request is served by the next level and the result carries the warning `override_ignored`

#### Scenario: Per-film override
- **WHEN** a film stores `roleOverrides {"image.prop": {profileId: "p-fast"}}`, the global `image.prop` route points to another profile, and a prop image is generated in that film with no run or session override
- **THEN** the request uses `p-fast`, and a prop image generated in another film uses the global route

### Requirement: Per-project override
A container — a video project or a film — SHALL be able to store ORC overrides `{<roleId>[.<routeId>]: {profileId, thinking?, params?}}`: a project in its settings, edited from the project settings panel and from the quick switch with scope "This project"; a film in its `roleOverrides`, edited from the film settings and the quick switch with scope "This film". Route ids use the dotted notation of `orc-model-routing.Routes with primary and ordered fallbacks` (for example `image.character`, `image.prop`, `video.first_last_frame`, `voice-tts.narration`). Overrides are synced with their container, apply on every device and to every session, workflow run and film run bound to it, and are removable individually ("Use global default"). At most 60 override entries exist per container. Editing a container's overrides needs `jagentchill.projects.write`. [NEW]

#### Scenario: Project uses a different video model
- **WHEN** the user sets the project override `video` → profile `cinematic`
- **THEN** every video generation in that project uses `cinematic`

#### Scenario: Film route notation
- **WHEN** a film stores an override for props
- **THEN** its key is `image.prop`

#### Scenario: Remove an override
- **WHEN** the user selects "Use global default" for `video`
- **THEN** the container entry is removed and the global route applies

#### Scenario: Entry limit
- **WHEN** a project has 60 override entries and the user adds another
- **THEN** the change is refused with "Up to 60 overrides per project"

### Requirement: Per-run override
A single request, session, workflow run, team run or film step run SHALL accept overrides: tools through `role`, `route` and `profileId` parameters; workflow, team and film runs through `orcOverrides` at start and per node; generation roles of a session through the quick switch with scope "This session". The agent model of a session is not chosen here: it is the selection made in the model browser of `chat-agent.Model browser` and applied by `agent-runtimes.Session control application`, and it is strict — when the chosen model fails, the turn fails with the provider error and no ORC fallback is tried, unless the user turned on "Allow fallback" for the session, in which case the role's fallbacks that run on the same runtime, and the equivalent endpoints of `agent-runtimes.Failover across keys and endpoints`, are used. Strictness on an agent turn depends on the Gateway honouring a session model override over the agent's configured fallback chain, which is spike S26: when S26 fails, a strict agent model cannot be guaranteed, so "Allow fallback" is always on for agent turns, its toggle is hidden for the agent model (it stays for generation roles), and the model browser states "If this model fails, <role>'s fallback models answer". For generation roles a per-run override replaces the primary and keeps the route's fallbacks only when "Allow fallback" is on (default off). Per-run overrides are not persisted beyond the run or session. [NEW]

#### Scenario: Strict session model
- **WHEN** the user picked a model for the session without "Allow fallback" and the model returns a server error
- **THEN** the turn fails with that error and no other model answers

#### Scenario: Allow fallback stays on the runtime
- **WHEN** "Allow fallback" is on and the role's fallbacks are one profile on the same runtime and one on a CLI runtime
- **THEN** only the same-runtime fallback is tried

#### Scenario: Tool-level override
- **WHEN** `jc_generate_image` is called with `profileId: "quality"`
- **THEN** that profile serves the request regardless of the route's primary

#### Scenario: Strict agent model cannot be guaranteed
- **WHEN** the S26 result is `fail` on the pinned Gateway
- **THEN** the "Allow fallback" toggle is absent for the agent model, the model browser shows the stated sentence, and the toggle is still offered for generation roles in the quick switch

### Requirement: Configuration validation
Every ORC update SHALL be validated as a whole before it is stored, and rejected with `VALIDATION_FAILED` and `issues[] {path, code, message}` when any rule fails: ids match their patterns and are unique; `defaultProfileId` and every route target reference existing profiles of the same role; runtime, provider or endpoint, and model exist in the registry; model capability fits the role and each route (`orc-model-routing.Capability matching`); `params`, `thinking` and `mode` are allowed by the model's metadata on that runtime; `params.extraBody` obeys its rules; limits are within range; text lengths are within bounds; at most 12 profiles per role, 5 fallbacks per route and 20 custom roles. Rules that depend on live state (provider connected, runtime signed in, endpoint healthy, model currently available) produce warnings, not errors: the update is stored and the affected profiles are marked unusable or `unverified`. `jagentchill.orc.config.validate {config}` (scope `jagentchill.config.read`) SHALL run the same validation without storing. The domain error codes of this capability are `VALIDATION_FAILED`, `ROLE_PROTECTED`, `ROLE_IN_USE` and `CAPABILITY_MISMATCH`, registered by name in `server-api.RPC error envelope`; every other code it returns is a general code of that registry. [NEW]

#### Scenario: Several problems reported together
- **WHEN** an update has an unknown model and an out-of-range timeout
- **THEN** the response lists both issues with their paths and nothing is stored

#### Scenario: Disconnected provider is a warning
- **WHEN** a profile references a provider that exists but is not connected
- **THEN** the update is stored and the response carries a warning for that profile

#### Scenario: Unknown endpoint is an error
- **WHEN** a profile names a `provider` that is neither a bundled provider nor an endpoint record
- **THEN** the update fails with `VALIDATION_FAILED` at that profile's `provider`

### Requirement: Import and export of an ORC configuration
The settings page SHALL export the ORC configuration as a JSON file named `jagentchill-orc-<yyyy-mm-dd>.json` with the shape `{format: "jagentchill.orc", version: 1, exported_ms, appVersion, config, dependencies: {runtimes: [{runtimeId, kind}], providers: [providerId], endpoints: [<endpoint export entry>]}}`. `dependencies.endpoints` holds, for every endpoint record a profile references, the entry produced by `agent-runtimes.Endpoint configuration import and export` — base URL, dialect, headers, model list and media templates, with every credential, secret header, secret query value, CA bundle and client key present only as `{secret: "<NAME>", required: true}`. The file MUST NOT contain secret values, usage data, health, or project and film overrides. Import SHALL accept such a file up to 2 MiB, validate it, and show a preview listing per role: profiles added, changed and removed, route changes; and under "Dependencies": endpoints to create or update (with the field-level comparison and the "Present" or "Missing — enter" state of each secret on this host), runtimes not installed or not signed in, and providers not connected. Import modes: "Merge" (add and update roles and profiles, keep the rest) and "Replace" (the file becomes the configuration; custom roles absent from the file are removed unless in use). Endpoints are imported through the endpoint import of `agent-runtimes` in the same operation, created disabled when a secret is missing and never with `allowSelfSigned` true; profiles whose runtime, provider or endpoint is unresolved are imported disabled and marked unusable. The whole import applies or nothing does. Before applying, the current configuration SHALL be saved as a restore point; the last 10 restore points are kept and restorable from the settings page. Platform behaviour: export uses the save dialog on desktop, a browser download on web and the system share sheet on mobile; import uses the file dialog on desktop and web and the system document picker on mobile. Wire contract (`orc-model-routing.ORC RPC surface`): `jagentchill.orc.config.export {}` → the document; `jagentchill.orc.config.import {document, mode: "merge" | "replace", dryRun?}` → the preview when `dryRun` is true, otherwise the applied revision; `jagentchill.orc.restore.list {}` → the restore points `{id, created_ms, reason, revision}`; `jagentchill.orc.restore.apply {id, expectedRevision}`. Export needs `jagentchill.config.read`; import and restore need `jagentchill.config.write`. [NEW]

#### Scenario: Export has no secrets
- **WHEN** the configuration is exported
- **THEN** the file contains runtime, provider, endpoint and model ids and no API key, token or secret header value

#### Scenario: Export names its endpoints
- **WHEN** a `director` profile uses the endpoint `my-router`
- **THEN** the export lists `my-router` under `dependencies.endpoints` with its base URL and its key as `{secret: "…", required: true}`

#### Scenario: Import with a missing endpoint secret
- **WHEN** a file is imported on a host that lacks the endpoint's key
- **THEN** the preview shows "Missing — enter" for it, and after import the endpoint is disabled and the profiles using it are marked unusable

#### Scenario: Import with a missing provider
- **WHEN** a file references a provider that is not connected
- **THEN** the preview lists it under "Dependencies", and after import those profiles are disabled with the badge "Provider not connected"

#### Scenario: Invalid file
- **WHEN** a file with `format: "other"` or a version higher than supported is chosen
- **THEN** the import is refused with "This file is not a supported ORC configuration" and nothing changes

#### Scenario: Restore after import
- **WHEN** the user imports with "Replace" and then selects the newest restore point
- **THEN** the configuration returns to its state before the import

#### Scenario: Export on a phone
- **WHEN** the user presses "Export" on mobile
- **THEN** the system share sheet opens with the JSON file

### Requirement: Mapping onto Gateway agent and provider configuration
ORC SHALL project the configuration onto the Gateway as follows, through the Gateway configuration methods (`config.get`, then `config.patch` with the base hash) called by the server over its gateway link (no device holds any OpenClaw scope; `server-api.Gateway calls over the link`) and never by editing files of a running Gateway. For each persona agent `agents.entries.jagentchill-<persona>`: `model` is set to `{primary: "<provider>/<model>", fallbacks: ["<provider>/<model>", …]}` from the persona's role `default` route, restricted to targets on the primary's runtime because the Gateway's fallback chain cannot change runtime; `thinkingDefault` from the primary target; `models["<provider>/<model>"].params` from the single `params` object that `orc-model-routing.Profile schema` allows per model; `utilityModel` from the role's `quick` route; and `models["<provider>/<model>"].agentRuntime` for every listed model, as required by `agent-runtimes.Per-role defaults through ORC`. A fallback target on another runtime is applied by the server itself: when the Gateway chain is exhausted, the server retries the turn through `agent-runtimes.Switch runtime operation` semantics for agents it drives (team members, workflow nodes), and for an interactive session it reports the failure with the action "Switch to <fallback model>". Model references use the Gateway's `provider/model` form, where the provider is a bundled provider id or an endpoint id projected by `agent-runtimes.Shared endpoint record`. Generation roles are not Gateway agents: the server's generation service resolves them at request time. The projection SHALL run after every ORC update, at server start and every time the gateway link becomes ready after a Gateway restart (`server-api.Gateway supervision and lifecycle`), be idempotent, touch only `jagentchill-*` agent entries, and report failures as the notice "Unable to apply model settings to the host" with a "Retry" action. An ORC update made while the Gateway is unavailable is stored, answers success with `projection: "pending"`, and is projected when the link is ready; generation roles are unaffected by the Gateway's state. [NEW]

#### Scenario: Director model change reaches the agent
- **WHEN** the `director` default route's primary is changed to another model
- **THEN** `agents.entries.jagentchill-director.model.primary` equals the new `provider/model` within 2 s and the next turn uses it

#### Scenario: Runtime is projected
- **WHEN** the primary profile names the runtime `claude-code`
- **THEN** the agent entry's `models["<provider>/<model>"].agentRuntime` names that runtime's Gateway target

#### Scenario: Cross-runtime fallback is not in the Gateway chain
- **WHEN** the route's only fallback is on another runtime
- **THEN** `model.fallbacks` is empty and a failed interactive turn offers "Switch to <fallback model>"

#### Scenario: Other agents are untouched
- **WHEN** the projection runs
- **THEN** no `agents.entries` key outside the `jagentchill-` prefix is modified

#### Scenario: ORC changed while the Gateway is restarting
- **WHEN** an admin saves a new `director` default route while the supervised Gateway is restarting
- **THEN** the update is stored with a new revision and `projection: "pending"`, and within 5 s of the link becoming ready `agents.entries.jagentchill-director.model.primary` holds the new model

#### Scenario: Projection failure
- **WHEN** the Gateway rejects the configuration patch
- **THEN** the ORC settings page shows "Unable to apply model settings to the host" with "Retry", and the ORC document keeps the user's change

### Requirement: Task brief preparation
ORC SHALL own the two switches `autoPrepareBrief` and `askWhenAmbiguous` and the entry point `jagentchill.orc.brief.prepare {rawRequest, teamId?, projectId?, routeCategory?}` (scope `jagentchill.agent.use`), which returns a task brief without starting work. The brief's shape — with a single `selectedRoute {roleId, profileId, thinking?}`, `deliverables[]`, `authoredBy: "model" | "parser"` and `status: "ready" | "needs_clarification"` — is owned by `multi-agent-orchestration.Task brief`, and how it is authored is `multi-agent-orchestration.Brief authoring and clarification`; this capability defines neither. A task brief is prepared for a **delegating request**: the start of a team run, Team mode in the composer, and a chat request in which the session's agent delegates to other agents. It is not prepared for workflow runs or film runs, whose own `brief` step is their only brief and is unaffected by the two switches. Both switches SHALL have a real, observable effect — in JAgentDesk they are stored but change nothing: `autoPrepareBrief: true` → the brief is authored by a model call on the `quick` route of the supervisor role (or of `director` when no supervisor profile exists), `authoredBy` is `model`, and that call appears in usage; `autoPrepareBrief: false` → no model call is made and the deterministic parser authors the brief with `authoredBy: "parser"`. `askWhenAmbiguous: true` → a brief is `needs_clarification` if and only if `openQuestions.length > 0` (or the request is empty), work does not start, and the questions are asked through `chat-agent.Agent questions`; `askWhenAmbiguous: false` → open questions become assumptions listed in `acceptedDecisions` prefixed "Assumed: " and the brief is `ready`. `selectedRoute` is resolved with `orc-model-routing.Route resolution and fallback` for the brief's route category. A Team's own value of either switch overrides the ORC value for that Team. The brief is shown in the chat as a collapsible card and stored with the run. [JAD JD-ORC-003, JD-ORC-004] [NEW]

#### Scenario: Ambiguous request
- **WHEN** a team run is started with "make a promo", the model returns two open questions and `askWhenAmbiguous` is on
- **THEN** the brief has status `needs_clarification`, the run does not start, and a question card asks the two questions

#### Scenario: Ask switched off
- **WHEN** the same request is made with `askWhenAmbiguous` off
- **THEN** the brief is `ready`, `acceptedDecisions` contains two entries starting with "Assumed: ", and the run starts

#### Scenario: Model-authored brief
- **WHEN** `autoPrepareBrief` is on and a team run starts
- **THEN** one model call on the `quick` route is recorded in usage and the brief has `authoredBy: "model"`

#### Scenario: Brief preparation switched off
- **WHEN** `autoPrepareBrief` is off
- **THEN** no model call is made for the brief and the brief has `authoredBy: "parser"`

#### Scenario: Workflow run is unaffected
- **WHEN** a prompt-to-video run is started with both switches on
- **THEN** no task brief is prepared and the run's own `brief` step runs under the run's approval settings

### Requirement: ORC settings page
Settings SHALL contain an "ORC" page under the host group with, top to bottom: a header with title, subtitle and the buttons "Import", "Export" and "Restore points"; a card of global toggles (ORC enabled, "Prepare a brief with a model", "Ask when ambiguous") each with a one-line description of its effect; a search field filtering roles by name; and role cards grouped under the captions "Coordination" (supervisor, lead, peer), "Agents" (director, screenwriter, storyboard, editor, reviewer), "Understanding" (vision, transcription, translation), "Generation" (image, video, voice-tts, voice-design, music, sfx, lipsync) and "Custom", followed by an "Add role" button. Links lead to the pages that own neighbouring settings: "Runtimes & providers" (`agent-runtimes.Runtimes settings screen`), "Teams" (`multi-agent-orchestration.Teams settings page`) and "Budgets" (`generation-providers.Budgets with hard stop`). The page follows the grouped setting card pattern of `settings-preferences.Settings page pattern`. Every role is readable with `jagentchill.config.read`; every control is read-only without `jagentchill.config.write`, with the caption "Admin devices can change these settings". The page requires a connected host; when disconnected it shows the last loaded configuration read-only with the banner "Reconnect to edit". While loading it shows card skeletons. On mobile, role cards stack full width and a role opens as a pushed screen. [JAD] [NEW]

#### Scenario: Search roles
- **WHEN** the user types "voice" in the search field
- **THEN** only the `voice-tts` and `voice-design` cards are shown

#### Scenario: Coordination group
- **WHEN** the page is opened on a fresh host
- **THEN** the "Coordination" group shows the supervisor, lead and peer cards, each stating "Uses Director's model" until it has a profile

#### Scenario: Editor device
- **WHEN** an `editor` device opens the page
- **THEN** every control is read-only with the stated caption

#### Scenario: No providers connected
- **WHEN** no provider, endpoint or runtime is usable
- **THEN** a notice with an info left bar reads "Connect a provider to configure models" with a button that opens "Runtimes & providers", and every role card shows "Not configured"

### Requirement: Role cards
A role card SHALL show: icon, label, capability chip, enabled toggle, status ("Ready", "Not configured", "Primary failing", "Disabled"), the default profile as "<provider> · <model>" with its key options, and an expand chevron. Expanded, it shows: a profiles list (label, provider, model, options summary, default radio, enabled toggle, edit and delete buttons, drag handle to reorder) with "Add profile"; a routes section; a limits section (concurrency, timeout, per-call cost cap, calls per run) with numeric fields validated on blur; an instructions text area with a character counter; and a "Test run" button. Deleting the default profile or a profile used by a route SHALL be refused with a message naming the usage. Changes are saved on each control commit and show a "Saved" indicator for 2 s; a failed save restores the previous value and shows the error inline. [JAD] [NEW]

#### Scenario: Change the default profile
- **WHEN** the user selects the radio of profile `quality`
- **THEN** the card header shows that profile's provider and model and "Saved" appears for 2 s

#### Scenario: Delete a profile used by a route
- **WHEN** the user deletes a profile that is the primary of `image.panel`
- **THEN** deletion is refused with "Used by route Panel" and the profile remains

#### Scenario: Keyboard access
- **WHEN** the user tabs through an expanded role card
- **THEN** every control is reachable in visual order and the drag handle offers "Move up" and "Move down" with `Alt+ArrowUp` and `Alt+ArrowDown`

### Requirement: Profile modal
"Add profile" and "Edit" SHALL open a modal with four steps on one scrollable form: (1) **Runtime** (llm roles only) — the enabled runtimes that fit the role, each with its readiness and capability badges, default `builtin`; choosing a CLI or ACP runtime for a creative or coordination role shows the warning "Agents on this runtime can run commands on <host name>" and is saveable only by an admin (`agent-runtimes.Per-role defaults through ORC`); (2) **Provider** — a select of connected and enabled providers and endpoints offering the role's capability on that runtime, each with a health icon and text label, endpoints marked "Endpoint"; (3) **Model** — a searchable list of fitting models showing label, capability badges (for example "1080p", "10 s", "First/last frame", "Audio", "Vision"), price summary or "Unpriced", and context window for llm models; (4) **Options** — controls generated from the chosen model's capability metadata: selects for enumerated options, numeric fields with min and max, toggles for booleans, a thinking select and a starting-mode select for llm models, a voice picker with audio preview for tts models, and an "Advanced" disclosure holding a JSON editor for `params.extraBody` with a live byte counter "<n> / 8,192 bytes" and inline validation. Each option shows its default; untouched options are stored unset so the model default applies. Below: label, id (auto-derived from the label, editable until first save), and an "Enabled" toggle. The footer has "Cancel", "Test" and a primary "Save" disabled until the form validates. Changing the runtime or provider clears the model and options; changing the model keeps option values that remain valid and clears the others with a note "<n> options were reset". On mobile the modal is a full-height sheet. [NEW]

#### Scenario: Options follow the model
- **WHEN** the user picks a video model whose metadata lists durations 5 and 10 s and resolutions 720p and 1080p
- **THEN** the options step shows a duration select with those two values and a resolution select with those two values

#### Scenario: Runtime warning
- **WHEN** an admin picks a CLI runtime for the `editor` role
- **THEN** the warning naming the host is shown above the provider step

#### Scenario: Extra body counter
- **WHEN** the user pastes a 9,000-byte JSON object into the extra body editor
- **THEN** the counter shows "9,000 / 8,192 bytes" in the danger tone and "Save" is disabled

#### Scenario: Switching model resets invalid options
- **WHEN** the profile has `resolution: 1080p` and the user switches to a model that only offers 720p
- **THEN** the resolution is cleared and the note "1 option was reset" is shown

#### Scenario: Provider has no fitting model
- **WHEN** the chosen provider has no enabled model for the role's capability
- **THEN** the model step shows "No <capability> models are enabled for this provider" with a link to the provider's model list

### Requirement: Route rows
The routes section SHALL list one row per route of the role: the `default` route first, then built-in task routes, then custom ones, each showing the route name, the primary target as a select of the role's enabled profiles, a thinking override select for llm roles, and a chain of fallback chips in order with "+" to add (up to 5), "×" to remove and drag to reorder. Every target — primary and each fallback chip — SHALL show the health of what serves it as an icon with a text label: the endpoint or provider health of `agent-runtimes.Endpoint health` or `generation-providers.Health status`, and for llm roles also the runtime readiness of `agent-runtimes.Model readiness` ("Signed out", "Not installed", "Rate limited until <time>"); the worse of the two is shown and the tooltip lists both with the time of the last successful call. A row whose primary is not healthy shows which fallback would serve the next request ("Next request: <profile>"). Health updates arrive with `jagentchill.runtime.updated` and `jagentchill.provider.changed` and are reflected within 2 s. A task route that is not configured shows "Uses default" and a "Customise" button; a customised task route has "Reset to default". A row menu offers "Route instructions" and, for roles whose requests the server makes itself (every generation role, `transcription`, non-llm `translation`), "Fallback triggers" (checkbox list of the trigger classes with the defaults checked); for llm roles "Fallback triggers" is absent and the row carries the caption "Retries and fallback timing for chat turns follow the host's failover" (`orc-model-routing.Route resolution and fallback`). Unusable targets are shown struck through with a warning icon and tooltip stating the reason. [JAD] [NEW]

#### Scenario: Add a fallback
- **WHEN** the user presses "+" on the `video.default` row and selects profile `backup`
- **THEN** a chip "backup" is appended to the chain and the configuration stores it as the last fallback

#### Scenario: Endpoint health in the row
- **WHEN** the endpoint serving the primary of `director.default` changes to `auth-failed`
- **THEN** within 2 s the row's primary shows the "Auth failed" icon and label and the caption "Next request: <first healthy fallback>"

#### Scenario: Runtime signed out
- **WHEN** the CLI runtime of a fallback profile is signed out
- **THEN** that chip shows "Signed out" and its tooltip names the runtime

#### Scenario: Fallback limit
- **WHEN** a route already has 5 fallbacks
- **THEN** the "+" button is disabled with the tooltip "Up to 5 fallbacks"

#### Scenario: Enable fallback on content block
- **WHEN** the user checks "Content blocked" in "Fallback triggers" of an `image` route
- **THEN** a content-safety refusal on the primary moves the request to the next target

#### Scenario: No fallback triggers on an llm role
- **WHEN** an admin opens the row menu of `director.default`
- **THEN** the menu has "Route instructions" and no "Fallback triggers", and the row shows the stated caption

### Requirement: Test run
The "Test run" button on a role card and "Test" in the profile modal SHALL send one minimal real request through the selected route or profile and show the outcome in a result panel: status, served runtime, provider and model, whether a fallback was used with each attempt's error, latency in milliseconds, cost, and the output per role — llm roles: the reply text to a fixed instruction to answer with one sentence, on a throw-away session of the profile's runtime; `vision`: a one-sentence description of a bundled 512 px image; `image`: one 512 px image; `video`: the shortest and lowest-resolution clip the model supports; `voice-tts`: a fixed spoken sentence; `voice-design`: one preview from a fixed description; `music` and `sfx`: a 5 s clip; `lipsync`: a bundled 3 s clip synced to a bundled 3 s audio; `transcription`: a transcript of a bundled 5 s sample; `translation`: a translation of a fixed sentence. Before running a test that has a non-zero or unknown estimate, a confirm dialog SHALL show the estimated cost or "Cost unknown"; tests of `video`, `music`, `lipsync` and `voice-design` always ask for confirmation. Test cost is recorded in the generation cost ledger or agent usage with the tag `orc-test` and counts toward budgets. A test can be cancelled; it times out at the role's `timeoutSeconds`. Test outputs are not added to any project and are deleted after 24 h. The result panel opens as a side sheet 400 px wide on desktop and web and as a full-height sheet on mobile, with an inline media player for image, video and audio output. Wire contract: `jagentchill.orc.test.run {roleId, routeId? | profile? (an unsaved profile from the modal), confirmCost?: boolean, idempotencyKey}` → `{testId}`, with progress and the result delivered on the event `jagentchill.orc.test.updated {testId, state, result?}` to the calling device; `jagentchill.orc.test.cancel {testId}`. A test with a non-zero or unknown estimate called without `confirmCost: true` returns `{needsConfirmation: true, estimate}` and runs nothing. An llm test is a server-driven one-shot run, so the retry policy of `generation-providers.Retry policy` applies to it. Running a test needs `jagentchill.config.write` and `jagentchill.generation.run`. [NEW]

#### Scenario: Successful LLM test
- **WHEN** the user tests the `editor` role
- **THEN** the panel shows "OK", the runtime and model, the latency and a one-sentence reply

#### Scenario: Vision test
- **WHEN** the user tests the `vision` role
- **THEN** the panel shows a one-sentence description of the bundled image

#### Scenario: Lip-sync test asks first
- **WHEN** the user tests the `lipsync` role
- **THEN** a dialog shows the estimated cost and the test runs on the bundled 3 s clip only after "Run test"

#### Scenario: Paid test asks first
- **WHEN** the user tests the `video` role
- **THEN** a dialog shows "This test generates a short clip. Estimated cost $<amount>." and runs only after "Run test"

#### Scenario: Failing key
- **WHEN** the provider rejects the key during a test
- **THEN** the panel shows "Failed · auth_error" with the mapped message and a link "Open provider settings"

#### Scenario: Result on mobile
- **WHEN** an image test finishes on a phone
- **THEN** the result opens as a full-height sheet showing the image inline

### Requirement: Quick switch
A quick switch control SHALL be available from the "Features" sheet of the chat composer (`chat-agent.Feature controls`), the workflow run setup form, each workflow node's detail panel, and the film studio's step toolbars and settings. It lists the roles relevant to the surface — composer: the generation roles `image`, `video`, `voice-tts`, `music` (the agent's own model is chosen in `chat-agent.Model browser`); workflow and film screens: the roles their nodes or steps use — each as a row with the role label and a select of the role's enabled profiles showing "<label> · <model>" with a health icon and label, the current effective choice checked, and a caption showing where it comes from ("Global", "Team", "Project", "Film", "Session", "Run"). A scope segmented control chooses where the change is stored: "This session" or "This run" (per-run override), "This project" or "This film" (per-container override; needs `jagentchill.projects.write`). An "Allow fallback" toggle applies to per-run choices. A footer link "Open ORC settings" opens the full page. Per-session and per-run choices are read and written with `jagentchill.orc.override.get {scope: "session" | "run", id}` and `jagentchill.orc.override.set {scope, id, roleId, routeId?, target: {profileId, thinking?, params?} | null, allowFallback?}` (scope `jagentchill.agent.use` and the right to act in that session or run); container overrides are written through their container (`orc-model-routing.Per-project override`). The switch MUST NOT change the global configuration. Opening the control and listing profiles SHALL complete within 200 ms from cached data. On mobile it is a bottom sheet. [NEW]

#### Scenario: Switch the video model for one session
- **WHEN** the user selects profile `fast` for `video` with scope "This session"
- **THEN** video generations in that session use `fast`, the caption reads "Session", and other sessions are unaffected

#### Scenario: Scope project
- **WHEN** the user selects a profile with scope "This project"
- **THEN** the project override is stored and syncs to the user's other devices

#### Scenario: Role not configured
- **WHEN** a listed role has no usable profile
- **THEN** its row shows "Not configured" and a "Set up" link to the role card

### Requirement: ORC disabled and unavailable states
When `enabled` is false, role routing SHALL still resolve every request to the role's default profile without fallbacks, task briefs are not prepared, team runs cannot be started ("Turn on ORC to start a team"), and the settings page shows the notice "ORC is off: every role uses its default profile, with no fallbacks." Every surface that uses a role SHALL handle `NO_ROUTE` by showing "No model is set up for <role label>" with a "Set up" button that opens the role card (admin devices) or the caption "Ask an admin device to set up <role label>". Inside a workflow, team or film run, what a missing route does depends on whether the role is required for that run (`orc-model-routing.Required and optional roles`): a node or step of an **optional** role resolves to `skipped` with reason `no_route` and the run continues; a node or step of a **required** role that fails with `NO_ROUTE` follows the owning engine's state machine — an attended run pauses with `pauseReason: "no_route"` as defined by `agent-workflows.Run state machine`, and an unattended run fails that node. ORC resolution is a host function and requires a connected host; editor features that do not use generation or agents are unaffected by ORC state. [NEW]

#### Scenario: ORC off
- **WHEN** ORC is disabled and the primary image profile fails
- **THEN** the request fails with the provider error and no fallback is tried

#### Scenario: Missing role in a workflow
- **WHEN** an attended workflow node needs the required role `image` and the role is not configured
- **THEN** the node shows "No model is set up for Image" with a "Set up" button and the run is paused with reason `no_route`

#### Scenario: Optional role without a route
- **WHEN** a workflow node needs `lipsync` and the role is not configured
- **THEN** the node resolves to `skipped` with reason `no_route`, the run continues, and the run summary lists "Lip-sync skipped — no model" with a "Set up" link

#### Scenario: Missing role in an unattended run
- **WHEN** the same node runs in a run started by an automation
- **THEN** the node fails with `NO_ROUTE` and the run follows its error routes

### Requirement: Required and optional roles
ORC SHALL classify, for a run that is about to start, which roles it needs as **required** or **optional**, and SHALL answer that through `jagentchill.orc.readiness.check {roles[]: {roleId, routeId?, required: boolean}}` (scope `jagentchill.agent.use`) → `{ready, missingRequired[] {roleId, routeId?, reason}, missingOptional[] {roleId, routeId?, reason, effect}, checklist[] {roleId, label, action}}`. A missing **optional** role never blocks a start: its nodes and steps resolve to `skipped` with reason `no_route`, and the run summary lists each skipped role with what was left out and how to add a provider. A missing **required** role blocks the start with the setup checklist. Which roles a given template or pipeline marks as required is declared by that template (`agent-workflows`, `prompt-to-video-workflow`, `film-production`); the rule they share, which this requirement fixes, is: an LLM route for script and planning is required; at least one of `image` and `video` generation is required for a run that generates visuals; `voice-tts` is required only when narration or dialogue audio is requested; `sfx`, `music`, `voice-design`, `lipsync`, `transcription`, `translation`, `vision` and every stock source are optional. Because the bundled sound pack is a built-in source (`orc-model-routing.Default profiles from the enabled catalogue`), `music` and `sfx` are never missing on a host where the pack is installed. A role that has a route but whose every target is unhealthy at start is reported as missing with `reason: "unhealthy"` and treated by the same required-or-optional rule. [NEW]

#### Scenario: Fresh host with an LLM and an image model
- **WHEN** a one-prompt video run is checked on a host that has only an LLM provider and an image model connected
- **THEN** `ready` is true, `missingRequired` is empty, `missingOptional` lists `video`, `voice-design` and `lipsync` with their effects, and `music` and `sfx` are served by the bundled sound pack

#### Scenario: Required role missing
- **WHEN** the same check runs on a host with no LLM provider
- **THEN** `ready` is false and the checklist names "Connect a model for Director" with the action that opens the provider list

#### Scenario: Narration requested without a voice model
- **WHEN** a run requests narration and `voice-tts` has no route
- **THEN** `voice-tts` is in `missingRequired` and the start is blocked with that item in the checklist

### Requirement: ORC RPC surface
This capability SHALL define exactly the channel P methods of this table under the `orc` domain prefixes `orc.config.*`, `orc.restore.*`, `orc.test.*`, `orc.brief.*`, `orc.override.*` and `orc.readiness.*`, which `server-api.RPC domain ownership` delegates to it within the `orc` domain; the parameters, result and scope of each are stated by the requirement named in its row, and the two events are `jagentchill.orc.config.changed` and `jagentchill.orc.test.updated`.

| Method | Defined in |
|---|---|
| `jagentchill.orc.config.get` | `orc-model-routing.ORC configuration store` |
| `jagentchill.orc.config.update` | `orc-model-routing.ORC configuration store` |
| `jagentchill.orc.config.validate` | `orc-model-routing.Configuration validation` |
| `jagentchill.orc.config.export` | `orc-model-routing.Import and export of an ORC configuration` |
| `jagentchill.orc.config.import` | `orc-model-routing.Import and export of an ORC configuration` |
| `jagentchill.orc.restore.list` | `orc-model-routing.Import and export of an ORC configuration` |
| `jagentchill.orc.restore.apply` | `orc-model-routing.Import and export of an ORC configuration` |
| `jagentchill.orc.test.run` | `orc-model-routing.Test run` |
| `jagentchill.orc.test.cancel` | `orc-model-routing.Test run` |
| `jagentchill.orc.brief.prepare` | `orc-model-routing.Task brief preparation` |
| `jagentchill.orc.override.get` | `orc-model-routing.Quick switch` |
| `jagentchill.orc.override.set` | `orc-model-routing.Quick switch` |
| `jagentchill.orc.readiness.check` | `orc-model-routing.Required and optional roles` |

A handler under one of these prefixes that the table does not name MUST fail the contract test `rpc-ownership`. Every mutating method is called by `admin` devices only except `orc.override.set`, `orc.brief.prepare` and `orc.readiness.check`, and each checks its scope in the handler before reading or writing the ORC document or the Gateway configuration over the gateway link. [NEW]

#### Scenario: Ownership test is exact
- **WHEN** the contract test `rpc-ownership` compares the server's handlers under the six delegated `jagentchill.orc.` prefixes with this table
- **THEN** the two sets are equal

#### Scenario: Restore points have a wire contract
- **WHEN** an admin opens "Restore points"
- **THEN** the list comes from `jagentchill.orc.restore.list` and selecting one calls `jagentchill.orc.restore.apply` with the current revision

#### Scenario: Editor cannot import
- **WHEN** an `editor` device calls `jagentchill.orc.config.import`
- **THEN** the call fails with `SCOPE_DENIED` and the configuration is unchanged
