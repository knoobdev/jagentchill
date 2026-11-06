## ADDED Requirements

### Requirement: Provider registry by capability type
The server SHALL keep a registry of **media capability providers** — JAgentChill is not an OpenClaw plugin, and its own generation providers run inside the server (`server/`) against the contract of `packages/provider-kit` — indexed by capability type. The capability types are: `image`, `video`, `tts`, `voice-design`, `music`, `sfx`, `lipsync`, `transcription`, `translation` and `stock-media`; the type `llm` exists in the type list (ORC roles use it) but LLM providers, their authentication, runtimes, endpoints and presets are owned by `agent-runtimes` and appear in this registry only as read-only references. A provider can offer several capability types. The registry is read on channel P with `jagentchill.provider.list {capability?}` (scope `jagentchill.config.read`), which returns, per provider, `{id, label, description, source: "builtin" | "server" | "endpoint", endpointId?, capabilities[], connection: "connected" | "not_connected" | "invalid", enabled, health, secrets: [{name, set, last4?}], modelCounts {<capability>: {total, enabled}}, docsUrl?, updated_ms}`. Registry changes are sent as the targeted event `jagentchill.provider.changed`. All provider calls are made on the host — by the server itself for `server` and `endpoint` providers, and by the Gateway on the server's request over the gateway link (`server-api.Gateway link`) for `builtin` providers; clients never call a provider directly, so every feature of this capability requires a connected host. The shipped registry SHALL contain at least the providers of this table; the full generated list, with the model catalogue file, is `server/catalog/providers.json` (columns `id | source | capabilities | authFields | hosts | docsUrl`), which is the normative enumeration:

| Provider id | Source | Capabilities | Auth fields |
|---|---|---|---|
| the OpenClaw provider id of every bundled provider plugin whose manifest declares a media contract at the pinned upstream tag | `builtin` | by contract: `contracts.imageGenerationProviders` → image; `videoGenerationProviders` → video; `musicGenerationProviders` → music; `speechProviders` → tts; `mediaUnderstandingProviders` with audio input and `realtimeTranscriptionProviders` → transcription | the provider's own auth profile (owned by `agent-runtimes`) |
| `jc-whisper-local` | `server` | transcription | none (local model file) |
| `jc-llm-translation` | `server` | translation | none — calls the `translation` role's llm route |
| `jc-freesound` | `server` | stock-media (music, sfx) — the sound source named by design D16 | `FREESOUND_API_KEY` |
| `jc-sound-pack` | `server` | music, sfx, stock-media (music, sfx) — the bundled CC0 sound pack of `audio-editing.Bundled sound pack` as a built-in source: a request is answered by keyword search over the pack's catalogue (title, mood, category, tags) and returns the best match as an asset — `music` is matched by mood and duration, `sfx` by keyword and duration — and a request with no match fails with `NOT_FOUND` (`details.reason: "no_results"`); nothing is synthesised | none — always `connected`, health `ready`, works offline, pricing `free`, needs no consent because nothing leaves the host |
| `endpoint:<endpointId>` | `endpoint` | image, video, tts, transcription, music, sfx, voice-design, lipsync and stock-media as declared on the endpoint record | the endpoint's secrets (owned by `agent-runtimes`) |

The product ships **no vendor-named provider adapter of its own**: the only `server` adapters are the four rows above (a local model, a re-use of an llm route, the sound source design D16 names, and the bundled sound pack). Hosted media and speech come from OpenClaw's own bundled provider plugins, which stay OpenClaw's and are reached over the gateway link; their set is read from the manifests under `gateway/openclaw/extensions/*/openclaw.plugin.json` of the pinned tag (read only, never edited) when `providers.json` is generated and is therefore extended by an upstream upgrade without a product change. The table below names the bundled **plugins** per capability at the pinned tag and is orientation, not the contract: one plugin can register more than one provider id (for example `minimax` also registers `minimax-portal`, and speech plugins register ids such as `azure`, `bytedance`, `cli`, `doubao`, `edge` and `mimo`), so the provider-id counts differ from the plugin counts — 12 image, 18 video, 6 music and 22 speech provider ids, and 19 media-understanding provider ids — and the normative enumeration that contract tests read is the generated `providers.json`, whose build check fails when its provider ids and the manifests' contract arrays disagree.

| Capability | Bundled OpenClaw provider plugins |
|---|---|
| image (11 plugins) | `comfy`, `deepinfra`, `fal`, `google`, `litellm`, `microsoft-foundry`, `minimax`, `openai`, `openrouter`, `vydra`, `xai` |
| video (17 plugins) | `alibaba`, `byteplus`, `comfy`, `deepinfra`, `fal`, `google`, `kie`, `minimax`, `novita`, `openrouter`, `pixverse`, `qwen`, `runway`, `together`, `vydra`, `xai`, `zai` |
| music (5 plugins) | `comfy`, `fal`, `google`, `minimax`, `openrouter` |
| tts (16 plugins) | `azure-speech`, `deepinfra`, `elevenlabs`, `fish-audio`, `google`, `gradium`, `inworld`, `microsoft`, `minimax`, `openai`, `openrouter`, `tts-local-cli`, `volcengine`, `vydra`, `xai`, `xiaomi` |
| transcription | batch, through media understanding with audio input: `deepgram`, `deepinfra`, `elevenlabs`, `google`, `groq`, `mistral`, `openai`, `openrouter`, `senseaudio`, `xai` (the audio-capable subset of the 18 media-understanding plugins, confirmed per provider by the adapter contract test); streaming, through `realtimeTranscriptionProviders`: `deepgram`, `elevenlabs`, `mistral`, `openai`, `xai` |

The Gateway has no provider contract for `voice-design`, `sfx`, `lipsync` and `stock-media` at the pinned tag. These four capabilities are served by endpoint-backed providers created from the media and stock presets of `agent-runtimes.Endpoint presets` with the user's own key and the templates of `generation-providers.Media request templates` (and, for sounds, by `jc-freesound` and the always-present `jc-sound-pack`, so that `sfx` and `music` have a route on every host — `orc-model-routing.Required and optional roles`); a model of a bundled plugin serves one of them only when the bundled catalogue tags that model with the capability and the adapter contract test of `generation-providers.Provider adapter contract` passes for it. A capability with no connected provider is shown in Settings and in every tool that needs it as "No provider is configured for <capability>" with "Configure". Every capability type therefore has at least one provider definition or shipped preset. [NEW] [PORT N-017]

#### Scenario: Filter by capability
- **WHEN** a client lists providers with `capability: "video"`
- **THEN** only providers offering at least one video model are returned

#### Scenario: Every capability has a provider definition or a preset
- **WHEN** the registry and the preset list are read on a fresh host
- **THEN** for each of the ten media capability types at least one provider definition or one shipped endpoint preset declaring that capability is returned

#### Scenario: No vendor-named product adapter
- **WHEN** the adapters of the server's provider directory `server/src/providers/` are listed
- **THEN** they are exactly `jc-whisper-local`, `jc-llm-translation`, `jc-freesound` and `jc-sound-pack`

#### Scenario: Bundled speech provider
- **WHEN** an admin connects the bundled `elevenlabs` provider plugin under Sign-in & keys
- **THEN** the registry lists the provider `elevenlabs` with source `builtin` and capability `tts`, and no product-owned secret is created for it

#### Scenario: Upstream adds a media provider
- **WHEN** an upstream upgrade adds a bundled plugin declaring `contracts.videoGenerationProviders`
- **THEN** the regenerated `providers.json` lists it with source `builtin` and capability `video` without any change to product code

#### Scenario: Fresh host
- **WHEN** no provider is connected
- **THEN** the list returns the available provider definitions with `connection: "not_connected"` and no model is routable, except the local providers and `jc-sound-pack`, which is `connected` with capabilities `music` and `sfx`

#### Scenario: Sound effect with no generative provider
- **WHEN** an `sfx` request "door slam" is routed on a host with no sound-effect provider configured
- **THEN** `jc-sound-pack` returns the best-matching bundled sound as an asset with cost 0 and provenance naming the pack

#### Scenario: Provider ids are read from the generated file
- **WHEN** the adapter contract test enumerates image providers at the pinned tag
- **THEN** it reads 12 provider ids from `providers.json`, including `minimax-portal`, and does not read the plugin table

### Requirement: Provider sources
Providers SHALL come from three sources. `builtin`: bundled OpenClaw provider plugins that declare media contracts; generation goes through the Gateway's media provider of that plugin, which the server reaches over its gateway link and never loads into its own process — `tools.invoke` (`operator.write`) of OpenClaw's media tools `image_generate`, `video_generate` and `music_generate` in a server-owned service session of the agent `jagentchill-media`, which has no other tool allowed (`platform-skeleton.Gateway run profile`), and `tts.convert` / `tts.speak` for speech (`gateway/openclaw/docs/gateway/protocol/operator-methods.md`, `gateway/openclaw/docs/gateway/protocol/rpc-talk-config-and-agents.md`); every such method is listed in `CORE_METHODS` of `server-api.Gateway calls over the link`, and which builtin capabilities this path serves is decided by spike S28 of `generation-providers.Provider adapter contract`; the plugin is in `plugins.allow` only while connected, and its credentials are the auth profile managed by `agent-runtimes.API key entry and validation` — one connection enables both chat and generation. `server`: the four adapters that ship with the server and run inside it (`server/src/providers/`) — local transcription (`jc-whisper-local`), translation through an llm route (`jc-llm-translation`), the Freesound sound source (`jc-freesound`) and the bundled sound pack as a built-in `music` and `sfx` source (`jc-sound-pack`) — written against `generation-providers.Provider adapter contract`; no other adapter is shipped, and a hosted vendor is never wrapped by a product adapter. `endpoint`: a media provider backed by an endpoint record of `agent-runtimes.Shared endpoint record`, addressed as `endpoint:<endpointId>`, described by `generation-providers.Media request templates`; this is also the source for the capabilities the Gateway has no provider contract for (voice design, sound effects, lip-sync, stock video and images), connected from a preset of `agent-runtimes.Endpoint presets`. Provider ids match `^[a-z][a-z0-9-]{1,39}$` (endpoint-backed ids are the prefix `endpoint:` plus the endpoint id) and are unique across sources. Connecting a builtin provider SHALL add its plugin id to `plugins.allow` through the Gateway configuration methods (`config.get`, then `config.patch`) called by the server over its gateway link; disconnecting the last use removes it. While the Gateway is not available (`server-api.Gateway supervision and lifecycle`), connecting, disconnecting and generating with a `builtin` provider fail with `GATEWAY_UNAVAILABLE`, and `server` and `endpoint` providers keep working. No file of `gateway/openclaw/` is modified. [NEW]

#### Scenario: Connecting enables the OpenClaw provider plugin
- **WHEN** an admin connects a builtin video provider
- **THEN** its plugin id is present in `plugins.allow` and its models appear in the catalogue

#### Scenario: Builtin provider while the Gateway is down
- **WHEN** the supervised Gateway is restarting and a job for a builtin image provider and a job for an `endpoint` image provider are started
- **THEN** the first fails with `GATEWAY_UNAVAILABLE` and `retryable` true, and the second runs to completion

#### Scenario: Local transcription on a fresh host
- **WHEN** a fresh host starts
- **THEN** `jc-whisper-local` is listed as `connected` for capability `transcription` with health `down` and the reason "Model not installed", and it needs no API key

#### Scenario: Endpoint-backed provider
- **WHEN** an endpoint record declares the capability `image` with the template `openai-images`
- **THEN** a provider `endpoint:<endpointId>` with capability `image` appears in the registry and stores no base URL or key of its own

#### Scenario: Lip-sync through an endpoint preset
- **WHEN** an admin creates an endpoint from a shipped preset that declares the capability `lipsync` and enters a key
- **THEN** a provider `endpoint:<endpointId>` with capability `lipsync` is listed and the `lipsync` role can be given a profile on it

### Requirement: Provider adapter contract
Every `server` provider SHALL implement the interface `JcProviderAdapter` exported by the package `packages/provider-kit`: per capability `describe()` (definition, auth fields, hosts for the egress list), `validateConnection(secrets)`, `validate(request, modelMetadata)`, `submit(request, idempotencyKey)` → `{result}` or `{taskId}`, `poll(taskId)` → `{state, progress?, result?}`, `cancel(taskId)`, `lookup(idempotencyKey)?` (optional: find a task already submitted), and `download(result)` → a byte stream. The server holds the registry and loads the adapters at start; an adapter module under `server/src/providers/` depends only on the kit and never imports another module of the server. JAgentChill registers no provider with the Gateway: `server` and `endpoint` providers exist only in this registry and are reached by agents through the `jc_generate_*` tools of the server's agent tool endpoint (`server-api.Agent tools and provider registration`), never through OpenClaw's own media tools. `builtin` providers are wrapped by one adapter around the Gateway methods named in `generation-providers.Provider sources`, called over the gateway link, with these declared limits: the result bytes are fetched from the Gateway's media output by the server and stored as a host blob before the job succeeds; metadata and pricing come solely from the bundled catalogue keyed by `<openclawProviderId>/<model>` (a builtin model without a catalogue entry is listed disabled with "No capability data"); and unless the wrapped call returns a task handle such jobs are declared `resumable: false` and `cancellable: false`. Resumable polling and provider-side cancel are guaranteed only for `server` and `endpoint` adapters. A contract test per adapter (`diagnostics-quality.Gateway contract tests`) records which builtin providers return task handles. **Spike S28** (`diagnostics-quality.Gating spikes`) gates the builtin path per capability: it passes for a capability when, on the pinned tag, the server obtains over the gateway link — with the four scopes the link holds and no other — a result for one provider of that capability with the requested provider and model honoured, the output bytes retrievable by the server, and the provider's error classified. A capability that fails S28 is not offered from `builtin` providers (their models of that capability are listed disabled with "Not available through the host's agent engine"), and it is served by `endpoint` and `server` providers only; batch transcription and media understanding, for which the Gateway protocol documents no operator method, start in that state until S28 records otherwise. [NEW]

#### Scenario: Adapter without the other extension
- **WHEN** the dependency graph of the adapter modules under `server/src/providers/` is checked
- **THEN** each imports `packages/provider-kit` and no other module of `server/`

#### Scenario: Builtin capability that failed the gateway-link spike
- **WHEN** the S28 record says `fail` for capability `transcription` and an admin connects a builtin provider whose manifest declares media understanding
- **THEN** its transcription models are listed disabled with "Not available through the host's agent engine", no route can select them, and `jc-whisper-local` and endpoint-backed transcription providers are unaffected

#### Scenario: Server adapters are not visible to OpenClaw's media tools
- **WHEN** the contract test lists the Gateway's image generation providers after the server started with an `endpoint` image provider connected
- **THEN** the list contains only OpenClaw's own providers, and the endpoint provider is reachable through `jc_generate_image`

#### Scenario: Builtin model without catalogue data
- **WHEN** a builtin provider offers a model that the bundled catalogue does not describe
- **THEN** the model is listed disabled with "No capability data" and cannot be routed until the user adds metadata

#### Scenario: Non-cancellable builtin job
- **WHEN** the user cancels a running job of a builtin provider that returned no task handle
- **THEN** the job becomes `cancelled`, its result is discarded when it arrives, and the job detail states "The provider can still bill this request"

### Requirement: Provider connection
An `admin` SHALL connect an `server` provider from Settings → Runtimes & providers → Generation by opening its side sheet and filling the fields the provider definition declares: an API key (masked input, 8–512 characters, pasted whitespace trimmed) and, where declared, an organisation or project id, a region, or a second secret. Secret values never travel in an RPC: the client first writes each one with the signed route `PUT /jagentchill/v1/secrets/{name}` of `server-api.Signed HTTP route surface` (scope `jagentchill.secrets.manage`) and then calls `jagentchill.provider.connect {providerId, fields, secretNames[]}` on channel P (scope `jagentchill.config.write`), which runs `generation-providers.Connection validation`; on failure the secrets just written are deleted. On success the provider becomes `connected`, its catalogue is fetched, and unconfigured ORC roles receive default profiles as defined in `orc-model-routing.Default profiles from the enabled catalogue`. `builtin` providers are connected through `agent-runtimes.API key entry and validation` or `agent-runtimes.OAuth login through the admin proxy`, and `endpoint` providers by creating the endpoint record; this page links to those forms and shows the result. A device lacking either scope receives `SCOPE_DENIED` and nothing is stored. [NEW]

#### Scenario: Successful connection
- **WHEN** an admin pastes a valid key and presses "Connect"
- **THEN** the sheet shows "Connected", the provider row shows the healthy icon with its label and the model count, and the key field shows only a hint

#### Scenario: Empty key
- **WHEN** "Connect" is pressed with an empty key
- **THEN** the field shows "Enter an API key" and no request is sent

#### Scenario: Secret is not in the RPC
- **WHEN** the connect call is inspected
- **THEN** its params contain `secretNames` and no secret value

#### Scenario: Device without the scopes
- **WHEN** an `editor` device sends a connect request
- **THEN** it fails with `SCOPE_DENIED` and nothing is stored

### Requirement: Connection validation
Validation SHALL make one authenticated, free-of-charge request to the provider (model list, account or quota endpoint) with a 15 s timeout and classify the outcome: `ok`; `invalid_key` (authentication rejected); `forbidden` (key lacks permission); `network` (DNS, TLS or timeout); `endpoint` (wrong base URL or non-conforming response); `quota` (account has no credit). Only `ok` and `quota` store the credentials (`quota` stores them with health `degraded` and the message "The key is valid but the account has no credit"). The UI SHALL show a spinner on the button during validation, and the mapped message with the provider's raw status code under "Details" on failure. A provider whose API offers no free endpoint is validated by format only and marked "Unverified until first use". "Test connection" on a connected provider repeats the validation through `jagentchill.provider.test {providerId}` (scope `jagentchill.config.write`) → `{outcome, statusCode?, message}`. [NEW]

#### Scenario: Wrong key
- **WHEN** the provider answers 401
- **THEN** the sheet shows "The provider rejected this API key", nothing is stored, and the provider stays `not_connected`

#### Scenario: Network failure
- **WHEN** the request times out after 15 s
- **THEN** the sheet shows "Unable to reach the provider" with "Retry" and nothing is stored

#### Scenario: Valid key without credit
- **WHEN** validation returns `quota`
- **THEN** the provider is `connected` with health `degraded` and the no-credit message

### Requirement: Secret storage
Provider credentials SHALL be stored by the single mechanism of `security-privacy.Host secret storage`: one owner-only file per secret under `<dataDir>/secrets/<name>`, written atomically, referenced from configuration by a file SecretRef, and never returned to a client. This capability owns only the names and their use: an `server` provider's key is `PROVIDER_<ID>_API_KEY` (id upper-cased, hyphens as underscores; a second secret appends `_2`; additional keys append `__<n>`); the Freesound key is `FREESOUND_API_KEY`; `builtin` providers keep their credentials in the Gateway's auth-profile store and `endpoint` providers reference the endpoint's secret names (`agent-runtimes.Credential storage on the host only`). A secret value — a key, a secret header value, or a secret query parameter value of an endpoint (`agent-runtimes.Shared endpoint record`) — MUST NOT be written to the Gateway configuration file (`openclaw.json`), the server configuration file (`<dataDir>/config.json`), the server's SQLite store, project files, exports, ORC configuration, logs, audit records or diagnostics bundles. The server makes no encryption-at-rest claim: settings state "Stored on <host name>, protected by file permissions". No tool or agent file path reaches the secrets directory (`agent-editing-tools.Workspace file tools`). [NEW]

#### Scenario: Configuration holds a reference
- **WHEN** a provider is connected
- **THEN** the configuration contains a file SecretRef for that provider and no key material

#### Scenario: Diagnostics bundle
- **WHEN** the user creates a diagnostics bundle
- **THEN** no file in it contains any stored secret value

#### Scenario: Agent cannot read a secret
- **WHEN** an agent attempts to read the secrets directory through a file tool
- **THEN** the read is refused and audited

### Requirement: Secrets are never exposed to clients
No RPC, event, HTTP route or error message SHALL return a stored secret to any client, including the device that entered it. Clients receive only the read shape of `security-privacy.Host secret storage` — `{name, scope, set, last4?, updated_ms}`, with `last4` present only when the value has at least 12 characters. Secret entry is write-only: the field of a connected provider is empty with the placeholder "Enter a new key to replace". Provider error bodies SHALL be scrubbed of any substring equal to a stored secret before being stored or shown. [NEW]

#### Scenario: Reading a connected provider
- **WHEN** a client requests a connected provider's details
- **THEN** each secret entry has `set: true`, a `last4` of 4 characters when the key has at least 12 characters, and no other key material

#### Scenario: Short key
- **WHEN** the stored key has 10 characters
- **THEN** the entry has `set: true` and no `last4`

#### Scenario: Provider echoes the key in an error
- **WHEN** a provider error body contains the API key
- **THEN** the stored and displayed error shows `[redacted]` in its place

### Requirement: Key replacement and disconnect
An admin SHALL be able to replace a key with `jagentchill.provider.key.replace {providerId, keyId?, secretName}` (the new key is written under a temporary name and validated first; the old key stays active until validation succeeds) and to disconnect a provider with `jagentchill.provider.disconnect {providerId}` (both scope `jagentchill.config.write`). Disconnect requires a confirm dialog that lists the ORC profiles using the provider, deletes its secrets, marks its models unavailable and its ORC profiles unusable, cancels its queued jobs with reason `provider_disconnected`, and lets running jobs finish or fail on their own. The generation cost ledger rows of the provider are kept. An `server` provider can hold up to 5 named keys, managed in the connection card by "Add key" (name 1–24 characters), reorder and "Remove", through `jagentchill.provider.key.add {providerId, label, secretName}` and `jagentchill.provider.key.remove {providerId, keyId}` (scope `jagentchill.config.write`, values written through the secret route): a request moves to the next key in order when one returns `auth_error` or `quota_exhausted`, and a key that fails authentication is marked invalid and skipped until replaced. Keys of `builtin` providers and endpoints follow `agent-runtimes.Multiple auth profiles with order and rotation`. [NEW]

#### Scenario: Replace with a bad key
- **WHEN** the user enters a new key that fails validation
- **THEN** the old key remains in use and the sheet shows the validation error

#### Scenario: Disconnect a provider in use
- **WHEN** the user disconnects a provider used by 3 ORC profiles
- **THEN** the dialog lists the 3 profiles, and after confirming they are marked "Provider not connected"

#### Scenario: Add a second key
- **WHEN** an admin presses "Add key", names it "backup" and enters a valid key
- **THEN** the connection card lists two keys in order

#### Scenario: Key rotation
- **WHEN** the first of two keys returns `quota_exhausted`
- **THEN** the request is retried once with the second key before the retry policy counts an attempt

### Requirement: Model catalogue
Each connected provider SHALL have a model catalogue with entries `{provider, id, label, capability, description?, family?, version?, recommended?: boolean, deprecated?: boolean, enabled, source: "bundled" | "fetched" | "user", metadata, pricing?, updated_ms}`. The catalogue merges, in increasing precedence: the bundled catalogue file `server/catalog/models.json` shipped with the server (one row per `<provider>/<model>` with the columns `provider | model | capability | label | recommended | deprecated | metadata | pricing | asOf`), the provider's live model list (for endpoints: the model list of the endpoint record), and user additions and edits. Models are addressed everywhere by the pair of provider and model id. `jagentchill.provider.model.list {providerId?, capability?, enabledOnly?, query?}` (scope `jagentchill.config.read`) returns the entries. The catalogue is refreshed on connect, on "Refresh models" (`jagentchill.provider.model.refresh {providerId}`, scope `jagentchill.config.write`), and every 24 h; a failed refresh keeps the previous catalogue and sets a notice "Model list is <n> days old". Capability metadata MUST come from the catalogue and never from literals in feature code; a CI check enforces this for the generation service. [NEW]

#### Scenario: Refresh adds a new model
- **WHEN** the provider's live list contains a model absent from the bundled file
- **THEN** it appears with `source: "fetched"`, `enabled: false` and a "New" badge

#### Scenario: Refresh fails
- **WHEN** the refresh request fails
- **THEN** the previous catalogue stays in use and the provider detail shows the age notice

#### Scenario: Deprecated model
- **WHEN** a model is flagged `deprecated`
- **THEN** it is shown with a "Deprecated" badge and is not chosen as an automatic default profile

### Requirement: Capability metadata
Catalogue metadata SHALL describe, per capability: `llm` — context window, maximum output tokens, input modalities (text, image, audio, video), tool calling, `structuredOutput: "json_schema" | "json_object" | "none"`, thinking options (as supplied by `agent-runtimes.Model discovery`); `image` — resolutions, aspect ratios, maximum images per call, reference-image support and maximum reference count, `inpaint` (edit) support, `outpaint` support, `restyle` (image-to-image redraw) support, `upscaleFactors[]`, seed support, negative-prompt support, maximum prompt length; `video` — `modes[]`, the generation modes (`text`, `image`, `first_last_frame`, and `reference` — generation guided by 1 to `maxReferenceImages` reference images of characters, locations or props rather than by a first frame), durations in seconds (enumerated or min/max/step), resolutions, aspect ratios, fps options, audio generation support, reference-image support and count, reference-audio support, first-frame and last-frame support, `inpaint` support, `videoToVideo` (restyle of an input clip) with `maxInputSeconds`, `upscaleFactors[]`, seed support, maximum prompt length, `delivery: "interactive" | "deferred"` with `maxWaitSeconds` (60–86,400) for deferred models; `tts` — voices, languages, speed range, a style or emotion parameter when the model has one, output formats, maximum characters per call, word-timing support; `voice-design` — description length, preview support, `speechToSpeech`, `cloning` (a voice from a recording, gated by the per-voice attestation of `security-privacy.Provenance and likeness rules`); `music` — duration range, instrumental and lyrics support; `sfx` — duration range; `lipsync` — `inputs: ("video" | "image")[]`, maximum duration, resolution; `transcription` — languages, word timestamps, `diarisation` (speaker labels per segment), `streaming`, maximum file size and duration; `translation` — language pairs; `stock-media` — media kinds, licence filters. Every capability also has `resumable` and `cancellable` flags. Requests SHALL be validated against this metadata before any provider call; a value not allowed fails with `INVALID_PARAMS` and the allowed values. Valid combinations that depend on each other (for example a resolution available only for some durations) are expressed as `constraints[]` and enforced. A `deferred` model is shown with "Deferred — up to <h> h" on its jobs and is never an automatic default profile. [NEW]

#### Scenario: First/last-frame support is declared
- **WHEN** a video model's metadata has `modes` without `first_last_frame`
- **THEN** a first/last-frame request to it fails validation with the allowed modes listed and no provider call is made

#### Scenario: Dependent constraint
- **WHEN** a model offers 1080p only for 5 s clips and a 10 s 1080p clip is requested
- **THEN** the request fails with `INVALID_PARAMS` naming the constraint

#### Scenario: Aspect ratio adaptation
- **WHEN** the project is 9:16 and the model lists 9:16 among its aspect ratios
- **THEN** the request is sent with the provider's own parameter for 9:16 and the result is 9:16

#### Scenario: Deferred delivery
- **WHEN** a job is queued on a model with `delivery: "deferred"` and `maxWaitSeconds` 43,200
- **THEN** the job row reads "Deferred — up to 12 h" and polling continues for up to 12 hours

#### Scenario: Reference mode is declared
- **WHEN** a video model's metadata has `modes` containing `reference` and `maxReferenceImages` 3, and a `reference` request carries 4 reference images
- **THEN** the request fails with `INVALID_PARAMS` naming the limit 3 and no provider call is made

#### Scenario: Diarisation flag
- **WHEN** a transcription model declares `diarisation: false`
- **THEN** its transcripts carry no speaker labels and callers that asked for speakers receive the warning `no_diarisation`

### Requirement: User-added and edited models
An admin SHALL be able to add a model to a provider by id, with a label, capability type and metadata entered through a form generated from the capability's metadata schema, and to edit the metadata and pricing of any model; edits are stored as an overlay that survives catalogue refreshes and are marked "Edited" with a "Reset to catalogue" action. A user-added model without metadata uses conservative defaults for its capability (image: 1 image, 1:1, 1024 px; video: text mode, 5 s, 720p, 16:9, no audio) and has no pricing. The methods are `jagentchill.provider.model.upsert {providerId, model: {id, label?, capability, enabled?, metadata?, pricing?}}` (adds a model, or edits the overlay and the `enabled` flag of an existing one) and `jagentchill.provider.model.reset {providerId, modelId}` ("Reset to catalogue"; removes a user-added model), both scope `jagentchill.config.write`. A model without pricing is **unpriced**: it is shown as "Unpriced" in every picker, and subject to the unpriced-model rule of `generation-providers.Budgets with hard stop`. [NEW]

#### Scenario: Add a model by id
- **WHEN** the user adds model id `acme-video-2` with capability `video`
- **THEN** it is listed with `source: "user"`, is selectable in ORC profiles, and shows "Unpriced"

#### Scenario: Reset an edit
- **WHEN** the user presses "Reset to catalogue" on an edited model
- **THEN** its metadata equals the catalogue values again

### Requirement: Media request templates
A custom endpoint that serves media generation SHALL NOT be defined here: its base URL, dialect, credentials, headers, query parameters, TLS options, proxy, timeout, concurrency and model list are the record of `agent-runtimes.Shared endpoint record`, connected once for chat and generation under `agent-runtimes.Endpoint contract for generation capabilities`. This capability stores, per endpoint and non-llm capability, only `{endpointId, capability, template, custom?}` and owns the request and response mapping of the six templates:

| Template | Capability | Request | Result |
|---|---|---|---|
| `openai-images` | image | `POST <baseUrl>/images/generations` (and `/images/edits` when references or a mask are present) with `model`, `prompt`, `n`, `size`, mapped options | `data[].b64_json` or `data[].url` |
| `openai-audio-speech` | tts | `POST <baseUrl>/audio/speech` with `model`, `input`, `voice`, `speed`, `response_format` | binary audio body |
| `openai-audio-transcriptions` | transcription | multipart `POST <baseUrl>/audio/transcriptions` with `file`, `model`, `language`, `timestamp_granularities` | `text`, `segments[]`, `words[]` |
| `openai-videos` | video | `POST <baseUrl>/videos` with `model`, `prompt`, `seconds`, `size`, reference input; then `GET <baseUrl>/videos/{id}` until `completed` or `failed`; then `GET <baseUrl>/videos/{id}/content` | binary video body |
| `custom` | image, video, tts, transcription, music, sfx, voice-design, lipsync | defined by the `custom` object below | defined by the `custom` object |
| `stock-search` | stock-media | defined by the `stock` object below | a page of stock items and, on download, the item's bytes |

`custom` has the closed schema `{uploads?: Upload[] (0–4), request: {method: "POST" | "GET", path, headers?: {<name>: string}, encoding: "json" | "multipart" (default `json`), bodyTemplate?: object, parts?: Part[] (1–16)}, result: {kind: "url" | "base64" | "binary", jsonPath?, contentType?}, async?: {statusPath, statusMethod?: "GET" | "POST", stateJsonPath, successValues[], failureValues[], taskIdJsonPath, pollIntervalSeconds (1–60), maxWaitSeconds (10–43,200, default 900), errorJsonPath?, cancelPath?}}`. **Multipart upload**: with `encoding: "multipart"` the request body is `multipart/form-data` built from `parts[]`, each `{name, value}` (a string that can contain placeholders) or `{name, file: "image" | "audio" | "video" | "mask" | "reference", fileName?, contentType?}`, where the file bytes are the corresponding input asset streamed from the host blob store (never loaded whole into memory; at most 2 GiB per part); `bodyTemplate` is then forbidden, and with `encoding: "json"` `parts` is forbidden. **Upload steps**: each `Upload` is `{id (^[a-z][a-z0-9_]{0,23}$), method: "POST" | "PUT", path, encoding: "json" | "multipart" | "binary", bodyTemplate? | parts? | file?, resultJsonPath, putUrlJsonPath?}`; uploads run in order before `request`, each result (a file id or a URL the service returned) is available to following steps and to `request` as `{{upload.<id>}}`, and a service that returns a pre-signed upload address is served by `putUrlJsonPath` — the host then `PUT`s the file bytes to that address, which MUST be on a host of the endpoint's egress entry (`EGRESS_BLOCKED` otherwise). **Asynchronous jobs**: with `async`, the host reads the task id at `taskIdJsonPath`, polls `statusPath` every `pollIntervalSeconds` until `stateJsonPath` holds a success or failure value or `maxWaitSeconds` passes (class `timeout`), reads a failure message at `errorJsonPath`, survives a server restart by re-attaching to the stored task id, and calls `cancelPath` when the job is cancelled. **Binary and URL results**: `result.kind: "binary"` stores the response body itself (final response, or the body of a `GET` to the path at `jsonPath` when `async` is used) with the media type from `contentType` or the response header; `result.kind: "url"` downloads the address found at `jsonPath`, following at most 3 redirects, only from hosts that are rows of the endpoint's egress entry, with the endpoint's auth header sent only to the endpoint's own host; `base64` decodes the string at `jsonPath`. These features exist so that lip-sync, voice-design, sound-effect and video-to-video services — which take files by upload and answer asynchronously — are reachable through endpoint records (`agent-runtimes.Endpoint presets`). `bodyTemplate` string values can contain the placeholders `{{model}}`, `{{prompt}}`, `{{negativePrompt}}`, `{{width}}`, `{{height}}`, `{{aspectRatio}}`, `{{durationSeconds}}`, `{{seed}}`, `{{voice}}`, `{{text}}`, `{{language}}`, `{{imageBase64}}`, `{{audioBase64}}`, `{{videoBase64}}` (each refused above 20 MiB of source data with the hint to use a multipart part or an upload step), `{{upload.<id>}}`, `{{description}}`, `{{sampleText}}`, `{{lyrics}}`, `{{instrumental}}` and `{{taskId}}` (paths only); the host never advertises an address of its own to a provider, so there is no placeholder that exposes a host URL for a provider to fetch; an unknown placeholder, a reference to an undeclared upload id, a path that is absolute or contains a scheme or host, a header named `Authorization` or equal to the endpoint's auth header, or a missing `jsonPath` for `url` and `base64` results fails validation with `INVALID_PARAMS` naming the field. `stock` has the closed schema `{kinds: ("video" | "image" | "music" | "sfx")[], search: {method: "GET" | "POST", path, query?: {<name>: string}, bodyTemplate?: object, itemsJsonPath, fields: {itemId, title?, previewUrl, downloadUrl, duration?, width?, height?, author?, sourceUrl?, licenseId?} (each a JSON path relative to an item), paging: {kind: "page" | "cursor", param, nextJsonPath?}}, license: {fixed: {id, name, url, attributionRequired, commercialUse}} | {map: {<licenseId>: {id, name, url, attributionRequired, commercialUse}}}}` with the placeholders `{{query}}`, `{{kind}}`, `{{orientation}}`, `{{minDuration}}`, `{{maxDuration}}`, `{{limit}}`, `{{page}}` and `{{cursor}}`; an item whose licence id is not in `map` is dropped from results, and a `downloadUrl` or `previewUrl` on a host that is not a row of the endpoint's egress entry is refused with `EGRESS_BLOCKED`. A profile's `params.extraBody` (`orc-model-routing.Profile schema`) is merged into the body after the template. Every call goes through the single host-side endpoint client of `agent-runtimes`, which applies auth, headers, query, TLS, the shared `maxConcurrency`, egress rules, health accounting and error normalisation. The earlier limit of 20 custom providers no longer exists; the limit is the 40 endpoint records of `agent-runtimes`. [NEW]

#### Scenario: Image endpoint with the standard template
- **WHEN** an endpoint has the capability `image` with template `openai-images` and an image is requested
- **THEN** the host posts to `<baseUrl>/images/generations` with the endpoint's credentials and stores the returned image as an asset

#### Scenario: Asynchronous custom video template
- **WHEN** a custom template declares a status path with `successValues: ["succeeded"]`, `failureValues: ["failed"]` and a 5 s poll interval
- **THEN** a generation polls that path every 5 s and completes when the state is `succeeded`, storing the file found at the result path

#### Scenario: Invalid custom template
- **WHEN** a custom template's `bodyTemplate` contains `{{apiKey}}`
- **THEN** saving fails with `INVALID_PARAMS` naming the placeholder and the template is not stored

#### Scenario: Template tries to set credentials
- **WHEN** a custom template declares a header `Authorization`
- **THEN** saving fails with `INVALID_PARAMS`

#### Scenario: No connection data is stored here
- **WHEN** the stored media configuration of an endpoint-backed provider is read
- **THEN** it contains the endpoint id and the template and no base URL, key, header or TLS setting

#### Scenario: Stock source from a preset
- **WHEN** an endpoint created from a stock preset declares `stock-media` with the `stock-search` template for the kinds `video` and `image`, and a stock search for "city at night" runs
- **THEN** the host calls the template's search path with the endpoint's key, returns items carrying the mapped licence, and the client contacts no stock host

#### Scenario: Unmapped licence is dropped
- **WHEN** a search response contains an item whose licence id is absent from the template's `license.map`
- **THEN** that item is not returned

#### Scenario: Lip-sync through uploads and polling
- **WHEN** a `custom` lip-sync template declares two upload steps (video, audio), a JSON request that references `{{upload.video}}` and `{{upload.audio}}`, `async` with a 5 s poll, and `result.kind: "url"`
- **THEN** the host uploads both files, submits the job, polls until the success value, downloads the result from a host of the endpoint's egress entry and stores it as a video asset

#### Scenario: Multipart request with a file part
- **WHEN** a template has `encoding: "multipart"` with parts `{name: "audio", file: "audio"}` and `{name: "text", value: "{{description}}"}`
- **THEN** the request is `multipart/form-data` with the audio asset streamed as the file part

#### Scenario: Binary response
- **WHEN** a sound-effect template declares `result.kind: "binary"` and the service answers with an `audio/mpeg` body
- **THEN** the body is stored as an audio asset

#### Scenario: Result address on another host
- **WHEN** a `url` result names a host that is not a row of the endpoint's egress entry
- **THEN** the job fails with `EGRESS_BLOCKED` and nothing is downloaded

### Requirement: Enable and disable
A provider and each of its models SHALL have an `enabled` flag. Disabling a provider keeps its credentials and catalogue, makes all its models unroutable, marks its ORC profiles unusable with the reason "Provider disabled", leaves running jobs to finish, and fails its queued jobs with `provider_disabled`. Disabling a model has the same effect for that model. Newly fetched models are disabled by default; bundled models flagged `recommended` are enabled at connect. Bulk actions "Enable all" and "Disable all" exist per capability on the provider detail. The provider flag and its limits are written with `jagentchill.provider.update {providerId, enabled?, limits?}` and a model's flag with `jagentchill.provider.model.upsert` or, in bulk, `jagentchill.provider.model.setEnabled {providerId, capability?, modelIds? , enabled}` (scope `jagentchill.config.write`). [NEW]

#### Scenario: Disable a provider
- **WHEN** the user turns a provider off
- **THEN** its models disappear from ORC profile pickers and its profiles show "Provider disabled"

#### Scenario: Re-enable
- **WHEN** the provider is turned back on
- **THEN** its profiles become usable again without re-entering the key

### Requirement: Health status
Each `builtin` and `server` provider SHALL have a health state: `ready`, `degraded`, `down`, `unauthorized`, `unknown` (connected, no call yet) or `disabled`, computed on the host from real calls and from a free probe (the validation request) run every 15 minutes while the provider is connected. Rules: an authentication failure sets `unauthorized` until a successful validation; 3 consecutive network or server failures set `down` and open a circuit for 60 s during which calls to the provider fail immediately with class `model_unavailable` (so fallbacks apply), followed by one probe call; a transient failure rate of at least 20% over the last 20 calls sets `degraded`; otherwise `ready`. Health MUST NOT be probed with paid calls. An `endpoint` provider has no health of its own: it shows the health of its endpoint record (`agent-runtimes.Endpoint health`), and generation calls count toward that record's accounting. The state, its reason, the last success time and the last error are shown as an icon with a text label on the provider row, in ORC profile pickers, in ORC route rows and in the quick switch. [NEW]

#### Scenario: Circuit opens
- **WHEN** three consecutive calls to a provider time out
- **THEN** its health is `down`, calls in the next 60 s fail immediately with `model_unavailable`, and routes with fallbacks use them

#### Scenario: Recovery
- **WHEN** the probe after the 60 s window succeeds
- **THEN** the health returns to `ready` and calls are sent again

#### Scenario: Revoked key
- **WHEN** a call returns an authentication error
- **THEN** the health is `unauthorized` and a notice "Reconnect <provider>" appears in settings

#### Scenario: Endpoint-backed provider
- **WHEN** the endpoint behind `endpoint:my-router` becomes `unreachable`
- **THEN** the provider row shows that endpoint health and no separate probe is made

### Requirement: Concurrency and rate limits
Each provider SHALL have limits `{maxConcurrent per capability, requestsPerMinute?, tokensPerMinute?}` with defaults from the bundled catalogue (when absent: image 4, video 2, tts 4, voice-design 1, music 1, sfx 2, lipsync 2, transcription 2, translation 4 concurrent; no per-minute limit) and admin-editable (`jagentchill.provider.update {providerId, limits}`) within 1–64 concurrent and 1–10,000 requests per minute; an `endpoint` provider uses the endpoint record's single `maxConcurrency` across capabilities. Admission of a provider job is the minimum of: this provider-per-capability limit, the ORC role limit (`orc-model-routing.Role limits`) and the limit of the run that issued it (workflow, team or film); the queue-wide `queue.maxConcurrent` of `server-api.Job concurrency limits` applies to local job kinds only and never to provider jobs. Requests above a limit wait in the single host queue ordered by **priority class** — `interactive` (chat tool calls and single user actions) before `batch` (workflow, team and film runs) before `automation` — and first-in-first-out inside a class. A provider response indicating rate limiting SHALL pause new requests to that provider for the time stated by the provider's retry header, or for 10 s doubling up to 120 s when none is given, and the waiting jobs show "Waiting for provider rate limit". Limits hold across all sessions and survive a server restart because they are enforced by the single queue. [NEW]

#### Scenario: Concurrency limit
- **WHEN** 6 video requests are submitted to a provider with `maxConcurrent` 2
- **THEN** 2 are running and 4 are queued with their queue positions

#### Scenario: Provider rate limit
- **WHEN** the provider answers with a rate-limit response carrying a 30 s retry time
- **THEN** no new request is sent to it for 30 s and queued jobs show the waiting status

#### Scenario: Interactive priority
- **WHEN** a film batch has 20 queued image jobs and a chat session requests one image
- **THEN** the chat request is started before the remaining batch jobs

#### Scenario: Queue-wide cap does not throttle providers
- **WHEN** `queue.maxConcurrent` is 4 and two providers each allow 4 concurrent image jobs
- **THEN** 8 image jobs can run at once

### Requirement: Generation job lifecycle
There SHALL be exactly **one job queue** in the product. Its surface — the job table, the states `queued → running → succeeded | failed | cancelled`, the job RPCs, the event `jagentchill.job.updated` (at most 4 per second per job, terminal events never dropped), the 15 s heartbeat and 90 s stall detection, restart recovery of local kinds, and retention — is owned by `server-api.Background job queue` and `server-api.Job RPCs and events`. This capability owns the **contract for provider jobs** in that queue. Kinds: `generation.image`, `generation.video`, `generation.tts`, `generation.voice-design`, `generation.music`, `generation.sfx`, `generation.lipsync`, `generation.transcription`, `generation.translation`. Fields added to the queue's job record: `{capability, role, route, provider, model, params, projectId?, filmId?, sessionId?, agentId?, rootId?, runId?, nodeId?, automationId?, toolCallId?, batchId?, targetType?, targetId?, priority: "interactive" | "batch" | "automation", attempts[] {n, route, provider, model, keyId?, errorClass?, started_ms, duration_ms}, providerTaskId?, resumable, cancellable, estimateUsd?, actualUsd?, cacheHit, usedFallback, resultAssetIds[]}`. The queue itself never retries or re-queues a provider job: attempts inside a job are made by `generation-providers.Retry policy` and the route order of `orc-model-routing.Route resolution and fallback`. Asynchronous provider tasks are polled (interval from the adapter, default 5 s) and `providerTaskId` is persisted before the first poll. **Restart**: a `running` job with a `providerTaskId` resumes polling without resubmitting; one without is first looked up by its idempotency key when the adapter implements `lookup`, and otherwise waits 10 minutes and is then re-submitted exactly once with the notice "The provider can bill this request twice" on the job. Cancelling sends the provider's cancel request when `cancellable` and marks the job `cancelled`; cost already incurred is recorded. Notifications use only kinds of `notifications.Notification event catalogue`: jobs sharing a `batchId` (one session turn, workflow run, film step or Film Studio batch action) raise one `generation.batch_finished` with the succeeded and failed counts when the last of them is terminal, a failed job outside a batch raises `generation.failed`, and a successful single job raises nothing. Terminal jobs are kept 30 days. Reading jobs needs `jagentchill.projects.read`; creating a provider job needs `jagentchill.generation.run`. [NEW]

#### Scenario: Restart during an asynchronous video job
- **WHEN** the server restarts while a video job is waiting on a provider task
- **THEN** after restart the job is `running`, polling continues with the stored task id, and no second task is submitted

#### Scenario: Restart without a task id
- **WHEN** the server restarts while a job was being submitted to an adapter without `lookup`
- **THEN** the job is re-submitted once after 10 minutes and shows "The provider can bill this request twice"

#### Scenario: Queue does not retry provider jobs
- **WHEN** a provider job fails after the retry policy and all fallbacks
- **THEN** the job is `failed` and the queue does not re-queue it

#### Scenario: Cancel a queued job
- **WHEN** the user cancels a queued job
- **THEN** it becomes `cancelled`, no provider call is made, and its budget reservation is released

#### Scenario: Progress updates
- **WHEN** a provider reports 40% progress
- **THEN** subscribed clients receive `jagentchill.job.updated` with `progress: 0.4` within 1 s

#### Scenario: One notification per batch
- **WHEN** a batch of 18 panel-image jobs with one `batchId` ends with 16 succeeded and 2 failed
- **THEN** exactly one `generation.batch_finished` notification is raised stating 16 succeeded and 2 failed, and no per-job notification is raised

### Requirement: Retry policy
There SHALL be exactly **one retry policy** for provider calls in the product, defined here and referenced — never restated with other numbers — by `orc-model-routing`, `agent-workflows`, `multi-agent-orchestration`, `film-production`, `prompt-to-video-workflow`, `ai-editing-tools` and `automations`. Other capabilities cite it as `generation-providers.Retry policy`. For each route candidate: **three attempts** — the initial attempt, a second 2 s after the first failure and a third 8 s after the second failure — each delay with up to 20 % random jitter added; when the third attempt fails, the host waits 30 s (with the same jitter) and then makes the first attempt on the next candidate of the ORC route order, provided the failure class is in the route's `fallbackOn` set. The 30 s wait belongs to the change of route: it is not a fourth attempt and is not applied after the last candidate. An attempt is retried only when its class is retryable per `generation-providers.Error and content-safety mapping` (`rate_limited`, `timeout`, `server_error`, `network`, `model_unavailable`, and `invalid_output` and `unknown` once each — one retry, so at most two attempts per candidate for these two classes); `auth_error`, `quota_exhausted` and `capability_mismatch` skip straight to the next candidate; `content_blocked`, `invalid_request`, `forbidden`, `budget_exceeded` and `cancelled` end the job at once. A `rate_limited` response that carries a retry time replaces the delay with that time, capped at 120 s. Moving to another key of the same provider (`generation-providers.Key replacement and disconnect`) or to an equivalent endpoint (`agent-runtimes.Failover across keys and endpoints`) happens inside one attempt and does not consume an attempt. **LLM steps** (structured-output calls of workflow, film and script steps, made by the job runner or by a `tool` node): output that is not valid against the step's schema after one lenient repair pass, or that breaks an invariant the step's owner states, is class `invalid_output`; the single retry on the same candidate re-sends the request with the list of violations appended (at most 20 violations, 2,000 characters), a second invalid result moves to the next candidate after the 30 s wait when `invalid_output` is in `fallbackOn`, and when no candidate remains the step fails with its owner's code (`WORKFLOW_AGENT_OUTPUT_INVALID`, `FILM_MODEL_OUTPUT_INVALID`, `SCRIPT_CONSTRAINT_VIOLATION`) carrying `details.class: "invalid_output"`. Every invalid attempt is billed and recorded like any other attempt, and no partial result of a failed step is written. Corrective rounds inside one agent turn (`agent-workflows.Agent node structured output`) are that requirement's own limit and are not attempts of this policy. The policy has no user setting. Local job kinds (`media.*`, `export.*`, `render.frame`, `workflow.record`, `ai.analysis`) are not provider calls and use the queue's own policy in `server-api.Background job queue`. [NEW]

#### Scenario: Three attempts then fallback
- **WHEN** the primary returns `server_error` on every attempt and one fallback exists
- **THEN** attempts start at 0 s, about 2 s and about 10 s, and the fallback is tried about 30 s after the third failure

#### Scenario: Authentication error skips retries
- **WHEN** the primary returns `auth_error`
- **THEN** no second attempt is made on the primary and the next candidate is tried

#### Scenario: Content block ends the job
- **WHEN** the primary returns `content_blocked` and `fallbackOn` is the default set
- **THEN** the job fails after one attempt

#### Scenario: Retry time from the provider
- **WHEN** a `rate_limited` response carries a retry time of 20 s
- **THEN** the next attempt starts 20 s after the failure instead of 2 s

#### Scenario: Jitter bound
- **WHEN** 100 second attempts are observed
- **THEN** every delay before them lies between 2.0 s and 2.4 s

#### Scenario: No wait after the last candidate
- **WHEN** the last candidate of a route fails its third attempt
- **THEN** the job fails at once with `details.attempts[]` and no 30 s wait is added

#### Scenario: Invalid structured output of an LLM step
- **WHEN** a film analysis step returns JSON that fails its schema on the first attempt and valid JSON on the retry
- **THEN** exactly two attempts are recorded on that candidate, the second request carried the list of violations, and the step succeeds

#### Scenario: Invalid output twice
- **WHEN** the same step returns invalid output on both attempts of the primary and one fallback exists with the default `fallbackOn`
- **THEN** the fallback's first attempt starts about 30 s after the second failure

### Requirement: Generated outputs become media assets
A succeeded generation job SHALL download the provider's output to the host blob store (addressed by sha256), verify it is a decodable file of the expected kind, and register it as a media asset in the target project's library (or the session's asset list when no project is bound) with provenance `{provider, model, role, prompt, params, seed?, referenceAssetIds[], jobId, costUsd, created_ms}`. Provider-hosted result URLs MUST NOT be stored as the asset location. Outputs larger than 5 GiB, or that fail to decode, fail the job with class `invalid_output`. The asset then syncs to devices through `cross-device-sync` like any other media. [NEW]

#### Scenario: Result is stored locally
- **WHEN** a video job succeeds
- **THEN** the file is in the host blob store, the asset has provenance, and playback works after the provider's URL has expired

#### Scenario: Corrupt output
- **WHEN** the downloaded file cannot be decoded
- **THEN** the job fails with `invalid_output` and no asset is created

### Requirement: Cost model
Each model's `pricing` SHALL be one of: `tokens {inputPerMillionUsd, outputPerMillionUsd, cachedInputPerMillionUsd?}`; `per_image {baseUsd, tiers?[] {when {resolution?, quality?}, usd}}`; `per_second {usd, tiers?[] {when {resolution?, audio?, mode?}, usd}}` (video, music, sfx, lip-sync, transcription); `per_clip {tiers[] {when {durationSeconds?, resolution?, audio?}, usd}}`; `per_character {perThousandUsd}` (tts, translation); `per_call {usd}` (voice design, stock download); or `free` (local providers). Tiers are evaluated in order and the first whose `when` matches applies. Amounts are stored in USD with 6 decimal places. The bundled price table carries an `asOf` date shown in the UI ("Prices as of <date>"); the user can override any model's pricing, and overridden prices are marked "Custom price". A model without pricing is **unpriced**: its cost is unknown, it is labelled "Unpriced" wherever models are listed, and it is governed by the unpriced-model rule of `generation-providers.Budgets with hard stop`. Prices of models reached through endpoints and aggregators are resolved by `agent-runtimes.Usage and pricing through endpoints` and use the `tokens` shape defined here. [NEW]

#### Scenario: Tiered video price
- **WHEN** a model has `per_second` tiers 720p → 0.05 and 1080p → 0.10 and a 10 s 1080p clip is requested
- **THEN** the estimate is 1.00 USD

#### Scenario: Custom price
- **WHEN** the user sets a custom price for a model
- **THEN** estimates use it and the model shows "Custom price"

### Requirement: Cost estimate
`jagentchill.provider.estimate {items[] {role | {provider, model}, capability, params, inputSize?}}` SHALL return per item `{amountUsd | null, basis, breakdown, confidence: "exact" | "upper_bound" | "approximate" | "unknown"}` and a total. Rules: per-image, per-clip, per-call and per-second generation with a fixed duration are `exact`; llm estimates use the request's token count plus the model's maximum output tokens as `upper_bound`; tts and translation use the character count as `exact`; transcription uses the media duration; unknown pricing gives `null` with `unknown`. Every costed action in the product (generation tools, workflow start, film step runs, ORC test runs, automations with generation) SHALL display its estimate before it runs, formatted as "$0.00" with 2 decimals (4 decimals below 0.01 USD) and "≈" for non-exact estimates, or "Cost unknown". Estimating has no side effect and completes within 300 ms for 100 items. [NEW]

#### Scenario: Batch estimate
- **WHEN** 12 images at 0.04 USD each are estimated
- **THEN** the total is 0.48 USD with confidence `exact`

#### Scenario: Unknown pricing
- **WHEN** an item uses a model without pricing
- **THEN** its amount is `null`, the UI shows "Cost unknown", the total is labelled "excluding unknown items", and the item is marked as blocked when a hard-stop budget without "Allow unknown-cost models" applies

### Requirement: Usage ledger
The host SHALL record every provider attempt of the generation service in an append-only **generation cost ledger** row: `{id, timestamp_ms, provider, model, capability, role?, route?, projectId?, filmId?, filmEpisodeId?, filmStage?, endpointId?, upstreamProvider?, sessionId?, agentId?, rootId?, runId?, nodeId?, automationId?, jobId?, toolCallId?, tag?, units {inputTokens?, outputTokens?, cachedTokens?, images?, seconds?, characters?, calls?}, estimateUsd?, actualUsd?, priceSource: "provider" | "aggregator" | "catalogue" | "admin" | "none", outcome: "succeeded" | "failed" | "cancelled", errorClass?, cacheHit, usedFallback, servedBy?, duration_ms}`. `actualUsd` uses provider-reported usage when the response includes it and the cost model otherwise; an unpriced model gives `actualUsd: null` and `priceSource: "none"` (the same five values as `usage-tracking.Per-turn usage record`: `provider` when the provider reported the cost, `admin` for a user-overridden price). Failed attempts that the provider bills are recorded with their cost. Rows never contain prompts, outputs or secrets. The ledger is stored in the server's SQLite store and kept for 24 months. Agent turns are never written here (`usage-tracking.Usage sources and single accounting`). The ledger has **no client-facing query, view or export of its own**: it exposes a host-internal query interface that `usage-tracking.Unified usage query` (`jagentchill.usage.query`) reads, and every usage screen, session usage view, CSV export and reset rule is owned by `usage-tracking`. Deleting a session or project keeps its ledger rows with the id retained. Ledger data MUST NOT be sent off the host. [NEW]

#### Scenario: Fallback attempts are both recorded
- **WHEN** a request fails on the primary and succeeds on a fallback
- **THEN** rows exist for every attempt, the last one `succeeded` with `usedFallback: true`

#### Scenario: Cache hit
- **WHEN** a request is served from the result cache
- **THEN** one row exists with `cacheHit: true` and `actualUsd: 0`

#### Scenario: Single query surface
- **WHEN** a client asks for generation cost by project
- **THEN** it uses `jagentchill.usage.query`, and no `jagentchill.provider.*` method returns ledger rows

#### Scenario: Agent attribution
- **WHEN** a team member's tool call generates an image
- **THEN** the ledger row carries that member's `agentId`, the tree's `rootId` and the `runId`

### Requirement: Budgets with hard stop
Budgets SHALL be amounts in USD only (there is no currency selector) at these scopes: `global` per calendar month, `provider` per calendar month, `project` (total or per calendar month), `film` (total), `session`, `run` (one workflow, team or film run) and `automation` per calendar month. Each budget is `{scope, scopeId?, limitUsd (0.01–100,000), period: "month" | "total", hardStop: boolean (default true), warnAt: 0.8, allowUnknownCost: boolean (default false)}`, managed with `jagentchill.provider.budget.list | set | remove` on channel P. Creating a `global`, `provider`, `project`, `film` or `automation` budget, and **raising or removing a budget of any scope**, needs `jagentchill.config.write` (role `admin`). A device with `jagentchill.generation.run` can create a `session` or `run` budget where none exists, up to the host maximum `budgets.maxSelfServiceUsd` (default 50.00, range 0–10,000), and can lower it; it cannot raise or remove it afterwards. **Reservation**: before a costed request is queued the host reserves its estimate against every applicable budget atomically; when a hard-stop budget would be exceeded (spent + reserved + estimate > limit) the request is blocked **before** the provider call with `BUDGET_EXCEEDED` and `details {scope, scopeId, remainingUsd}`. On completion the reservation is replaced by the actual cost; on failure or cancellation it is released. Agent-turn cost is committed to the same budgets by `usage-tracking.Budgets hook`. **Unpriced models**: a request whose model has no price (cost unknown) is refused under any applicable hard-stop budget with `BUDGET_EXCEEDED` and `details.reason: "unpriced_model"`, unless every such budget has "Allow unknown-cost models" (`allowUnknownCost`) on, in which case it proceeds, counts as 0 and budget views state "includes unpriced usage"; with no hard-stop budget in scope it proceeds after the approval of `generation-providers.Approval thresholds and spending caps`. **Behaviour at the limit** is one rule per caller class: a chat tool call fails and the session shows the "Budget reached — <scope>" card with "Raise budget" and "View usage"; an attended workflow, team or film run pauses with `pauseReason: "budget_exceeded"` (`agent-workflows.Budgets during a run`); an unattended run or automation fails that step with `BUDGET_EXCEEDED`. No surface, flag, tool parameter, run mode, approval policy or agent offers a bypass of a hard stop, one-time or otherwise; the only way on is an admin device raising or removing the budget, and on other devices the "Raise budget" action reads "Ask an admin device"; the block itself raises the notification kind `usage.limit_reached` (`notifications.Notification event catalogue`), which reaches admin devices with the "Raise budget" action. A hard stop does not cancel running jobs. Reservations survive a server restart; reservations of jobs that no longer exist are released at startup. Non-hard-stop budgets only warn. [NEW]

#### Scenario: Hard stop
- **WHEN** a project budget of 10.00 USD has 9.60 spent and a 0.90 USD request arrives
- **THEN** the request fails with `BUDGET_EXCEEDED`, `details.remainingUsd` is 0.40 and no provider call is made

#### Scenario: Concurrent requests cannot overspend
- **WHEN** two 0.30 USD requests arrive at the same moment with 0.40 USD remaining
- **THEN** exactly one is accepted and the other fails with `BUDGET_EXCEEDED`

#### Scenario: Reservation released on failure
- **WHEN** an accepted request fails without being billed
- **THEN** the budget's available amount returns to its value before the request

#### Scenario: Unpriced model refused
- **WHEN** a request resolves to an unpriced model while a hard-stop project budget has "Allow unknown-cost models" off
- **THEN** the request fails with `BUDGET_EXCEEDED` and `details.reason` is `unpriced_model`

#### Scenario: Unpriced model allowed
- **WHEN** the same request is made after "Allow unknown-cost models" was turned on for every applicable hard-stop budget
- **THEN** the request proceeds, counts as 0, and the budget view states "includes unpriced usage"

#### Scenario: Film budget
- **WHEN** a film has a total budget of 40.00 USD with 39.50 spent and a 1.00 USD panel video is requested
- **THEN** the request fails with `BUDGET_EXCEEDED` naming the scope `film`

#### Scenario: Unattended run at the limit
- **WHEN** an automation run's step would exceed the automation's monthly budget
- **THEN** the step fails with `BUDGET_EXCEEDED` and nothing is spent

#### Scenario: Month rollover
- **WHEN** a monthly budget was exhausted and a new calendar month starts in the host's time zone
- **THEN** requests are accepted again

#### Scenario: Editor cannot raise a budget
- **WHEN** an `editor` device calls `jagentchill.provider.budget.set` to raise an existing session budget from 5.00 to 20.00 USD
- **THEN** the call fails with `SCOPE_DENIED`, the budget is unchanged, and the card offers "Ask an admin device"

#### Scenario: Editor creates and lowers a run budget
- **WHEN** an `editor` device sets a run budget of 10.00 USD on a run that has none and then lowers it to 6.00 USD
- **THEN** both calls succeed

#### Scenario: No bypass parameter
- **WHEN** a tool call, a run start or an automation carries any parameter asking to ignore budgets
- **THEN** the request fails validation with `INVALID_PARAMS` and budgets are evaluated unchanged elsewhere

### Requirement: Approval thresholds and spending caps
There SHALL be exactly **one set** of spending thresholds and caps in the product (design D11), defined here and referenced by every other capability. They apply in this order, and the first that blocks decides:

| # | Rule | Default | Range | Where it applies | Who can change it |
|---|---|---|---|---|---|
| 1 | Hard-stop budgets of `generation-providers.Budgets with hard stop` | none set | — | every costed call and agent turn | per that requirement |
| 2 | **Per-call approval threshold**: in Edit mode, costed calls of one assistant message whose total estimate exceeds it, or any unknown estimate, need approval | 0.50 USD | 0–100 USD (0 = always ask) | sessions in `edit` | `jagentchill.config.write` (host), lower-only per session by `jagentchill.agent.use` |
| 3 | **Auto-mode session budget**: in Auto mode costed work is approved automatically while the session tree's cumulative estimated spend stays within it, and needs approval beyond it | 5.00 USD | 0–1,000 USD | sessions in `auto`, including their agent trees and the autonomous runs and loops they contain | host default: `jagentchill.config.write`; per session: lowering by `jagentchill.agent.use`, raising by `jagentchill.generation.run` up to `budgets.maxSelfServiceUsd` (this is an approval threshold, not a hard-stop budget) |
| 4 | **Per-run ceilings** of autonomous runs and loops (`multi-agent-orchestration.Autonomous control`, `multi-agent-orchestration.Worker and verifier loops`): 2,000 turns, 12 hours and 50.00 USD accumulated per run | 2,000 turns / 12 h / 50.00 USD | as stated there; an admin can lower them | each autonomous run and each loop | `jagentchill.config.write` |
| 5 | **Approval prompt timeout**: a cost, consent or tool-permission prompt nobody answers expires — an attended session or run keeps the call unqueued and can ask again; an unattended run or automation fails that step. Policy sign-offs (`multi-agent-orchestration.Human approval`) are not prompts of this rule: they park and never expire on a timer | 30 minutes (`APPROVAL_TIMEOUT`; `PERMISSION_DENIED` for consent) | fixed | every cost, consent and tool-permission card | card behaviour: `agent-editing-tools.Approval for out-of-project effects`; unattended behaviour: `multi-agent-orchestration.Unattended behaviour of approvals`, `automations.Unattended run safety` |
| 6 | **User-initiated confirmation** (settings label "Ask before spending more than"): a costed action a person starts directly — an AI tool of `ai-editing-tools`, a Generate or Regenerate button, a Film Studio item or batch — shows one confirmation with the estimate, the model and the remaining budget when its estimate exceeds the amount or is unknown; below it the action starts at once. It is evaluated after rule 1 and replaces rules 2 and 3, which concern agent sessions only | 0 USD (always ask) | 0–100 USD | every costed action started by a person outside an agent turn | `jagentchill.config.write` (host); a person can tick "Do not ask again below <amount>" per device, never above the host value |

Rules 3 and 4 are reconciled as follows: the Auto-mode session budget applies **first** — an autonomous run or loop inside a session whose budget is 5.00 USD stops asking-free spending at 5.00 USD (the next costed call shows the approval card, and with nobody answering it the run waits and then ends with stop reason `max_cost` when the card times out) even though its own ceiling is 50.00 USD; the per-run ceilings are upper bounds that end the run regardless of approvals and can only be lowered, never raised above the stated maximum by a session. A run reaches 50.00 USD only when the session budget was raised or approvals were given along the way. The Autonomous start dialog (`multi-agent-orchestration.Autonomous control`) therefore SHALL show the current Auto-mode session budget next to the run's cost ceiling with the sentence "The agent asks for approval after <budget> of spending in this session" and a field to raise the session budget for this session before starting, bounded by the smaller of the run's cost ceiling and `budgets.maxSelfServiceUsd`; the same dialog shows every hard-stop budget in scope as read-only with its remaining amount. Thresholds are evaluated on estimates; budgets on reserved and actual cost. Plan-billed agent turns count toward rule 4's turn and time ceilings and toward its cost ceiling only as configured in `usage-tracking.Budgets hook`. The tool path that enforces rules 1–3 is `agent-editing-tools.Cost guard`. The host values of this table are read with `jagentchill.provider.threshold.get {}` (scope `jagentchill.config.read`) and written with `jagentchill.provider.threshold.set {patch}` (scope `jagentchill.config.write`; a value outside its stated range fails with `OUT_OF_RANGE`); per-session values travel with the session through `jagentchill.provider.threshold.set {sessionKey, patch}` under the scopes the table states. No other capability defines a spending threshold: the confirmation a capability shows before a user-initiated costed action is rule 6, with that capability owning only the dialog's layout. [NEW]

#### Scenario: Edit-mode threshold
- **WHEN** an `edit` session issues one costed call estimated at 0.60 USD with the default settings
- **THEN** an approval card is shown before anything is queued

#### Scenario: Threshold zero always asks
- **WHEN** the host threshold is 0 and an `edit` session issues a call estimated at 0.01 USD
- **THEN** an approval card is shown

#### Scenario: Session budget applies before the autonomous ceiling
- **WHEN** an autonomous run in an `auto` session with the default 5.00 USD session budget has spent 4.90 USD and its next call is estimated at 0.40 USD
- **THEN** an approval card is shown, although the run's own cost ceiling is 50.00 USD

#### Scenario: Autonomous ceiling ends the run
- **WHEN** the session budget was raised to 200.00 USD and an autonomous run's accumulated cost reaches 50.00 USD
- **THEN** the run ends with stop reason `max_cost`

#### Scenario: Admin lowers a ceiling
- **WHEN** an admin sets the autonomous cost ceiling to 10.00 USD
- **THEN** a run ends with `max_cost` at 10.00 USD and a session cannot raise that ceiling

#### Scenario: Unknown estimate in Edit mode
- **WHEN** an `edit` session with no hard-stop budget calls a tool on an unpriced model
- **THEN** an approval card stating "Cost unknown" is shown before the call

#### Scenario: Raising the session budget in the Autonomous start dialog
- **WHEN** a user opens the Autonomous start dialog in a session with the default 5.00 USD Auto-mode session budget, sets "Session budget" to 30.00 USD and starts
- **THEN** the run spends up to 30.00 USD without an approval card, and a hard-stop project budget shown in the dialog still blocks at its own limit

#### Scenario: Unanswered cost prompt in an unattended run
- **WHEN** an unattended run shows a cost approval and nobody answers for 30 minutes
- **THEN** the step fails with `APPROVAL_TIMEOUT`, while a policy sign-off in the same run stays parked

#### Scenario: User-initiated confirmation
- **WHEN** the host value of "Ask before spending more than" is 1.00 USD and a person starts an AI tool estimated at 0.40 USD and then one estimated at 2.50 USD
- **THEN** the first starts at once and the second shows a confirmation with the estimate before anything is queued

### Requirement: Budget warnings
When spending plus reservations first reaches 80 % (`warnAt`) of a budget in a period, the host SHALL raise exactly one notification of kind `usage.threshold_reached` for that budget and period through `notifications.Notification event catalogue` ("Project 'Promo' has used 80% of its $10.00 budget") and show a warning bar on the affected surface (session, project settings, workflow, team or film run); for an agent tree the warning is raised once per tree. At 100% of a hard-stop budget the first blocked request of the period raises one notification of kind `usage.limit_reached`, a run paused for it raises `workflow.paused`, and the surface shows "Budget reached — <scope>" with the actions "Raise budget" (enabled for devices allowed to raise that scope per `generation-providers.Budgets with hard stop`; others see "Ask an admin device") and "View usage" (opens the usage screen of `usage-tracking`). Non-hard-stop budgets raise warnings only. [NEW]

#### Scenario: 80% warning
- **WHEN** spending reaches 8.00 USD of a 10.00 USD project budget
- **THEN** one notice is raised and the project shows a warning bar

#### Scenario: No duplicate warnings
- **WHEN** spending moves from 81% to 85%
- **THEN** no further 80% notice is raised in that period

#### Scenario: Editor at a host budget
- **WHEN** an `editor` device sees "Budget reached — global"
- **THEN** "Raise budget" is replaced by "Ask an admin device"

### Requirement: Result caching by input hash
The host SHALL cache generation results keyed by the sha256 of the canonical JSON of `{capability, provider, model, modelVersion?, normalisedParams, prompt, negativePrompt?, instructions, referenceBlobHashes[], seed?}`. Deterministic capabilities (`transcription`, `translation`, `tts`, vision descriptions, and llm calls made by workflow and film steps with temperature 0) are served from the cache whenever the key matches. Stochastic capabilities (`image`, `video`, `music`, `sfx`, `voice-design`, `lipsync`) are served from the cache only when the request carries an explicit `seed` or the caller sets `reuse: true` (used when a workflow or film run is re-run with unchanged step inputs). "Regenerate" actions set `cache: "bypass"` and replace the cached entry. A cache hit returns the stored assets as new job results with `cacheHit: true`, costs 0, and is not counted against rate limits. Entries expire after 30 days without use; the cache is bounded at 20 GiB by default (configurable 1–500 GiB) with least-recently-used eviction; an asset used by a project is never deleted by eviction (only the cache index entry is). Settings SHALL show the cache size (`jagentchill.provider.cache.get {}` → `{bytes, entries, limitBytes}`, scope `jagentchill.config.read`) and a "Clear generation cache" action (`jagentchill.provider.cache.clear {}`, scope `jagentchill.config.write`). [NEW]

#### Scenario: Re-run with unchanged inputs
- **WHEN** a workflow is re-run and its "voice" step has the same text, voice and model
- **THEN** the step completes from the cache with zero cost and a "Cached" badge

#### Scenario: Stochastic request without a seed
- **WHEN** the same image prompt is requested twice from chat with no seed and no `reuse`
- **THEN** two provider calls are made

#### Scenario: Regenerate bypasses the cache
- **WHEN** the user presses "Regenerate" on a cached result
- **THEN** a provider call is made and the cache entry is replaced

### Requirement: Error and content-safety mapping
Provider failures SHALL be mapped to one closed set of error classes: `auth_error`, `forbidden`, `rate_limited`, `quota_exhausted`, `timeout`, `server_error`, `network`, `model_unavailable`, `capability_mismatch`, `invalid_request`, `content_blocked`, `invalid_output`, `budget_exceeded`, `cancelled`, `unknown`. Each class has a localised user message, a `retryable` flag (true for `rate_limited`, `timeout`, `server_error`, `network`, `model_unavailable`; `invalid_output` and `unknown` retryable once), and a suggested action ("Open provider settings", "Switch model", "Edit prompt", "Raise budget", "Retry"). `invalid_output` covers a media file that fails to decode and, for model calls that must return structured data (workflow, film and script steps), output that is not valid against the step's schema after one lenient repair pass. `content_blocked` SHALL carry `{stage: "input" | "output", categories[]?, providerMessage?}`; its message reads "The provider blocked this request under its content policy" with the categories when given, and offers "Edit prompt" and "Switch model"; it MUST NOT be retried automatically and falls back only as defined in `orc-model-routing.Route resolution and fallback`. A partially blocked batch (some of several images refused) succeeds with the delivered items and a warning stating how many were blocked. `budget_exceeded`, `quota_exhausted` and `auth_error` that remain after all routes are **account conditions**: a consumer MUST surface them as a pause or failure with the stated action and MUST NOT substitute a cheaper generation method or placeholder content for them. Tools surface a provider failure as `PROVIDER_ERROR` with `details.class`, or as the dedicated codes `CONTENT_BLOCKED`, `BUDGET_EXCEEDED` and `NO_ROUTE`. The raw provider status and message, scrubbed of secrets, are kept under "Details". Endpoint errors are normalised to these classes by `agent-runtimes.Endpoint error normalisation`. [NEW]

#### Scenario: Blocked prompt
- **WHEN** an image provider refuses a prompt for a policy category
- **THEN** the job fails with `content_blocked`, the card shows the mapped message with the category, and no automatic retry occurs

#### Scenario: Partial block
- **WHEN** 4 images are requested and the provider returns 3
- **THEN** the job succeeds with 3 assets and the warning "1 of 4 images was blocked by the provider"

#### Scenario: Structured output is invalid
- **WHEN** a model call that must return a shot list returns text that fails the schema after the repair pass
- **THEN** the attempt is classed `invalid_output` and retried once before fallback applies

#### Scenario: Quota exhausted on every route
- **WHEN** every route of a workflow node fails with `quota_exhausted`
- **THEN** the node's failure carries that class with the action "Open provider settings", and no substitute content is generated

#### Scenario: Unknown error
- **WHEN** a provider returns an unrecognised error
- **THEN** it is classed `unknown`, retried once, and then reported with the raw status under "Details"

### Requirement: Voice catalogue
TTS providers SHALL expose a voice list `{voiceId, provider, model, name, languages[], gender?, style tags[], previewAssetId?, source: "provider" | "designed" | "cloned"}` through `jagentchill.provider.voice.list {provider?, language?, query?}` (scope `jagentchill.projects.read`). Voices created with the `voice-design` role are stored on the host with their description and are usable by the models the design provider declares compatible. Each voice has a preview: a provider sample when available, otherwise generated on first play from a fixed sentence in the voice's language, cached, and costed as a normal TTS call with its estimate shown before playing. Creating a `cloned` voice from a recording requires the per-voice attestation `{consent: true, attestedBy: deviceId, attested_ms}` of `security-privacy.Provenance and likeness rules`, captured by `film-production.Speakers and voice sources` (and by the dubbing flow of `ai-editing-tools.Dubbing`) and stored with the voice record; without it the request is refused with `PERMISSION_DENIED`. The voice picker is used by ORC profiles, film speakers, the voiceover tool and agent tools. [NEW]

#### Scenario: Preview a voice
- **WHEN** the user presses play on a voice with a provider sample
- **THEN** the sample plays with no provider call

#### Scenario: Designed voice
- **WHEN** a voice is designed from the description "warm, calm, female narrator"
- **THEN** it appears in the voice list with `source: "designed"` and is selectable in a `voice-tts` profile on a compatible model

### Requirement: Stock media providers
Stock sources SHALL be of exactly three kinds: the bundled sound pack `jc-sound-pack` (music and sound effects, always present, offline), `jc-freesound` (sounds) and endpoint-backed providers with the capability `stock-media`, each created from a stock preset of `agent-runtimes.Endpoint presets` with the user's own key and described by the `stock-search` template of `generation-providers.Media request templates`; no stock vendor is built into the product as an adapter. Stock sources SHALL support search and download of video, image, music and sound effects through a common interface returning `{provider, itemId, kind, title, previewUrl, duration?, width?, height?, license {id, name, url, attributionRequired, commercialUse}, author, sourceUrl}`. Search SHALL accept a licence filter and, by default, return only items whose licence allows commercial use without share-alike obligations; `jc-freesound` uses the user's own key and defaults to CC0 and CC-BY items. This capability owns the Freesound provider; the Sounds panel, its categories and the bundled offline sound pack are `audio-editing`, which reaches Freesound through the signed route `GET /jagentchill/v1/sounds/search` of `server-api`, and previews of every stock source are proxied by the server so that clients contact no stock host. With no stock source connected, the Library section of `media-library.Stock and provider-sourced media` and `jc_stock_search` for video and images report the empty state of their owners, and music and sound effects still return the bundled sound pack (`audio-editing.Bundled sound pack`). Downloading an item imports it as a media asset with its licence and attribution stored on the asset; when attribution is required, the export dialog lists the attributions of all such assets used in the project. Stock results are untrusted content for agents (`agent-editing-tools.Untrusted content handling`). [NEW]

#### Scenario: Licence filter
- **WHEN** a sound search runs with the default filter
- **THEN** only CC0 and CC-BY items are returned

#### Scenario: Attribution is carried
- **WHEN** a CC-BY sound is imported and used on the timeline
- **THEN** the asset stores the author and licence and the export dialog lists the attribution text

#### Scenario: Preview is proxied
- **WHEN** a client plays a Freesound preview
- **THEN** the bytes come from the paired host and the client opens no connection to the stock host

#### Scenario: Stock video needs a connected source
- **WHEN** no endpoint with the capability `stock-media` is connected and a client searches stock video
- **THEN** the search returns no item and the reason "No stock source is connected", with a link to Settings → Runtimes & providers → Endpoints

### Requirement: Data leaving the machine
Sending **project-derived content** to a provider SHALL require consent per provider. Project-derived content is: media (reference images, first and last frames, audio for lip-sync or transcription, frames for vision), transcripts and caption text, and prompt text that embeds transcript, caption or imported-document text. The consent card or dialog reads "Send project content to <provider>?", names the kinds of data and the provider's host, and offers "Allow once", "Always allow for <provider>" and "Cancel". "Always allow" is stored on the host per provider and revocable in the provider's settings; granting it needs `jagentchill.config.write`, "Allow once" needs `jagentchill.generation.run`. Local providers need no consent. Consent is stored and read only on the host, as records `{providerId, contentKinds[] ("image" | "video" | "audio" | "frames" | "transcript" | "document_text"), grantedBy {deviceId}, granted_ms}`, through `jagentchill.provider.consent.list` (scope `jagentchill.config.read`), `jagentchill.provider.consent.grant {providerId, contentKinds[]}` and `jagentchill.provider.consent.revoke {providerId}` (scope `jagentchill.config.write`), and `jagentchill.provider.consent.check {routes[] {role, route?, profileId?}, contentKinds[], projectId?, filmId?}` (scope `jagentchill.projects.read`) → `{missing[] {providerId, label, host, contentKinds[], routes[]}}`, which resolves the given routes with their fallbacks and lists every provider on them that lacks consent for a content kind the route will send. "Allow once" is not stored: it is carried by the one request as a consent token bound to `{providerId, jobId}`. **Before start**: the workflow run setup form, the film batch confirmation, the automation editor and single generate actions call `jagentchill.provider.consent.check` and list every provider it returns, with "Allow for <provider>" (admin devices; other devices see "Ask an admin device"); Start is disabled, and saving an enabled automation is refused, until each is granted or the route is changed. **During a run**: a job that reaches a provider without consent skips that candidate as `capability_mismatch` so that a consenting fallback can serve it; on the last candidate an interactive session or attended run enters `waiting` with the consent card (in a workflow run the node is `waiting_approval` with `waitingReason: "consent"` and the run is not paused, `agent-workflows.Node state machine`), and an automation or unattended run fails the step with `PERMISSION_DENIED` after the approval timeout of 30 minutes (rule 5 of `generation-providers.Approval thresholds and spending caps`). An unanswered consent card of an attended session expires after the same 30 minutes with the job `failed` (`PERMISSION_DENIED`, `details.reason: "consent_timeout"`) and a "Try again" action. Agent-initiated requests in `auto` mode and automations MUST NOT grant consent implicitly, and no approval policy of mode `agent` or `auto` grants it. The host SHALL send to a provider only the content the request references, media at the smallest size the model accepts for that input, and SHALL strip location metadata (EXIF GPS) from images before upload. `security-privacy.Provider data disclosure and consent` references this requirement. [NEW]

#### Scenario: First reference upload
- **WHEN** the first image-to-video request to a provider is made from a chat session
- **THEN** the consent card appears and the request proceeds only after "Allow once" or "Always allow for <provider>"

#### Scenario: Allow once does not persist
- **WHEN** the user chose "Allow once" and a second request sends media to the same provider
- **THEN** the consent card appears again

#### Scenario: Pre-flight on the run form
- **WHEN** a workflow's resolved routes include a provider without consent for reference images
- **THEN** the run setup form lists that provider with "Allow for <provider>" and Start is disabled

#### Scenario: Fallback with consent serves the job
- **WHEN** the primary provider has no consent and the first fallback has it
- **THEN** the job is served by the fallback and the result discloses the fallback

#### Scenario: Automation without consent
- **WHEN** an automation step needs to send media to a provider that has no consent on any route
- **THEN** the step fails with `PERMISSION_DENIED` after 30 minutes and the run log states that consent is needed

#### Scenario: Location metadata removed
- **WHEN** a photo with GPS metadata is used as a reference
- **THEN** the uploaded copy has no GPS fields

#### Scenario: Consent check for a planned run
- **WHEN** `jagentchill.provider.consent.check` is called with the routes `video.image` and `voice-tts.narration` and the content kinds `image` and `transcript`, and only the video route's primary provider lacks consent for `image`
- **THEN** `missing[]` holds that provider with `contentKinds: ["image"]` and the route `video.image`

#### Scenario: Agent policy cannot grant consent
- **WHEN** a run whose approval policy is `agent` reaches a provider without consent on its last candidate while unattended
- **THEN** the reviewer agent is not asked, and the step fails with `PERMISSION_DENIED` after 30 minutes

### Requirement: Provider network egress
The generation service SHALL make outbound requests only to hosts that are rows of the single egress list owned by `security-privacy.Network egress control`: the hosts each `builtin` and `server` provider declares in its definition (contributed to that list as provider rows) and the per-endpoint rows contributed by `agent-runtimes`; a request to any other host is refused with `EGRESS_BLOCKED`. Transport rules for endpoints — no plain `http` to public addresses, self-signed certificates only on loopback, private or tailnet addresses with admin acceptance and pinning, metadata addresses refused, no cross-host redirects — are those of `agent-runtimes.Endpoint TLS options` and `agent-runtimes.Endpoint reachability and placement`. For `builtin` and `server` providers: TLS 1.2 or higher with certificate verification, honouring the host's proxy settings; result downloads follow at most 3 redirects and are refused when they resolve to loopback, link-local, metadata or private addresses. Request timeouts: connect 15 s, first byte per the role's `timeoutSeconds`. No request carries telemetry, device identifiers or user data beyond what the provider API requires. [NEW]

#### Scenario: Redirect to a metadata address
- **WHEN** a provider's result URL redirects to `http://169.254.169.254/`
- **THEN** the download is refused and the job fails with `invalid_output`

#### Scenario: Host not on the egress list
- **WHEN** an adapter attempts a request to a host its definition did not declare
- **THEN** the request is refused with `EGRESS_BLOCKED` and no connection is opened

#### Scenario: Proxy
- **WHEN** the host has an HTTPS proxy configured
- **THEN** provider requests go through it

### Requirement: Providers settings page
The settings page "Runtimes & providers" is owned by `agent-runtimes.Runtimes settings screen`; this capability SHALL contribute its **Generation** section with: a search field; a capability filter (chips for each media capability type); and a table of media providers (icon, name, source badge, capability chips, connection state, health icon with label, enabled model count, enable toggle). Selecting a provider opens its detail: connection card (fields, key hints, "Test connection", "Add key", "Replace key", "Disconnect" for `server` providers; a link "Managed under Sign-in & keys" or "Managed under Endpoints" for `builtin` and `endpoint` providers), limits card (concurrency per capability, requests per minute), consent card (state of "Always allow" with "Revoke"), media template card for endpoints, and a models table per capability (label, id, capability badges, price summary or "Unpriced", enable toggle, edit) with "Refresh models", "Add model", "Enable all" and "Disable all". A second section **Budgets and approvals** edits the budgets of `generation-providers.Budgets with hard stop` and the thresholds of `generation-providers.Approval thresholds and spending caps`, all in USD. Forms open in a right side sheet 400 px wide on desktop and web and as a full-height sheet on mobile. States: loading skeleton rows; empty search result "No providers match"; disconnected host banner "Reconnect to manage providers" with all controls read-only; devices without `jagentchill.config.write` see every control read-only with "Admin devices can change these settings". All controls are keyboard reachable and labelled. Usage is not shown here: it is the Usage screen of `usage-tracking`. [NEW]

#### Scenario: Filter by capability
- **WHEN** the user selects the "Video" chip
- **THEN** only providers with video capability are listed

#### Scenario: Read-only while disconnected
- **WHEN** the host connection is lost with the page open
- **THEN** the banner appears and toggles, buttons and fields are disabled

#### Scenario: Endpoint-backed provider
- **WHEN** the user opens the detail of `endpoint:my-router`
- **THEN** the connection card shows "Managed under Endpoints" with a link and offers no key field

#### Scenario: Mobile layout
- **WHEN** the page is opened on a phone
- **THEN** providers are stacked rows, a provider opens as a pushed screen, and forms are full-height sheets

### Requirement: Local providers
The local transcription provider `jc-whisper-local` SHALL run Whisper ONNX on the host with the model sizes `tiny`, `base`, `small`, `medium` and `large-v3-turbo` (the same list as on devices, owned by `captions-subtitles.Transcription model picker`; host default `small`), downloaded on demand from the content host of the egress list to the server's data directory (`<dataDir>/`) with a progress indicator, size and peak memory shown before download, sha256 verification and resumable download — started with `jagentchill.provider.local.install {providerId, modelId}` (a job of the single queue) and removed with `jagentchill.provider.local.remove {providerId, modelId}` (both scope `jagentchill.config.write`); a model whose peak memory exceeds 25 % of host memory is refused with "Not enough memory for this model". Local providers have pricing `free`, need no key and no consent, declare `streaming: false`, and report `health: down` with the reason "Model not installed" until a model file is present. Transcription that the client performs on-device without a host belongs to `captions-subtitles` and does not pass through this registry. [NEW]

#### Scenario: Install a local model
- **WHEN** the user installs the "small" model
- **THEN** a progress bar shows the download, the file's hash is verified, and the provider becomes `ready`

#### Scenario: Corrupt download
- **WHEN** the downloaded file's hash does not match
- **THEN** the file is deleted, the install shows "Download was corrupted" with "Retry", and the provider stays `down`

#### Scenario: Model too large for the host
- **WHEN** the user selects a model whose peak memory is above 25 % of host memory
- **THEN** the install is refused with "Not enough memory for this model"

### Requirement: Provider availability offline
When the host has no internet access, remote providers SHALL report health `down` with the reason "No internet connection" after their next failed call or probe, queued jobs for them SHALL wait (not fail) for up to 30 minutes and then fail with class `network`, and local providers keep working. When a client is disconnected from the host, generation controls in the client are disabled with the tooltip "Connect to the host to generate", and jobs already submitted continue on the host. [NEW]

#### Scenario: Host offline
- **WHEN** the host loses internet while 3 image jobs are queued
- **THEN** the jobs show "Waiting for network" and start when connectivity returns within 30 minutes

#### Scenario: Client offline
- **WHEN** the phone is disconnected from the host
- **THEN** the generate buttons are disabled with the stated tooltip and running jobs complete on the host

### Requirement: Provider RPC surface
The `provider` domain of `server-api.RPC domain ownership` SHALL consist of exactly the 30 methods of this table, the event `jagentchill.provider.changed`, and the delegated sub-namespaces `provider.auth.*`, `provider.endpoint.*`, `provider.preset.*`, `provider.override.*`, `provider.routing.*` and `provider.pin.*`, whose methods are listed only by `agent-runtimes.Runtime and provider administration RPC surface`. The parameters, result and required scope of each method are stated by the requirement named in its row; this requirement adds none.

| Method | Defined in |
|---|---|
| `jagentchill.provider.list` | `generation-providers.Provider registry by capability type` |
| `jagentchill.provider.connect` | `generation-providers.Provider connection` |
| `jagentchill.provider.disconnect` | `generation-providers.Key replacement and disconnect` |
| `jagentchill.provider.update` | `generation-providers.Enable and disable` |
| `jagentchill.provider.test` | `generation-providers.Connection validation` |
| `jagentchill.provider.key.add` | `generation-providers.Key replacement and disconnect` |
| `jagentchill.provider.key.replace` | `generation-providers.Key replacement and disconnect` |
| `jagentchill.provider.key.remove` | `generation-providers.Key replacement and disconnect` |
| `jagentchill.provider.model.list` | `generation-providers.Model catalogue` |
| `jagentchill.provider.model.refresh` | `generation-providers.Model catalogue` |
| `jagentchill.provider.model.upsert` | `generation-providers.User-added and edited models` |
| `jagentchill.provider.model.reset` | `generation-providers.User-added and edited models` |
| `jagentchill.provider.model.setEnabled` | `generation-providers.Enable and disable` |
| `jagentchill.provider.local.install` | `generation-providers.Local providers` |
| `jagentchill.provider.local.remove` | `generation-providers.Local providers` |
| `jagentchill.provider.cache.get` | `generation-providers.Result caching by input hash` |
| `jagentchill.provider.cache.clear` | `generation-providers.Result caching by input hash` |
| `jagentchill.provider.threshold.get` | `generation-providers.Approval thresholds and spending caps` |
| `jagentchill.provider.threshold.set` | `generation-providers.Approval thresholds and spending caps` |
| `jagentchill.provider.estimate` | `generation-providers.Cost estimate` |
| `jagentchill.provider.budget.list` | `generation-providers.Budgets with hard stop` |
| `jagentchill.provider.budget.remove` | `generation-providers.Budgets with hard stop` |
| `jagentchill.provider.budget.set` | `generation-providers.Budgets with hard stop` |
| `jagentchill.provider.voice.list` | `generation-providers.Voice catalogue` |
| `jagentchill.provider.consent.check` | `generation-providers.Data leaving the machine` |
| `jagentchill.provider.consent.grant` | `generation-providers.Data leaving the machine` |
| `jagentchill.provider.consent.list` | `generation-providers.Data leaving the machine` |
| `jagentchill.provider.consent.revoke` | `generation-providers.Data leaving the machine` |
| `jagentchill.provider.subscribe` | `generation-providers.Provider RPC surface` |
| `jagentchill.provider.unsubscribe` | `generation-providers.Provider RPC surface` |

What this capability stores per endpoint and capability — `{endpointId, capability, template, custom?, stock?}` — has no method of its own: it is the `media.<capability>` member of the endpoint record and is written with `jagentchill.provider.endpoint.upsert` (`agent-runtimes.Endpoint contract for generation capabilities`). `jagentchill.provider.subscribe {}` and `jagentchill.provider.unsubscribe {}` (scope `jagentchill.projects.read`) open and close the stream `provider`, on which `jagentchill.provider.changed` is delivered; `jagentchill.provider.list` is the pull RPC of that stream. A handler under `jagentchill.provider.` that neither this table nor the delegated list names MUST fail the contract test `rpc-ownership` of `server-api.RPC domain ownership`. [NEW]

#### Scenario: Ownership test is exact
- **WHEN** the contract test `rpc-ownership` compares the server's handlers under `jagentchill.provider.` with this table and with the delegated list of `agent-runtimes.Runtime and provider administration RPC surface`
- **THEN** every handler is named in exactly one of the two lists and no listed method lacks a handler

#### Scenario: Unlisted method
- **WHEN** server code adds a handler `jagentchill.provider.reset`
- **THEN** `rpc-ownership` fails and names the method

#### Scenario: Every settings action has a method
- **WHEN** the actions of the Media providers settings tab (connect, disconnect, replace key, test connection, enable or disable a provider or model, edit limits, add, edit or reset a model, refresh models, install or remove a local model, clear the generation cache, edit thresholds) are mapped to this table
- **THEN** each action names exactly one method of the table

#### Scenario: Consent methods belong to this capability
- **WHEN** the protocol package is read for `jagentchill.provider.consent.grant`
- **THEN** its schemas exist and its owner is `generation-providers.Data leaving the machine`
