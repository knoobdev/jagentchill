## ADDED Requirements

### Requirement: AI tools catalogue and entry points
The editor SHALL provide these AI tools, each identified by a stable tool id; the full table (id, label, accepted selection, where it runs, owning requirement) is the section "Tool table" of the normative file `specs/ai-editing-tools/catalog.md`. Tools defined in this capability: `cutout.image`, `cutout.video`, `reframe`, `track`, `stabilise`, `deflicker`, `upscale`, `relight`, `retouch`, `eye-contact`, `motion-style`, `restyle`, `separate.stems`, `auto-cut`, `beat-sync`, `tts`, `voice-changer`, `dub`, `generate.image`, `expand.image`, `generate.video`, `generate.music`, `generate.sfx`, `remove.object`, `avatar`, `lipsync`, `dialogue-scene` and `smart-search`. Tool ids that are entry points to behaviour owned elsewhere: `captions.auto` and `translate` (`captions-subtitles`), `voice-enhance` (`audio-editing`), `script-to-video` (`script-studio` and `agent-workflows`) and `long-to-shorts` (`agent-workflows`). On desktop and web each tool is reachable from (a) the inspector of a compatible selected element — `retouch`, `eye-contact` and `relight` in the Retouch sub-tab and the other clip-level tools in the "AI tools" tab, as placed by `preview-canvas.Inspector structure per element type`; (b) the element context menu under "AI tools"; (c) the "AI" tab of the asset panel (`app-shell-navigation.Editor asset panel tabs`) for generators and project-level tools; and (d) the command palette. On mobile the entries are those of "AI tools on mobile". Tools incompatible with the current selection are hidden in the inspector and context menu and shown disabled with a reason in the AI tab. Every tool panel shows where it runs ("On this device", "Host · local model" or "Host · <provider>/<model>"), its inputs, a primary action, and the job state. All strings come from locale resources (en, vi, ja) and every control is keyboard-operable with an accessible name. A CI check MUST fail when a tool id in this list has no row in the tool table, no owning requirement, or is not accepted by `jc_ai_run`. [NEW] [PORT N-017]

#### Scenario: Tools offered for a video clip
- **WHEN** a single video clip is selected on desktop
- **THEN** the inspector's "AI tools" tab lists Remove background, Auto reframe, Tracking, Stabilise, Remove flicker, Enhance, Motion styles, AI style, Remove object and Lip sync, and its Retouch sub-tab lists Retouch, Eye contact and Relight
- **AND** neither lists Text to speech

#### Scenario: Incompatible selection
- **WHEN** an audio clip is selected and the AI tab is open
- **THEN** Stabilise is shown disabled with the reason "Select a video clip"

#### Scenario: Command palette
- **WHEN** the user types "reframe" in the command palette
- **THEN** "Auto reframe" is listed and activating it opens the tool panel for the current selection

#### Scenario: Catalogue completeness check
- **WHEN** a tool id is added to this list without a row in the tool table
- **THEN** the catalogue check fails naming the id

### Requirement: Execution location per tool
Each tool SHALL run in exactly one of three places, shown in its panel. (1) On this device (models of "Model manifest" and signal processing, no network): `cutout.image`, `cutout.video`, `reframe`, `track`, `stabilise`, `deflicker`, `relight`, `retouch`, `eye-contact`, `motion-style`, `auto-cut` (silence and filler modes), `beat-sync` and `smart-search`. (2) On the host with a host-local model and no provider: `separate.stems`. (3) Through a host provider, resolved by `orc-model-routing.Route resolution and fallback` for a role and task route (media roles and their capability flags are those of `generation-providers.Capability metadata`): `tts` → `voice-tts`; `voice-changer` (AI voices) → `voice-design.convert`; `dub` → `translation` + `voice-tts` (+ `voice-design`, `lipsync` when selected); `auto-cut` script mode → `editor`; `generate.image` → `image`; `expand.image` → `image.expand`; `restyle` → `image.restyle` for stills and `video.restyle` for clips; `generate.video` → `video`; `generate.music` → `music`; `generate.sfx` → `sfx`; `remove.object` → `image.inpaint` for stills and `video.inpaint` for clips; `upscale` → `image.upscale` for stills and `video.upscale` for clips; `lipsync` → `lipsync`; `avatar` and `dialogue-scene` → `lipsync.avatar` (+ `voice-tts`). A name without a dot is a role and denotes the role's default route; a dotted name is the task-route id `<role>.<route>`. A route is usable only when its model declares the matching capability flag of `generation-providers.Capability metadata`, so a tool is never enabled against a model that cannot perform it: `image.expand` needs `outpaint`; `image.inpaint` and `video.inpaint` need `inpaint`; `image.restyle` needs `restyle` and `video.restyle` needs `videoToVideo` (clips longer than the model's `maxInputSeconds` are refused before upload); `image.upscale` and `video.upscale` need the requested factor in `upscaleFactors[]`; `voice-design.convert` needs `speechToSpeech`; `lipsync.avatar` needs `inputs` containing `image`; and speaker labels in `dub` are used only when the transcription model declares `diarisation`. The task-route ids are those of `orc-model-routing.Routes with primary and ordered fallbacks`. For every tool of class (1), when a host advertising feature flag `host-analysis` is connected, the panel additionally offers "Run on host", which calls `jagentchill.ai.analysis.create` (`ai-editing-tools.AI RPC surface`) and executes the same manifest model, on the host runtime of `Inference runtime`, as a job of kind `ai.analysis` in the queue of `server-api.Background job queue` against the synced original and returns the same result type; class (2) requires `host-analysis`. All of this traffic uses the one client channel (channel P of design D7): the server checks the device's role and scope, runs the job in its own process or its supervised child process, and no device holds any OpenClaw operator scope. Host tools of class (2) and "Run on host" need only JAgentChill Server and keep working while the OpenClaw Gateway it supervises is down; a provider tool of class (3) whose route resolves to a `builtin` provider then fails with `GATEWAY_UNAVAILABLE` (`generation-providers.Provider sources`). Device roles: starting a provider job requires scope `jagentchill.generation.run`, and a host job `jagentchill.projects.write`; a `viewer` device can start neither. [NEW]

#### Scenario: Location label
- **WHEN** the Text to speech panel is opened with the `voice-tts` role routed to provider P and model M
- **THEN** the panel shows "Host · P/M"

#### Scenario: Host analysis for a long clip on a phone
- **WHEN** a 20-minute clip is selected for Stabilise on a phone connected to a host with `host-analysis`
- **THEN** the panel offers "On this device" (disabled, over the mobile duration limit) and "Run on host"
- **AND** choosing the server creates an `ai.analysis` job that produces the same stabilisation track type as on-device

#### Scenario: Route without the capability
- **WHEN** the task route `image.upscale` points at a model that does not declare an upscale factor
- **THEN** Enhance is disabled for images with "The configured image model does not support upscale" and "Configure"

#### Scenario: Viewer device
- **WHEN** a device with role `viewer` opens the Generate image panel
- **THEN** the primary action is disabled with "Your role cannot run generation on this host"

### Requirement: On-device model management
On-device models SHALL be managed by a model store on each device using the entries of "Model manifest". A model not bundled with the app is downloaded on first use after a consent dialog showing its name, size, licence and the download host — the single content host listed in `security-privacy.Network egress control`, a static download host whose base URL is configurable (the publisher's host by default; a self-hosted mirror with the same paths and SHA-256 values is accepted); the client contacts no model hub directly, and nothing is fetched from that host before the user allowed it on this device. The download shows percentage and bytes, can be cancelled, resumes after interruption, and is verified against the manifest SHA-256 before use. Models are stored once per device, listed in settings with size and last-used time, and deletable there. Inference runs in a worker on the one runtime defined by `Inference runtime`. Admission rule: a model is loaded on a device only when its `peakMemoryMiB` is at most 25 % of the device's physical memory (a browser that does not report its memory is treated as having 4 GiB) and, on mobile (iOS and Android alike), at most 400 MiB and at most the engine-process headroom measured by the inference row of spike S6 (`Inference runtime`); the per-platform result of this rule for every manifest row is the section "Platform availability" of `catalog.md`; a model that fails admission is offered only as "Run on host" (with `host-analysis`) and otherwise shown disabled with "This device does not have enough memory for <model>". A model that exhausts memory at run time fails the job with `ai/model-out-of-memory` and offers "Run on host" when available. One model is resident at a time on mobile and at most two on desktop and web; idle models are unloaded after 60 s. No media leaves the device for on-device tools. [NEW]

#### Scenario: First use downloads the model
- **WHEN** Remove background is used for the first time and the segmentation model is not present
- **THEN** a consent dialog shows the model name, its size, its licence and the content host
- **AND** after confirmation the download shows progress and the tool runs once the checksum is verified

#### Scenario: Corrupt download
- **WHEN** the downloaded model's SHA-256 does not match
- **THEN** the file is discarded, the job fails with `ai/model-verification-failed`, and "Retry download" is offered

#### Scenario: Admission by memory
- **WHEN** a model with `peakMemoryMiB` 3 000 is selected on a device with 8 GiB of memory
- **THEN** the on-device option is disabled with the not-enough-memory message and "Run on host" is offered when `host-analysis` is available

#### Scenario: Mobile limit
- **WHEN** a model with `peakMemoryMiB` 700 is needed on a phone with 6 GiB of memory
- **THEN** it is not loaded on the phone and the tool offers "Run on host" only

#### Scenario: Delete a model
- **WHEN** the user deletes the depth model in settings
- **THEN** its storage is freed and the next use of Relight asks to download it again

#### Scenario: No direct model-hub request
- **WHEN** network traffic is captured during a model download
- **THEN** every request goes to the configured content host and none to any other host

### Requirement: Model manifest
Every model the product can run on a device or on the host SHALL be an entry of one manifest, `packages/media/models/manifest.json`, whose rows are enumerated in the section "Model manifest" of `specs/ai-editing-tools/catalog.md`. Each entry carries `{id, task, upstreamModel, sourceUrl, version, codeLicence, weightsLicence, licenceVerified {by, date, evidenceUrl}, format, inputSize, sizeBytes, peakMemoryMiB, bundled, runsOn, conversion, path, sha256}`: `sourceUrl` is the upstream repository or release the weights are taken from; `format` is `onnx` for every row (the single format of `Inference runtime`); `inputSize` is the tensor size the model is run at; `conversion` names the pinned script under `scripts/models/` that produced the ONNX file from the upstream artefact (recorded with the upstream file's SHA-256 in `docs/product/ASSET-PROVENANCE.md`), or `none` when upstream publishes ONNX. **Licence gate.** The catalogue's licence columns are the licences this specification expects from its own knowledge of the upstream projects; they are NOT yet verified. Before an entry is pinned, a named person SHALL check the upstream licence of the code and, separately, of the weights (including dataset terms that restrict commercial use of trained weights) and record `licenceVerified`; both licences are restricted to MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause and ISC. CI MUST fail for an entry whose `codeLicence` or `weightsLicence` is outside this list, whose `licenceVerified` is absent, whose licence text is absent from `THIRD_PARTY_NOTICES.md`, or whose `sha256` does not match the file. An entry that fails verification is replaced by the alternative named in its catalogue row, or its tool is host-provider-only until a replacement passes; the tool's acceptance fixture decides whether a replacement is good enough. `peakMemoryMiB` is verified by a measurement test that fails when the measured peak on the reference desktop exceeds the listed value. The values listed for the five Whisper entries are working upper limits: the device run of spike S6 (design D18) records the measured peaks on the reference devices in `docs/decisions/`, and the manifest values MUST be replaced by those measurements before release. Which Whisper entry is offered and its default per platform is defined by `captions-subtitles.Transcription model picker`. A tool MUST NOT load a model that is not in the manifest. [NEW]

#### Scenario: Licence gate
- **WHEN** a manifest entry is added with licence `CC-BY-NC-4.0`
- **THEN** the CI licence check fails naming the entry

#### Scenario: Memory value is enforced
- **WHEN** the measured peak memory of `seg-salient` on the reference desktop is 10 % above its `peakMemoryMiB`
- **THEN** the measurement test fails

#### Scenario: Unlisted model
- **WHEN** code requests a model id that is not in the manifest
- **THEN** the model store rejects the request and no network request is made

#### Scenario: Weights licence differs from the code licence
- **WHEN** an entry has `codeLicence: "Apache-2.0"` and `weightsLicence: "CC-BY-NC-SA-4.0"`
- **THEN** the CI licence check fails naming the entry and the weights licence

#### Scenario: Unverified entry
- **WHEN** an entry has no `licenceVerified` record
- **THEN** the CI licence check fails naming the entry, even when both licence fields are in the allowed list

### Requirement: Inference runtime
All manifest models SHALL run on one inference runtime family, pinned by version in `docs/product/TOOLCHAIN.md` and listed with its licence in `THIRD_PARTY_NOTICES.md`: **ONNX Runtime Web** (MIT) on every device and **ONNX Runtime for Node.js** (`onnxruntime-node`, MIT) on the host; every model file is ONNX (`Model manifest`). No second runtime (TFLite, MediaPipe Tasks, PyTorch, a vendor SDK) is shipped. **Devices.** The runtime runs in a dedicated worker: in the app's web context on web and on desktop (Electron on macOS, Windows and Linux), and inside the engine WebView on iOS and Android. Execution provider: WebGPU when the engine reported `backend: "webgpu"`, otherwise WebAssembly with SIMD (multi-threaded where the context is cross-origin isolated, single-threaded otherwise); the result of a model is the same class of output on both providers and each acceptance fixture is run on both. The runtime's WebAssembly and JavaScript payload is at most 25 MB, is not part of the initial app load, and is loaded on the first use of an on-device model; on web it is a cacheable static asset of the app origin, and nothing is fetched from a CDN. **Host.** The server runs `onnxruntime-node` in a supervised child process (so a model crash or memory exhaustion does not take the server down), with the CPU execution provider on every host OS and architecture (macOS arm64 and x64, Windows x64 and arm64, Linux x64 and arm64) and, when the bundled runtime reports them, the platform accelerators CoreML (macOS), DirectML (Windows) and CUDA (Linux); the native binaries add at most 120 MB per platform to the host package and to the desktop app. Pre- and post-processing that is not part of a network (resizing, normalisation, the short-time Fourier transform of `stems-htdemucs`, mask upsampling, tokenisation) is product code shared by device and host, so a model produces the same result in both places within the fixture tolerance. The host advertises the feature flag `host-analysis` only when the runtime loads and a 1-second self-test model runs. **Mobile gate.** Row 13 "On-device inference" of the spike S6 matrix (`mobile-editor.WebView capability spike matrix`, `render-engine.Capability constraints from the WebView spike`, `diagnostics-quality.Gating spikes`): in the engine WebView of each reference phone, `seg-person` SHALL reach at least 3 frames per second and `face-mesh` at least 8, with the content process surviving 10 minutes of preview playback while a model is resident; on a platform where the row fails, every on-device model tool is offered as "Run on host" only on that platform and the throughput figures this capability states for mobile do not apply there. [NEW]

#### Scenario: One runtime
- **WHEN** the dependency check lists the inference libraries shipped in the app and the host package
- **THEN** it finds ONNX Runtime Web and `onnxruntime-node` at the pinned version and no other inference runtime

#### Scenario: WebAssembly fallback
- **WHEN** Remove background runs on a device whose engine backend is `webgl2`
- **THEN** the model runs on the WebAssembly provider and the result meets the same fixture threshold

#### Scenario: Host self-test fails
- **WHEN** the host's runtime binary cannot be loaded
- **THEN** the host does not advertise `host-analysis` and clients show "This host cannot run analysis"

#### Scenario: Mobile gate fails on one platform
- **WHEN** the S6 inference row fails on the Android reference phone and passes on the iOS reference phone
- **THEN** on Android every on-device model tool offers "Run on host" only, and on iOS the tools run on the device

### Requirement: Offline and no-provider behaviour
Every tool panel SHALL make availability explicit. On-device tools work with no network and no host once their model is present; with the model absent and no network the panel shows "Model not downloaded. Connect to the internet to download (<size> MB)." and a job attempt fails with `ai/model-not-downloaded`. Provider tools require all of: a connected host, a route configured for the tool's role and task route, and a provider connection valid for that route. When the server is not connected the primary action is disabled with "Connect to a host to use this tool" and a link to connection settings (this string is used by every capability that hands off to an AI tool); when no route or key is configured it is disabled with "No provider is configured for <role>" and a "Configure" link that opens the role in the ORC settings (`orc-model-routing.ORC settings page`; shown only to `admin` devices, others see "Ask an admin to configure <role>"); when the device is offline but the server is reachable on the local network, provider tools stay enabled and the server's own provider reachability error is reported as the provider error class of `generation-providers.Error and content-safety mapping`. Host tools (`separate.stems`, "Run on host") are disabled with "This host cannot run analysis" when `host-analysis` is not advertised. A tool MUST NOT silently substitute a different tool, a lower-quality local approximation or generated stand-in content when its provider is unavailable. [NEW]

#### Scenario: No provider for image generation
- **WHEN** the Generate image panel is opened on an `admin` device and the `image` role has no route
- **THEN** the Generate button is disabled, the text "No provider is configured for image" is shown, and "Configure" opens the role's routing settings

#### Scenario: Offline on-device tool
- **WHEN** the device has no network and the segmentation model is already downloaded
- **THEN** Remove background runs to completion

#### Scenario: Host disconnected mid-session
- **WHEN** the host connection drops while the Text to speech panel is open
- **THEN** the Generate button becomes disabled within 2 s with "Connect to a host to use this tool"
- **AND** already running host jobs continue on the server

#### Scenario: Host analysis unavailable
- **WHEN** Isolate vocals is opened while the connected host does not advertise `host-analysis`
- **THEN** the action is disabled with "This host cannot run analysis"

### Requirement: Consent for sending media to a provider
Consent for sending project-derived content to a provider is owned by `generation-providers.Data leaving the machine` (scope: any project-derived content; choices "Allow once", "Always allow for <provider>", "Cancel"; storage and revocation); every provider tool of this capability SHALL obtain that consent before its first upload and MUST add to the consent card what this job sends (for example "1 video clip, 12.4 s, 38 MB"). Tools MUST send only the minimum input required: the trimmed range of a clip (plus the handles the tool states) rather than the whole source, at the resolution the model accepts, and never the project document. Jobs started by an agent use the same consent record. [NEW]

#### Scenario: First upload to a provider
- **WHEN** the user starts Remove object on a clip and no consent exists for the routed provider
- **THEN** the consent card appears listing the clip duration and size
- **AND** nothing is uploaded until "Allow once" or "Always allow for <provider>" is chosen

#### Scenario: Consent cancelled
- **WHEN** the user chooses "Cancel"
- **THEN** no job is created and no data leaves the device

#### Scenario: Minimum input
- **WHEN** a 6 s trimmed range of a 10-minute source is sent for object removal
- **THEN** the uploaded media is 8 s long (the range plus 1 s handles) and not the 10-minute source

### Requirement: Cost estimate before provider jobs
Before creating a provider job the panel SHALL display the estimate returned by `generation-providers.Cost estimate` for the resolved route and the job's parameters (units such as seconds of video, images, characters, minutes of audio), in USD with two decimals, updating within 500 ms of a parameter change. Whether a confirmation is required, the per-call approval threshold, budgets, the hard stop and the handling of unknown-cost models are defined only by `generation-providers.Approval thresholds and spending caps`, `generation-providers.Budgets with hard stop` and `generation-providers.Budget warnings`; this capability shows their outcome (a confirmation card with the estimate, the model and the remaining budget; or the refusal `BUDGET_EXCEEDED` with "Raise budget" for an `admin` device) and defines no threshold of its own. When the estimate is unavailable the panel shows "Cost unknown for this model". After completion the actual cost reported by the provider is recorded on the job and the generated asset. On-device and host tools show "Free · runs on this device" or "Free · runs on your host". [NEW]

#### Scenario: Estimate updates with duration
- **WHEN** the user changes a video generation duration from 5 s to 10 s for a model priced per second
- **THEN** the displayed estimate doubles within 500 ms

#### Scenario: Budget exceeded
- **WHEN** a job's estimate is 4.00 USD and the project's remaining budget is 1.50 USD under a hard stop
- **THEN** the job is not created and the `BUDGET_EXCEEDED` refusal of `generation-providers.Budgets with hard stop` is shown

#### Scenario: Unknown cost
- **WHEN** the routed model has no pricing data
- **THEN** "Cost unknown for this model" is shown and whether the job can start follows `generation-providers.Budgets with hard stop`

#### Scenario: Host tool is free
- **WHEN** the Isolate vocals panel is opened
- **THEN** it shows "Free · runs on your host" and no estimate request is made

### Requirement: Job lifecycle, progress and cancel
Every tool run SHALL be a job with a progress value (percentage when measurable, otherwise an indeterminate indicator with the current stage and elapsed time) and a Cancel action. On-device jobs have the states `queued → running ⇄ paused → succeeded | failed | cancelled` (`paused` exists only for on-device jobs: the app was backgrounded or the user paused indexing); they run in a worker, one analysis job at a time per device with further jobs queued; cancel takes effect within 1 s and discards partial output. Host jobs are jobs of the single queue of `server-api.Background job queue` (kind `ai.analysis` for host tools, `generation.<type>` for provider tools) with exactly its states `queued → running → succeeded | failed | cancelled`, reported by `jagentchill.job.updated`; they survive client disconnect and Server restart and are cancelled through the job RPC. A provider call already submitted that cannot be aborted is marked `cancelled` locally and its result discarded, and the panel states that the provider can still bill for it. Jobs are listed in a per-project "AI jobs" list with tool, target, state, progress, cost and actions (Cancel, Retry, Apply, Open result). The affected timeline element shows a processing badge while a job targeting it is active, and the editor stays fully usable. Closing the project does not cancel host jobs; on-device jobs are cancelled after confirmation. [NEW]

#### Scenario: Cancel an on-device job
- **WHEN** the user cancels a running video background removal at 40 %
- **THEN** the job becomes `cancelled` within 1 s, no matte is attached to the clip, and no partial asset remains

#### Scenario: Host job outlives the client
- **WHEN** the app is closed while a video generation job is running on the server
- **THEN** on next launch the AI jobs list shows the job's current state and, if succeeded, the result is available to apply

#### Scenario: Editing while a job runs
- **WHEN** a stabilisation analysis is running on a clip
- **THEN** the clip shows a processing badge and other clips remain editable with no input lag attributable to the job above 16 ms per frame

#### Scenario: Paused is device-only
- **WHEN** a host `ai.analysis` job is listed
- **THEN** it never shows the state `paused` and offers Cancel only

### Requirement: Results as editable timeline content with undo
A tool result SHALL be applied to the project through `editor-core` commands as exactly one undo step, be non-destructive (source media is never modified or deleted), and remain editable with the editor's ordinary controls: analysis tools write properties, keyframes or analysis tracks on the element; generators add media assets and, when requested, timeline elements. Undo removes the applied result and restores the prior state; redo re-applies it without re-running the job. When the target element was deleted, replaced or split before the job finished, the result MUST NOT be applied automatically: the job is marked "Result ready" with "Apply to…" (pick a compatible element) and, for generators, the asset is still added to the media library. Each tool that sets an element property offers "Remove" in its panel, which is also one undo step. [NEW]

#### Scenario: Undo a result
- **WHEN** background removal completes on a clip and the user presses undo once
- **THEN** the clip renders without the cutout and the undo stack has moved back exactly one step

#### Scenario: Target deleted during the job
- **WHEN** the clip targeted by a host upscale job is deleted before the job succeeds
- **THEN** the upscaled asset is added to the media library, nothing changes on the timeline, and the job shows "Result ready"

#### Scenario: Redo without re-running
- **WHEN** the user undoes and then redoes a text-to-speech insertion
- **THEN** the same audio asset is re-inserted and no new provider job is created

### Requirement: Generated asset provenance
Every asset produced by a tool SHALL be stored in the project media library in an automatically created folder "AI generated" carrying the generation metadata whose shape, display ("Copy prompt", "Generate again") and export are defined by `media-library.AI-generated asset provenance`; each tool of this capability MUST supply `generatedBy {toolId, provider, model, prompt, negativePrompt, seed, parameters, sourceAssetIds, jobId, costUsd, createdAt_ms}` (provider, model and cost omitted for on-device and host tools). This metadata is what `export-share.Provenance metadata` reads to label exported files. Derived analysis artefacts (mattes, stabilisation, deflicker, retouch and relight tracks, tracking paths, stems, search indexes) are stored as project-derived data linked to their source asset by content hash, excluded from the visible media grid, counted in project storage usage, and deleted when their source asset is deleted or when the user chooses "Clear analysis data". [NEW] [PORT N-017]

#### Scenario: Provenance on a generated image
- **WHEN** an image is generated from the prompt "red kite over a beach"
- **THEN** its info panel shows the tool, provider, model, prompt, seed and cost in USD

#### Scenario: Clear analysis data
- **WHEN** the user chooses "Clear analysis data" for an asset with a matte and a stabilisation track
- **THEN** both artefacts are deleted, clips using the matte show "Background removal needs re-processing", and storage usage decreases by their size

#### Scenario: Export reads the provenance
- **WHEN** a project containing one generated image is exported
- **THEN** the exported file is labelled by `export-share.Provenance metadata` as containing AI-generated media

### Requirement: Result cache by input hash
Reuse of provider results is owned by `generation-providers.Result caching by input hash` (key, expiry, size limit and clear action); provider tools of this capability SHALL pass `reuse: true` for a repeated identical request and `cache: "bypass"` for "Regenerate" (which also uses a new seed for seeded generators), and show "Reused previous result" when the provider cache answered. Analysis artefacts of on-device and host tools SHALL be keyed by tool id, tool version, model id and version, the SHA-256 of the source asset and the normalised parameters, are reused by every clip of that asset — including after split, trim, retime and duplicate — and live in the device cache store under the single budget and eviction rules of `project-storage.Cache management`, with the addition that an artefact referenced by an open project is never evicted. This capability defines no separate cache size. [NEW]

#### Scenario: Second clip of the same source
- **WHEN** a source already stabilised for one clip is used in a second clip and Stabilise is enabled on it
- **THEN** no new analysis runs and "Reused previous result" is shown

#### Scenario: Regenerate
- **WHEN** the user presses "Regenerate" on a generated image
- **THEN** a new provider job with `cache: "bypass"` and a different seed is created and both results are kept in the media library

#### Scenario: Artefact of an open project survives eviction
- **WHEN** the cache store exceeds its budget while a project using a matte artefact is open
- **THEN** other entries are evicted and the matte artefact remains

### Requirement: Input limits and validation
Each tool SHALL validate inputs before creating a job and report violations inline. Prompt fields accept 1–2 000 characters (music lyrics up to 3 000); text-to-speech input up to 5 000 characters per request, split automatically at sentence boundaries into requests within the model's limit; reference images up to 4 per generation, each up to 20 MB, formats PNG, JPEG and WebP; on-device video analysis up to 60 minutes of source per job on desktop and web and 10 minutes on mobile (longer inputs require "Run on host"); provider uploads up to the maximum the routed model declares in `generation-providers.Capability metadata`. Parameters outside the catalogue-declared ranges of the routed model (duration, resolution, aspect ratio, count) are not offered. Empty required input disables the primary action with a reason. [NEW]

#### Scenario: Prompt too long
- **WHEN** the user pastes a 2 400-character prompt
- **THEN** the counter shows "2400 / 2000" in the danger colour and Generate is disabled

#### Scenario: Long clip on a phone
- **WHEN** an 18-minute clip is selected for on-device background removal on a phone
- **THEN** the on-device option is disabled with "Clips over 10 minutes run on a host"

### Requirement: Failure handling and route fallback
A failed job SHALL show a message, a stable error code and "Retry". This capability's own codes are the closed set of twelve client, device and host conditions defined once in `ai-editing-tools.AI error codes`; no other requirement of this capability defines an `ai/` code. A provider failure is shown with the error class, message and suggested action of `generation-providers.Error and content-safety mapping` verbatim (for example "Open provider settings" or "Switch model" on quota exhaustion) and is not re-coded into an `ai/` code. Retries and the walk through fallback routes are those of `generation-providers.Retry policy` (three attempts per route, then the next fallback route) and `orc-model-routing.Route resolution and fallback`; this capability defines no retry count. The job records which route produced the result (`orc-model-routing.Fallback disclosure`), and a content-policy rejection is never retried automatically. A failed job leaves the project unchanged. [NEW]

#### Scenario: Fallback route succeeds
- **WHEN** the primary route times out and a fallback route is configured
- **THEN** the job completes through the fallback and the job detail names the fallback provider and model

#### Scenario: Content rejected
- **WHEN** the provider rejects a prompt for policy reasons
- **THEN** the job fails showing the provider error class and reason of `generation-providers.Error and content-safety mapping`, and no further provider call is made

#### Scenario: Quota exhausted
- **WHEN** the provider reports quota exhaustion on every route
- **THEN** the failure shows the suggested actions defined by `generation-providers.Error and content-safety mapping` in addition to "Retry"

#### Scenario: Project unchanged after a failure
- **WHEN** an upscale job fails with `ai/download-failed`
- **THEN** the element still uses its original asset and the undo stack has no new step

### Requirement: AI acceptance fixtures
Quality of on-device and host tools SHALL be verified against fixtures with numeric thresholds instead of visual judgement. The fixture sets live under `packages/media/fixtures/ai/` with a manifest (set id, files, ground truth, licence), obey `diagnostics-quality.Test fixtures`, and are enumerated with their metric and threshold in the section "Acceptance fixtures" of `specs/ai-editing-tools/catalog.md`. The thresholds are: image matte IoU ≥ 0.92 (`seg-salient`) and ≥ 0.85 (`seg-salient-lite`) as the mean over `matte-image-40`; video matte IoU ≥ 0.90 (`seg-person-hq`) and ≥ 0.82 (`seg-person`) with no clip below 0.75 and frame-to-frame alpha change ≤ 2 % on static regions over the six prescribed clips of `matte-video-6`; propagated custom-cutout IoU ≥ 0.80 over `matte-custom-4`; auto reframe subject centre inside the central 60 % on ≥ 95 % of frames over `reframe-4`; tracking centre error ≤ 3 % of frame width on ≥ 90 % of frames over `track-6`; stabilisation residual translation reduced by ≥ 60 % over `handheld-5`; flicker amplitude ≤ 2 % over `flicker-3`; eye-contact gaze error ≤ 3° over `gaze-8`, measured with the face-mesh gaze estimate; silence detection boundaries within 40 ms over `speech-pauses-3`; stem separation vocal SDR ≥ 5 dB over `stems-3`; smart-search recall@5 ≥ 0.7 over `search-30`; speech recognition word error rate ≤ 12 % (`whisper-small`) and ≤ 20 % (`whisper-tiny`) with median word-timing error ≤ 150 ms over `speech-en-30`; lyrics line breaks within 0.3 s of a labelled line break on 100 % of generated breaks over `lyrics-4` (the fixture cited by `captions-subtitles`). Speed thresholds stated in tool requirements are measured on the reference devices of `diagnostics-quality.Performance budgets`, and each model fixture is run on both execution providers of `Inference runtime` and on the host runtime. Provider tools are verified against the typed fake provider of `diagnostics-quality.Unit tests with typed fake ports` for request shape, consent, cost and result handling, not for output quality. A release build MUST NOT ship while any threshold fails. [NEW]

#### Scenario: Matte threshold
- **WHEN** the fixture run computes a mean IoU of 0.90 for `seg-salient` over `matte-image-40`
- **THEN** the AI acceptance job fails naming the tool, the set and the measured value

#### Scenario: Every on-device tool has a fixture
- **WHEN** an on-device tool id of the tool table has no row in "Acceptance fixtures"
- **THEN** the catalogue check fails naming the tool id

#### Scenario: Provider tool contract
- **WHEN** `generate.video` runs against the typed fake provider with a start image and an end image
- **THEN** the recorded request carries both images in the first-frame and last-frame fields and the test asserts the consent and cost steps occurred in that order

### Requirement: Background removal for images
`cutout.image` SHALL take an image element (a sticker has no `cutout`; a cut-out image is turned into a sticker with "Save as sticker") and produce an alpha matte of the foreground subject (people and salient objects) on-device with the manifest model `seg-salient` (`seg-salient-lite` where admission requires it), stored as a derived artefact at the source resolution up to 4 096 px on the long side and attached to the element as its cutout matte in the data model of `masks-blending-keying.Cutout model and auto cutout`, rendered by the `matte` stage of `render-engine.Per-layer stage order`. Matte quality MUST meet the image-matte threshold of "AI acceptance fixtures". Processing a 12-megapixel image MUST finish within 3 s on the reference desktop and 8 s on the reference mobile devices. The edge controls shown in the panel ("Invert", "Feather", "Edge shift"), their ranges, defaults and stored fields are those of `masks-blending-keying.Cutout model and auto cutout` and are defined nowhere in this capability; cutout stroke styles, the brush editor and background replacement are provided by `masks-blending-keying.Cutout stroke`, `masks-blending-keying.Custom cutout` and `masks-blending-keying.Replace background after cutout` on the same matte, and the click model and propagation behind the brush editor by `Interactive cutout and propagation`. An image whose matte covers less than 0.5 % of its pixels fails with `ai/no-subject-found` and leaves the element unchanged. "Save as sticker" adds the cut-out PNG to the media library. [NEW] [CAPCUT CC-154] [PORT N-017]

#### Scenario: Remove background of a portrait photo
- **WHEN** Remove background runs on fixture `matte-image-40/portrait-01` placed above a colour background
- **THEN** the intersection-over-union of the produced matte with the fixture's ground truth is at least 0.92
- **AND** the colour background is visible wherever the ground-truth matte is 0

#### Scenario: No subject
- **WHEN** the tool runs on a uniform grey image
- **THEN** the job fails with `ai/no-subject-found` and the element is unchanged

#### Scenario: Speed on the reference desktop
- **WHEN** a 4 000×3 000 image is processed on the reference desktop with the model already loaded
- **THEN** the matte is attached within 3 s

### Requirement: Background removal for video
`cutout.video` SHALL produce a per-frame matte track for the trimmed range of a video clip (plus 1 s of handles on each side where source exists), stored as a derived asset of role `matte` (a single-channel video addressed by source time) and referenced by the element's `cutout.matteAssetId`. Two models exist, because one small model cannot serve both phones and full-quality desktop work: **Standard** uses `seg-person` (a 256×256 portrait segmenter; mask refined to a long side of 720 px by joint bilateral upsampling guided by the frame's luma) and is the default on iOS and Android; **High quality** uses `seg-person-hq` (a human matting network run at a 512-px short side; matte stored at a long side of 1 080 px) and is the default on desktop (macOS, Windows, Linux) and web where it passes admission, and is offered on iOS and Android as "Run on host". The mode is a choice in the panel ("Quality: Standard / High"), stored with the job parameters; changing it re-runs the analysis. **Temporal filter (both modes).** After inference each frame's alpha is smoothed against the previous output: `out_t = w × out_(t−1) + (1 − w) × raw_t` with `w = 0.6 × (1 − smoothstep(0.02, 0.10, |luma_t − luma_(t−1)|))` per pixel (strong smoothing where the picture is static, none where it moves), reset at a scene cut (mean absolute luma difference above 0.25). **Acceptance.** The fixture set `matte-video-6` is fixed in content — one webcam head-and-shoulders clip, two full-body clips, one clip with two people, one moving-camera clip and one clip with loose hair or clothing — and the thresholds of "AI acceptance fixtures" MUST hold per model: mean IoU ≥ 0.90 for `seg-person-hq` and ≥ 0.82 for `seg-person` over all six clips, no clip below 0.75, and mean alpha change between consecutive frames in static regions ≤ 2 % for both. Throughput MUST be at least 10 source frames per second on the reference desktop in either mode and 3 on the reference phones in Standard mode. Progress shows percentage and estimated time remaining; the preview shows the cutout progressively for frames already processed. Extending the clip's trim beyond the processed range marks the clip "Needs processing" for the new range and offers "Process remaining". The edge controls are those of `masks-blending-keying.Cutout model and auto cutout`. Speed changes, reverse and split keep the matte aligned, because it is addressed by source time. A clip longer than the on-device limit of "Input limits and validation" is offered "Run on host" only. [NEW] [CAPCUT CC-154]

#### Scenario: Matte follows a retimed clip
- **WHEN** a clip with a completed cutout is set to 2× speed
- **THEN** the matte stays aligned with the picture on every frame without re-processing

#### Scenario: Temporal stability
- **WHEN** the fixture set `matte-video-6` is processed in each mode
- **THEN** mean IoU is at least 0.90 in High quality and at least 0.82 in Standard, no clip is below 0.75, and the mean absolute alpha change between consecutive frames inside the fixtures' static regions is at most 2 % in both

#### Scenario: High quality on a phone
- **WHEN** the user chooses "Quality: High" on an iOS or Android phone
- **THEN** the on-device option is disabled with the not-enough-memory message and "Run on host" is offered when `host-analysis` is available

#### Scenario: Trim extended past the processed range
- **WHEN** the user extends the clip's out point 5 s beyond the processed range
- **THEN** the added range shows the uncut picture with a "Needs processing" badge and "Process remaining" runs only the new range

#### Scenario: Export while processing
- **WHEN** an export is started while the matte is 60 % processed
- **THEN** the pre-flight of `export-share.Pre-flight validation` lists the clip with "Wait for processing"

### Requirement: Person matte for body effects
Applying an effect with `requires: "person-matte"` (`visual-effects-filters.Body effects use the on-device person matte`) SHALL obtain a person matte for the element WITHOUT cutting the element out. This requirement owns how that matte job is started, where it runs and how it is cached. **Start.** The command that adds the first body-effect entry to a video or image element (from a tile, a paste, a preset, a template or an agent tool) requests the matte: a job of tool `cutout.video` (video) or `cutout.image` (image) with `params {subject: "person", attach: false}`, for the element's visible source range plus 1 s handles; `attach: false` means the result is never written to `cutout.matteAssetId` and `cutout.mode` is not changed. Images use `seg-person` on the still (a person matte, not the salient-object matte of `Background removal for images`). **Model.** Always `seg-person` (Standard mode of `Background removal for video`, including its temporal filter), on every platform, so body effects look the same everywhere. **Cache.** The result is an analysis artefact — not a document field and not a derived asset referenced from the document — keyed by the source asset's content hash, the model id and version and the analysed source range (`Result cache by input hash`); it is reused by every clip of that asset and by any number of body effects on a clip, extended (never recomputed) when a trim reveals more source, kept while a body-effect entry of an open project needs it, and delivered to the engine as the entry `kind: "person-matte"`, key `<assetId>:person` of `render-engine.Derived asset delivery to the engine`. When the element already has a completed auto-cutout matte produced by `seg-person` for the same range, that artefact is reused and no job runs. **Progress and failure.** The job appears in the AI jobs list as "Person matte"; the clip shows the percentage of frames analysed; cancelling it leaves the entries in place rendering as pass-through with "Analyse" in the effects list; a failure shows a warning icon with Retry. **Limits.** A clip over the on-device duration limit of "Input limits and validation" runs as "Run on host" when a host with `host-analysis` is connected; with no such host the command that would add the body effect is refused before any entry is added, with "Clips over 10 minutes run on a host" on mobile and "Clips over 60 minutes run on a host" on desktop and web. Removing the last body-effect entry cancels a running job; the artefact stays in the cache under its normal eviction rule. [NEW]

#### Scenario: Matte job starts with the effect
- **WHEN** Background Blur is applied to a 20 s video clip that has no cutout
- **THEN** one "Person matte" job starts for the clip's source range, the clip's `cutout.mode` stays `none`, and the effect renders on each frame as soon as its matte exists

#### Scenario: Second body effect reuses the matte
- **WHEN** Body Glow is added to the same clip afterwards
- **THEN** no new job starts

#### Scenario: Long clip on a phone without a host
- **WHEN** a body effect is applied to an 18-minute clip on an iOS or Android phone with no host
- **THEN** no entry is added and the message "Clips over 10 minutes run on a host" is shown

#### Scenario: Image
- **WHEN** a body effect is applied to an image element
- **THEN** the matte is computed once with `seg-person` on the still and the effect renders

### Requirement: Interactive cutout and propagation
This requirement owns the model side of `masks-blending-keying.Custom cutout`: the click model, the propagation of a selection across a video clip, where they run and their acceptance. The brush editor, its tools, the strokes and the `cutout` data are owned by that requirement. **Click model.** Smart brush and Smart eraser send the points of each stroke (sampled every 16 px, at most 32 per stroke; Smart brush points are positive prompts, Smart eraser points negative) with the current frame to the manifest model `seg-click`, which returns the object mask for that frame; the editor unions or subtracts it. The image encoder runs once per frame (at most 1.5 s on the reference desktop) and each stroke is then answered within 150 ms. **Propagation.** On Done for a video element the current matte is propagated across the clip's visible source range plus 1 s handles, forward and backward from the edited frame: the motion tracker of `Motion tracking` (signal processing, no model) follows the matte's bounding box and a grid of up to 16 points inside the matte; every 0.5 s of source, and whenever tracker confidence drops below 0.5, the frame is re-segmented with `seg-click` prompted by the tracked box and points; frames between two segmented frames receive the nearer mask warped by the tracked motion; the result passes through the temporal filter of `Background removal for video` and is stored as a derived asset of role `matte` referenced by `cutout.matteAssetId`. When the tracker loses the object (the loss rule of `Motion tracking`) propagation stops there, the remaining frames render uncut, and the panel shows "Object lost at <timecode>" with "Adjust on this frame and continue", which reopens the editor on that frame. The job is a `cutout.video` job with `params {mode: "custom", frame, matte}` (for an image: `cutout.image` with `params {mode: "custom", matte}`, which stores the edited matte with no model run). **Where it runs.** `seg-click` (peak 600 MiB) is above the 400 MiB mobile cap and no click model in the manifest fits under it, so: on desktop (macOS, Windows, Linux) and web it runs on the device where it passes admission; on iOS and Android, and on any device where it fails admission, the two smart tools and the propagation run on the host — each stroke as a job of `jagentchill.ai.analysis.create` with `tool: "cutout.image"` or `"cutout.video"` and `params {mode: "click", frame, points}` answered within 2 s on the reference host for a synced asset, the propagation as one job with `params {mode: "custom", …}` — when a host advertising `host-analysis` is connected and the asset's original is synced. With neither, Smart brush and Smart eraser are disabled with "Smart selection needs a host on this device", and for a video element Done is disabled with "Custom cutout of video needs a host on this device"; the exact Brush and Eraser tools and custom cutout of images work everywhere. Throughput of propagation MUST be at least 8 source frames per second on the reference desktop. **Acceptance.** Fixture `matte-custom-4` (four clips: a held object, a rolling ball, a pet, a person seen from behind; one prompt stroke each on the first frame): mean IoU of the propagated matte against ground truth ≥ 0.80, no clip below 0.70. [NEW] [CAPCUT CC-155, CC-156]

#### Scenario: Stroke becomes an object mask
- **WHEN** a Smart brush stroke is drawn across a cup on the reference desktop with the frame already encoded
- **THEN** the cup's mask is returned within 150 ms

#### Scenario: Propagation accuracy
- **WHEN** the four clips of `matte-custom-4` are propagated from their first-frame stroke
- **THEN** the mean IoU against ground truth is at least 0.80 and no clip is below 0.70

#### Scenario: Object leaves the frame
- **WHEN** the selected object leaves the frame at 00:00:04:12
- **THEN** propagation stops there, the frames after it render uncut, and the panel shows "Object lost at 00:00:04:12" with "Adjust on this frame and continue"

#### Scenario: Phone with a host
- **WHEN** a Smart brush stroke is drawn on an iOS or Android phone paired with a host that has the clip's original
- **THEN** an `ai.analysis` job with `params.mode: "click"` returns the mask within 2 s on the reference host

#### Scenario: Phone without a host
- **WHEN** Custom cutout is opened for a video clip on a phone with no host
- **THEN** the smart tools show "Smart selection needs a host on this device" and Done shows "Custom cutout of video needs a host on this device"

### Requirement: Auto reframe
`reframe` SHALL adapt selected video or image clips, or the whole project, to a target aspect ratio (9:16, 16:9, 1:1, 4:5, 4:3, 3:4, or custom) by tracking the main subject on-device (faces first, then people, then salient region) and writing position and scale keyframes (property paths of `keyframe-animation.Animatable property paths`) that keep the subject inside the central 60 % of the target frame while filling the frame (cover fit). Options: camera speed "Slow", "Default" or "Fast" (maximum pan speed 5 %, 12 % or 25 % of frame width per second) and "Lock camera" (one static framing per clip). Keyframes are generated at most 2 per second with bezier easing on `transform.position.x`, `transform.position.y`, `transform.scale.x` and `transform.scale.y`, and are ordinary keyframes editable as defined by `keyframe-animation.Expanded keyframe lanes and keyframe panel`. The tool records what it wrote in `autoReframe {aspect, keyIds[]}` on the element (`project-document.Analysis-driven settings`): re-running it replaces exactly the keys listed there, and when one of those four channels holds a key that is not listed (a key of the user or of another tool) the clip is skipped and reported in the summary as "Has its own position or scale keyframes" unless the user ticks "Replace existing keyframes" in the panel. Framing accuracy MUST meet the reframe threshold of "AI acceptance fixtures". Applying to the project changes the project canvas to the target ratio and reframes every main-track and overlay video and image clip in a single undo step; text, stickers and captions keep their normalised positions. A clip with no detected subject is centred and reported in a summary. [NEW] [CAPCUT CC-238]

#### Scenario: Landscape interview to vertical
- **WHEN** each 16:9 clip of fixture set `reframe-4` is reframed to 9:16 with Default speed
- **THEN** the canvas becomes 9:16, the clip fills the frame, and the labelled subject centre stays within the central 60 % of the frame width on at least 95 % of frames

#### Scenario: Editable result
- **WHEN** the user opens the keyframe lanes of a reframed clip
- **THEN** position and scale keyframes are present and can be moved or deleted individually

#### Scenario: Single undo for a project reframe
- **WHEN** the user undoes after reframing a project of 12 clips
- **THEN** the canvas ratio and all 12 clips return to their previous state in one step

#### Scenario: Re-run replaces only its own keys
- **WHEN** a reframed clip is reframed again with "Fast" camera speed
- **THEN** the keys listed in `autoReframe.keyIds` are replaced by the new ones, the list is updated, and no other keyframe of the clip changes

#### Scenario: Clip with the user's keyframes
- **WHEN** a clip in a project reframe has position keyframes the user made
- **THEN** that clip keeps its keyframes, is centred by none of the tool's keys, and the summary lists it under "Has its own position or scale keyframes"

### Requirement: Motion tracking
`track` SHALL let the user draw a rectangle or ellipse around a target on a video clip at the playhead and track it forward, backward or both across the clip on-device, producing a tracking path of position, scale and rotation per source frame, stored for the clip's source asset with a stable `trackId`: the asset's `motionTracks[]` entry `{id, name, shape, sourceStart, sourceEnd, dataHash}` (`project-document.Media asset records`) is the document record, and the per-frame samples are a derived file addressed by `dataHash`, delivered to the engine as `kind: "motion-track"` of `render-engine.Derived asset delivery to the engine`. Attaching another element to a path ("Follow") is non-destructive: it creates a live tracking binding — `tracking {targetElementId, trackId, …}` on a text, sticker or graphic follower (`project-document.Tracking binding`) and `masks[].tracking {trackId, …}` on a mask of the tracked element (`project-document.Mask fields`) — defined and resolved live by `text-and-titles.Text tracking`, `stickers-shapes.Sticker and shape animation and tracking` and `masks-blending-keying.Mask tracking attachment`, which also own "Convert to keyframes"; this capability writes no keyframes on followers. Tracking speed MUST be at least 30 source frames per second on the reference desktop and 10 on the reference mobile devices. Loss rule (the one rule used by every follower capability): when the tracker's confidence stays below 0.3 for more than 0.5 s, tracking stops at the last confident frame, the panel shows "Target lost at <timecode>" and offers "Adjust region and continue". Deleting a path removes the bindings that reference it after a confirmation naming the followers, as one undo step. Accuracy MUST meet the tracking threshold of "AI acceptance fixtures". [NEW] [CAPCUT CC-240]

#### Scenario: Sticker follows a moving object
- **WHEN** a sticker is attached to the tracking path of the moving car in fixture `track-6/car`
- **THEN** the sticker element holds a tracking binding and no new keyframes
- **AND** in the rendered frames the sticker stays at the same offset from the car's ground-truth centre within 3 % of frame width on at least 90 % of tracked frames

#### Scenario: Target lost
- **WHEN** the target leaves the frame at 00:00:07:10
- **THEN** tracking stops there, the panel shows "Target lost at 00:00:07:10", and the path has samples only up to that frame

#### Scenario: Delete a path with followers
- **WHEN** the user deletes a path followed by two text elements and confirms
- **THEN** both bindings are removed in one undo step and the text elements keep the position they had at the playhead

### Requirement: Video stabilisation
`stabilise` SHALL analyse a video clip's source on-device (feature tracking and smoothed camera path, no model) and store a stabilisation track (per source frame affine transform and crop zoom) rendered by the `stabilise` stage of `render-engine.Per-layer stage order`. The stored property is `stabilization {enabled, level}` (`project-document.Analysis-driven settings`) with `level` one of `min-crop` ("Minimum crop", crop zoom at most 1.05), `recommended` ("Recommended", default, at most 1.10) and `max-stable` ("Most stable", at most 1.20); the applied crop zoom is constant per clip and shown as a percentage. Changing the level recomputes smoothing from the stored motion data within 2 s without re-analysing. Analysis MUST run at 30 source frames per second or faster on the reference desktop and 8 or faster on the reference mobile devices. Disabling it restores the original framing and keeps the analysis for re-enabling. Clips with fewer than 50 trackable features on more than half of their frames report `ai/unsupported-input` with "Not enough detail to stabilise". [NEW] [CAPCUT CC-161, CC-162]

#### Scenario: Stabilise a handheld clip
- **WHEN** Stabilise at `recommended` completes on each clip of fixture set `handheld-5`
- **THEN** the residual frame-to-frame translation of tracked background features is reduced by at least 60 % compared with the source
- **AND** the picture is zoomed by at most 10 %

#### Scenario: Change level
- **WHEN** the level is changed from `recommended` to `max-stable`
- **THEN** the preview updates within 2 s without a new analysis job

#### Scenario: Disable
- **WHEN** stabilisation is toggled off
- **THEN** the clip renders with its original framing and toggling it on again applies without a new analysis job

#### Scenario: Featureless clip
- **WHEN** Stabilise runs on a clip of a uniform white wall
- **THEN** the job fails with `ai/unsupported-input` and the message "Not enough detail to stabilise"

### Requirement: Flicker removal
`deflicker` SHALL reduce frame-to-frame luminance flicker of a video clip (artificial light, time-lapse) on-device by analysing per-frame luminance in a 4×4 grid and storing a deflicker track (a 4×4 grid of gains per source frame) applied in the `retouch` stage of `render-engine.Per-layer stage order`, with the stored field `deflicker {enabled, strength}` (`project-document.Analysis-driven settings`), whose "Strength" 0–100 (default 50) the temporal smoothing window from 3 to 31 frames. Analysis MUST run at 60 source frames per second or faster on the reference desktop and 15 or faster on the reference mobile devices, and the result MUST meet the flicker threshold of "AI acceptance fixtures". The property is non-destructive, keyframe-free, and removable in one undo step. [NEW] [CAPCUT CC-163]

#### Scenario: Flicker reduced
- **WHEN** Remove flicker at strength 50 is applied to each clip of fixture set `flicker-3`, whose mean luminance oscillates by ±8 % between consecutive frames
- **THEN** the oscillation of mean luminance in the rendered output is ±2 % or less

#### Scenario: Strength zero
- **WHEN** strength is set to 0
- **THEN** the rendered frames equal the unprocessed frames

### Requirement: Upscale and enhance
`upscale` SHALL increase the resolution and clarity of an image or video clip through the server (`image` role route `upscale` for stills, `video` role route `upscale` for clips) with a factor of 2× or 4× limited to the factors and maximum output size the routed model declares, and an "Enhance details" toggle where the model declares it. The result is a new media asset; the element is switched to it with the replace-media semantics of `timeline-editing.Replace media` (timing, trim, transform, effects and keyframes preserved, crop and position rescaled so on-canvas framing is unchanged), the element records `processedSource {originalMediaId, tool: "upscale", sourceStart, sourceEnd}` (`project-document.Element common fields`), and "Revert to original" switches back to `originalMediaId` and removes the record. For clips only the trimmed range plus 1 s handles is processed, and extending the trim beyond it reverts the new range to the original with a "Needs processing" badge. With no route whose model declares upscale for the element type, the action is disabled per "Offline and no-provider behaviour". [NEW] [CAPCUT CC-134]

#### Scenario: Upscale an image 2×
- **WHEN** a 960×540 image is upscaled 2× and the job succeeds
- **THEN** a 1920×1080 asset is added, the element uses it, and the element occupies the same rectangle on the canvas as before within 1 px

#### Scenario: Factor not offered
- **WHEN** the routed model declares upscale factors `[2]`
- **THEN** the 4× option is not offered

#### Scenario: Revert
- **WHEN** the user chooses "Revert to original"
- **THEN** the element uses the original asset again in one undo step and the upscaled asset stays in the media library

### Requirement: Relight
`relight` SHALL add virtual lighting to a video or image element on-device using a per-frame depth estimate (relight track from the manifest model `depth`, or `depth-lite` where admission requires it) and the face mesh where a face is present. Controls: light position by dragging a handle on the preview (azimuth −180..180°, elevation −90..90°), "Intensity" 0–100 (default 50), "Colour temperature" 2 000–10 000 K (default 5 500), "Ambient" −100..100 (default 0), "Scope" (Face, Subject, Whole frame; default Subject), and exactly the six presets enumerated with their azimuth, elevation, intensity, temperature and ambient values in the section "Relight presets" of `specs/ai-editing-tools/catalog.md` (Front, Rim, Side left, Side right, Top, Warm evening). The stored field is `relight {enabled, presetId?, azimuth, elevation, intensity, temperature, ambient, scope}` (`project-document.Analysis-driven settings`); the five numeric values are keyframable on the paths `relight.azimuth`, `relight.elevation`, `relight.intensity`, `relight.temperature` and `relight.ambient` (group 9 of `project-document.Animatable property paths`), and `scope` and `presetId` are static (changing a value after choosing a preset clears `presetId`). Depth analysis MUST run at 8 source frames per second or faster on the reference desktop and, with `depth-lite`, at 2 or faster on the reference phones (iOS and Android). Rendering is performed in the `retouch` stage of `render-engine.Per-layer stage order`; removing the property is one undo step. [NEW] [CAPCUT CC-169]

#### Scenario: Side light on a face
- **WHEN** the "Side left" preset is applied to fixture `retouch-10/frontal-01`
- **THEN** the mean luminance of the left half of the face region rises by at least 10 % relative to the right half

#### Scenario: Preset values
- **WHEN** the "Rim" preset is chosen
- **THEN** the azimuth, elevation, intensity, temperature and ambient controls show exactly the values of the "Rim" row of the catalogue

#### Scenario: Keyframed intensity
- **WHEN** intensity is keyframed from 0 to 100 over 2 s
- **THEN** the mean luminance change of the lit region increases monotonically across those frames

### Requirement: Face retouch
`retouch` SHALL provide on-device face retouch driven by a per-frame face mesh track (manifest model `face-mesh`), rendered in the `retouch` stage of `render-engine.Per-layer stage order`, with these sliders (0–100, default 0, keyframable) and stored keys: Smooth skin (`smoothSkin`), Brighten skin (`brightenSkin`), Remove dark circles (`darkCircles`), Soften smile lines (`smileLines`), Whiten teeth (`whitenTeeth`), Remove blemishes (`blemishes`), Brighten eyes (`brightenEyes`); and Skin tone (`skinTone`, −50 cool to +50 warm, default 0). They are stored per face in `retouch {enabled, applyToAll, autoStyle?, faces, body}` (`project-document.Analysis-driven settings`): `retouch.faces.all` holds the values used for every face while `applyToAll` is true, and `retouch.faces.<faceId>` the values of one face otherwise; the keyframe paths are `retouch.faces.<faceKey>.<key>` (group 9 of `project-document.Animatable property paths`). Effects apply only inside the detected skin, eye and teeth regions with feathered edges and MUST leave hair, background and clothing pixels unchanged within 2 per channel. Face analysis MUST run at 20 source frames per second or faster on the reference desktop and 8 or faster on the reference mobile devices. Frames with no face render unmodified. [NEW] [CAPCUT CC-164]

#### Scenario: Smooth skin
- **WHEN** Smooth skin is set to 60 on fixture `retouch-10/frontal-01`
- **THEN** high-frequency texture energy inside the skin mask decreases by at least 30 % while pixels outside the face region change by at most 2 per channel

#### Scenario: No face in frame
- **WHEN** the subject leaves the frame for 2 s
- **THEN** those frames are rendered unmodified and no error is raised

#### Scenario: Stored key and keyframe path
- **WHEN** Smooth skin is set to 60 with "Apply to all faces" on and a keyframe is added
- **THEN** the element stores `retouch.faces.all.smoothSkin = 60` and its `animations` contain the path `retouch.faces.all.smoothSkin`

### Requirement: Makeup presets
`retouch` SHALL include makeup: exactly the 8 complete looks enumerated in the section "Makeup looks" of `specs/ai-editing-tools/catalog.md` (each a combination of lipstick, blush, eyeshadow, eyeliner, eyebrow and contour layers with a colour and an intensity per layer), applied with a single "Intensity" 0–100 (default 60), plus individual layer controls (colour picker and 0–100 intensity per layer), stored per face as `makeup {look, intensity, layers}` inside `retouch.faces.<faceKey>`; makeup values are static (not keyframable). Makeup layers are rendered from the face mesh track, follow head movement, and fade out linearly between 50° and 60° of head yaw; beyond 60° no layer is drawn. [NEW] [CAPCUT CC-165]

#### Scenario: The panel lists exactly eight looks
- **WHEN** the Makeup section is opened offline
- **THEN** exactly the 8 looks of the catalogue are listed in catalogue order

#### Scenario: Apply a look
- **WHEN** the first look is applied at intensity 60 to fixture `retouch-10/frontal-01`
- **THEN** the mean colour inside the lip region moves toward the look's lipstick colour by at least 30 % of the distance, and the lip region stays registered to the mesh within 2 % of face width while the head moves

#### Scenario: Extreme head turn
- **WHEN** the head yaw exceeds 60°
- **THEN** no makeup layer is drawn on that frame

### Requirement: Face reshape
`retouch` SHALL include face reshape sliders (−100..100, default 0, keyframable on `retouch.faces.<faceKey>.reshape.<key>`), stored as the 11 keys of `retouch.faces.<faceKey>.reshape`: Slim face (`slimFace`), Jaw width (`jawWidth`), Chin length (`chinLength`), Cheekbones (`cheekbones`), Forehead height (`foreheadHeight`), Eye size (`eyeSize`), Eye distance (`eyeDistance`), Nose width (`noseWidth`), Nose length (`noseLength`), Mouth size (`mouthSize`), and Lip thickness (`lipThickness`). Reshape is a mesh warp confined to the face region with a smooth falloff of 15 % of face width so that straight background lines beyond that margin stay straight. At slider value 0 the output equals the input. [NEW] [CAPCUT CC-166]

#### Scenario: Slim face
- **WHEN** Slim face is set to 50
- **THEN** the measured face width at cheek level decreases by between 3 % and 10 % and background pixels farther than 15 % of face width from the face outline are unchanged

#### Scenario: Neutral value
- **WHEN** every reshape slider is 0
- **THEN** rendered frames equal the unprocessed frames

### Requirement: Body reshape
`retouch` SHALL include body reshape sliders (−100..100, default 0, keyframable on `retouch.body.<key>`) driven by a per-frame body pose track (manifest model `body-pose`), stored as the 9 keys of `retouch.body`: Slim body (`slimBody`), Waist (`waist`), Hips (`hips`), Leg length (`legLength`), Leg width (`legWidth`), Shoulder width (`shoulderWidth`), Arm width (`armWidth`), Head size (`headSize`), and Neck length (`neckLength`). The warp is confined to the person matte of `Person matte for body effects` (requested the same way when the first body slider leaves 0) with a falloff of 10 % of body height. Body reshape requires the full torso to be detected; frames where the pose confidence is below 0.5 render unmodified, and when more than 30 % of the clip's frames lack a pose the panel shows "Body not fully visible in parts of this clip". [NEW] [CAPCUT CC-167]

#### Scenario: Lengthen legs
- **WHEN** Leg length is set to 40 on a full-body clip
- **THEN** the measured hip-to-ankle distance increases by between 3 % and 12 % and the head position is unchanged within 1 % of frame height

#### Scenario: Partial body
- **WHEN** a clip shows only head and shoulders
- **THEN** body sliders have no effect and the partial-visibility message is shown

### Requirement: Multi-face retouch and auto styles
`retouch` SHALL detect and track up to 5 faces per frame, each with a stable identity across the clip. Identity rule: the first face analysis of an asset writes the asset's `faces[] {id, firstSeen}` (`project-document.Media asset records`), numbering faces by first appearance in source time and, within a frame, left to right; the list is only ever appended to; when the analysis cache is rebuilt (cache eviction, another device, a new model version) each detected face is matched to the existing entry whose face box at `firstSeen` it overlaps most (IoU ≥ 0.3) and reuses that id, so the keys of `retouch.faces` never go stale; a stored face key with no match is shown in the panel as "Face not found" with Remove and its settings are kept but not applied. The tool SHALL and offer "Apply to all faces" (default) or per-face settings selected by clicking a face in the preview or a face chip in the panel. It SHALL include exactly the 6 one-tap auto styles enumerated with their slider values in the section "Retouch auto styles" of `specs/ai-editing-tools/catalog.md` (Natural, Fresh, Soft, Defined, Bright, Studio), each a predefined set of retouch, reshape and makeup values, with a global "Amount" 0–100 (default 100) that scales every value linearly; applying a style writes `retouch.autoStyle {id, amount}` and replaces current values in one undo step and the individual sliders stay editable afterwards. A sixth and further faces are left unmodified and the panel states "5 faces maximum". [NEW] [CAPCUT CC-168]

#### Scenario: Per-face settings
- **WHEN** two faces are present and Smooth skin 80 is set for face 1 only
- **THEN** face 1 is smoothed and face 2 is unchanged on every frame where both are tracked

#### Scenario: Auto style
- **WHEN** the "Natural" style is applied at Amount 50
- **THEN** every retouch slider shows half of the value listed for "Natural" in the catalogue and one undo restores the previous values

#### Scenario: Six faces
- **WHEN** a frame contains six faces
- **THEN** five are retouched, the sixth is unmodified and the panel shows "5 faces maximum"

#### Scenario: Face ids survive a rebuilt cache
- **WHEN** a project with per-face settings for two faces is opened on a second device, where the face analysis runs again
- **THEN** the two detected faces receive the ids already listed in the asset's `faces[]` and each face gets its own settings

### Requirement: Eye contact correction
`eye-contact` SHALL redirect the gaze of a detected face toward the camera on-device by warping the iris and eyelid regions from the face mesh track, with the stored field `eyeContact {enabled, strength}` (`project-document.Analysis-driven settings`; "Strength" 0–100, default 70, static). Correction is applied only while head yaw is within ±20° and pitch within ±15° and the eyes are open; outside these limits it fades to no correction over 5 frames. Blinks are preserved. Gaze is measured by the face-mesh gaze estimate (the angle between the camera axis and the line from the eyeball centre through the iris centre, both from the mesh landmarks), which is also the metric of the `gaze-8` fixtures. The property is removable in one undo step. [NEW] [CAPCUT CC-170]

#### Scenario: Reading from notes
- **WHEN** Eye contact at strength 100 is applied to the clips of fixture set `gaze-8`, where the speaker looks 10° below the lens
- **THEN** the gaze estimate on the rendered output is within 3° of the camera axis on at least 90 % of the frames inside the angle limits

#### Scenario: Head turned away
- **WHEN** the head yaw reaches 35°
- **THEN** no gaze correction is applied on those frames

#### Scenario: Blink
- **WHEN** the speaker blinks
- **THEN** the eyelid closure in the output spans the same frames as in the source

### Requirement: AI movement
`motion-style` SHALL add camera-style motion to a video or image clip on-device, as the flow behind `keyframe-animation.Camera-motion styles entry point`. Styles are exactly the six enumerated with their motion definition in the section "Motion styles" of `specs/ai-editing-tools/catalog.md`: Zoom in, Zoom out, Push, Shake, Soft sway and Dynamic. "Intensity" 0–100 (default 50) scales every amplitude linearly. **Subject.** Push, and Dynamic when the clip has no beat markers, use the subject centre found by the subject detector of `Auto reframe` (faces first, then people, then salient region; the canvas centre when none is found); Dynamic is beat-driven when the clip overlaps audio with beat markers (`audio-editing.Beat markers on audio`). The four styles Zoom in, Zoom out, Shake and Soft sway need no detector and no model. **Output.** Ordinary keyframes on `transform.position.x`, `transform.position.y`, `transform.scale.x`, `transform.scale.y` and `transform.rotation`, written as one undo step, and a record of what was written: `aiMotion {style, intensity, keyIds[]}` on the element (`project-document.Analysis-driven settings`). **Telling its own keys from the user's.** Re-applying a style (or choosing "None") removes exactly the keys listed in `aiMotion.keyIds` and writes the new ones; no other key is touched. A style is refused, with "Remove the existing position, scale or rotation keyframes first", when a channel the style would write holds a key that is not listed in `aiMotion.keyIds` (a key the user made, or one written by `Auto reframe`), because two interleaved animations on one channel cannot both be honoured; channels the style does not write are ignored by this check. A key of the tool that the user edits afterwards stays in the list (it is still replaced on re-apply); one the user deletes leaves the list (`keyframe-animation.Camera-motion styles entry point`). **Cover rule.** When the element covered the whole canvas on every frame before the tool ran, the generated scale is never below the value that keeps the canvas covered at the generated position and rotation; when it did not (a picture-in-picture or letterboxed clip), no minimum is applied and `S0` is the element's own scale. Random components are derived from a hash of the element id and frame index, so re-applying a style gives the same keyframes. A style whose generated keys would exceed 1 000 per property is refused with "Clip is too long for this style". The tool needs no host. [NEW] [CAPCUT CC-097]

#### Scenario: Zoom in at full intensity
- **WHEN** "Zoom in" at intensity 100 is applied to a 4 s clip at scale 1 that fills the canvas
- **THEN** the clip has scale keyframes at its start and end with the values of the "Zoom in" row of the catalogue, and no other property is keyframed

#### Scenario: Canvas stays covered
- **WHEN** "Shake" at intensity 100 is applied to a clip that exactly fills the canvas
- **THEN** on every frame of the clip no canvas pixel is uncovered by the clip

#### Scenario: Deterministic
- **WHEN** "Shake" is applied, undone and applied again to the same clip
- **THEN** the two sets of keyframes are identical

#### Scenario: Dynamic on a beat-marked clip
- **WHEN** "Dynamic" is applied to a clip overlapping music with 8 beat markers
- **THEN** 8 scale pulses are generated, each starting on a beat marker within one frame

#### Scenario: One undo
- **WHEN** the user undoes after applying a style
- **THEN** every keyframe written by the tool is removed in one step

#### Scenario: Re-apply replaces only its own keys
- **WHEN** "Zoom in" was applied, the user added an opacity keyframe, and "Soft sway" is then applied
- **THEN** the two Zoom in scale keys are removed, the Soft sway keys are written and listed in `aiMotion.keyIds`, and the opacity keyframe is unchanged

#### Scenario: User keyframes on a target channel
- **WHEN** the clip has position keyframes made by the user and "Push" is chosen
- **THEN** nothing is written and the message "Remove the existing position, scale or rotation keyframes first" is shown

#### Scenario: Picture-in-picture clip
- **WHEN** "Zoom in" at intensity 100 is applied to a clip at scale 0.4 that covers a corner of the canvas
- **THEN** the scale keys are 0.4 and 0.52 and the clip is not enlarged to cover the canvas

### Requirement: Restyle
`restyle` SHALL redraw an image or video clip in a chosen visual style through the server, as the job behind `visual-effects-filters.AI style effects entry point`: the `image` role route `restyle` for stills and the `video` role route `restyle` for clips (models declaring video-to-video). Styles are exactly the 8 enumerated with their id, label and project-authored style descriptor in the section "Restyle styles" of `specs/ai-editing-tools/catalog.md`: `anime`, `comic`, `oil-paint`, `watercolour`, `clay`, `pixel-art`, `sketch` and `neon`. "Strength" 0–100 (default 60) maps to the model's declared strength parameter. For clips only the trimmed range plus 1 s handles is sent, and a clip longer than the routed model's declared maximum input duration disables the style tiles with "Clip is longer than <n> s, the limit of <model>". The result is a new asset applied non-destructively with the replace-media semantics of `timeline-editing.Replace media` and "Restore original"; consent, cost estimate and budgets apply as for every provider tool. With no usable route the tiles are disabled per "Offline and no-provider behaviour". [NEW] [CAPCUT CC-107]

#### Scenario: Eight styles are listed
- **WHEN** the AI styles category is opened
- **THEN** exactly the 8 styles of the catalogue are shown in catalogue order

#### Scenario: Restyle an image
- **WHEN** the `watercolour` style at strength 60 is applied to an image and the job succeeds
- **THEN** a new image asset is applied to the element at the same canvas rectangle, and "Restore original" switches back in one undo step

#### Scenario: Clip over the model limit
- **WHEN** a 40 s clip is selected and the routed video model declares a maximum input of 10 s
- **THEN** the style tiles are disabled with "Clip is longer than 10 s, the limit of <model>"

#### Scenario: Descriptor is sent, not user media beyond the range
- **WHEN** a 6 s trimmed range is restyled with `anime`
- **THEN** the provider request contains the `anime` descriptor text of the catalogue and 8 s of media (range plus handles)

### Requirement: Stem separation
`separate.stems` SHALL split the audio of an audio element or of a video element into two stems, `vocals` and `accompaniment`, as the tool behind `audio-editing.Vocal isolation` and the "Keep music and effects" option of "Dubbing". It runs only on the host as a job of kind `ai.analysis` with the host-local manifest model `stems-htdemucs`; it uses no provider, sends nothing outside the user's host and has no cost, and it requires feature flag `host-analysis`. The source asset must be synced to the server; the two stems are stored as derived audio artefacts of the source asset at the source sample rate and duration (equal within one sample), synced back like other derived data. Separation quality MUST meet the stem threshold of "AI acceptance fixtures" (vocal SDR ≥ 5 dB), and a 3-minute stereo source MUST complete within 6 minutes on the reference desktop acting as host. Which stem an element plays, and its controls, are defined by `audio-editing.Vocal isolation`. Without a connected host the action is disabled with "Connect to a host to use this tool". [NEW]

#### Scenario: Separate a song
- **WHEN** stem separation runs on each mix of fixture set `stems-3`
- **THEN** the vocal stem's signal-to-distortion ratio against the reference vocal is at least 5 dB for each mix
- **AND** each stem has the same duration as the source within one sample

#### Scenario: No provider involved
- **WHEN** network traffic of the host is captured during a separation job
- **THEN** no request leaves the host for the job

#### Scenario: Host without host analysis
- **WHEN** the connected host does not advertise `host-analysis`
- **THEN** "Isolate vocals" is disabled with "This host cannot run analysis"

#### Scenario: Reuse
- **WHEN** two clips of the same source asset both enable vocal isolation
- **THEN** one separation job runs and both clips use its stems

### Requirement: Text to speech with voice selection
`tts` SHALL synthesise speech through the `voice-tts` role from: a selected text element, selected captions, or text typed in the panel. The panel lists the voices of `generation-providers.Voice catalogue` for the routed provider with name, language, gender tag and a preview button (plays a cached sample of at most 10 s), filterable by language and searchable by name, with favourites and the 8 most recently used voices pinned. Controls offered when the model declares them: speed 0.5–2.0 (default 1.0), pitch −12..+12 semitones (default 0), and style or emotion. The output is an audio asset inserted on an audio track at the source text element's start time (or at the playhead for typed text), linked to the source element; one audio element per text element or caption. Options, with the same names and defaults as `text-and-titles.Text-to-speech hand-off`: "Match text duration to speech" (default on; sets each text element's duration to its audio duration) and "Update speech when text changes" (default off; marks the audio "Out of date" after a text edit and offers "Update" rather than regenerating automatically). The whole insertion is one undo step. With no `voice-tts` route the tool is disabled per "Offline and no-provider behaviour". [NEW] [CAPCUT CC-242, CC-183]

#### Scenario: Speech from a text clip
- **WHEN** a text element starting at 00:00:04:00 is converted with a selected voice
- **THEN** an audio element containing the spoken text starts at 00:00:04:00 on an audio track and is linked to the text element
- **AND** the text element's duration equals the audio duration because "Match text duration to speech" is on

#### Scenario: Batch from captions
- **WHEN** 12 captions are selected and converted
- **THEN** 12 audio elements are created, each starting at its caption's start time, and one undo removes all 12

#### Scenario: Text edited afterwards
- **WHEN** the source text is edited after generation with "Update speech when text changes" on
- **THEN** the audio element shows "Out of date" with an "Update" action and no provider call is made until it is pressed

### Requirement: Voice enhance and noise cleanup
The tool id `voice-enhance` is an entry point only: its processing, parameters, caching as derived audio and acceptance are defined by `audio-editing.Enhance voice` and `audio-editing.Noise reduction`, and this capability SHALL define none of them. The AI tools tab and the command palette list "Enhance voice" for audio elements and video elements with audio; activating it opens the controls of `audio-editing` for the selection, and the speech-denoise model it uses is the manifest entry `speech-denoise` managed by "On-device model management". [NEW] [CAPCUT CC-216, CC-215]

#### Scenario: Entry point opens the audio controls
- **WHEN** the user activates "Enhance voice" in the AI tools tab for a selected voice clip
- **THEN** the Enhance voice and Noise reduction controls of `audio-editing` are shown for that clip and no separate AI job type is created

#### Scenario: Model comes from the manifest
- **WHEN** Enhance voice is enabled for the first time on a device without the `speech-denoise` model
- **THEN** the model consent and download flow of "On-device model management" runs before processing

### Requirement: AI voice changer
`voice-changer` SHALL convert the speech of an audio element or a video element's audio to a selected target voice through the `voice-design` role route `convert` (models declaring speech-to-speech), preserving timing: the result has the same duration within 20 ms and its word onsets, measured by aligning both signals' speech envelopes, are within 40 ms of the original's. The voice list, preview, favourites and recents behave as in text to speech. The result is a new audio asset; the element's audio source is switched to it (for video elements the picture is unchanged and the original audio is retained for "Revert to original"). Signal-processing voice effects that need no provider are defined by `audio-editing.Voice changer` and are listed in the same panel under "Effects", available offline. With no usable `convert` route the "AI voices" section shows the no-provider message and the "Effects" section stays usable. [NEW] [CAPCUT CC-218]

#### Scenario: Convert a voiceover
- **WHEN** a 20 s voiceover is converted to a target voice through the typed fake provider returning a time-aligned result
- **THEN** the element plays the converted audio with a duration within 20 ms of the original
- **AND** a result whose word onsets deviate by more than 40 ms is rejected with `ai/unsupported-input` and the element keeps its original audio

#### Scenario: No provider
- **WHEN** no `voice-design` route with speech-to-speech exists
- **THEN** "AI voices" shows "No provider is configured for voice-design" with "Configure", and the Effects presets remain selectable

### Requirement: Auto captions hand-off and shared transcript
The tool id `captions.auto` is an entry point that opens the auto-caption flow owned by `captions-subtitles.Auto captions on device` (and `captions-subtitles.Host-side transcription`) for the chosen source. The transcript is owned by `captions-subtitles.Source transcripts`: one transcript per audible source asset, keyed by content hash, with segments and words in SOURCE time; this capability SHALL consume that per-asset transcript in `dub`, `auto-cut`, `long-to-shorts` and `smart-search`, projecting words onto the timeline through each clip's trim and retime, and MUST NOT run a transcription of its own. A tool needing a transcript that does not exist requests it through the same flow, shows "Transcribing…" as its first stage, and reuses it afterwards. [NEW] [CAPCUT CC-193]

#### Scenario: Transcript reused
- **WHEN** auto captions were generated for a clip and the user then runs silence and filler removal on it
- **THEN** no second transcription runs and the tool starts at its detection stage

#### Scenario: Same asset in two clips
- **WHEN** one source asset is used by two clips and filler removal runs on both
- **THEN** the asset is transcribed once and both clips' cut lists are derived from that one transcript

#### Scenario: Offline transcription
- **WHEN** the device is offline and the speech model is present
- **THEN** a tool that needs a transcript obtains it on-device

### Requirement: Caption translation
The tool id `translate` is an entry point only: translation of captions, including target languages, bilingual output, re-wrapping, batching and the glossary of up to 200 term pairs per project, is defined by `captions-subtitles.Translate captions`, and this capability SHALL define none of it. The AI tab lists "Translate captions" when the project has a caption track; activating it opens that flow. Availability strings are those of "Offline and no-provider behaviour" for the `translation` role. [NEW] [CAPCUT CC-203]

#### Scenario: Entry point
- **WHEN** the user activates "Translate captions" in the AI tab of a project with captions
- **THEN** the translation flow of `captions-subtitles.Translate captions` opens for the caption tracks

#### Scenario: No caption track
- **WHEN** the project has no caption track
- **THEN** "Translate captions" is shown disabled with "This project has no captions"

### Requirement: Dubbing
`dub` SHALL produce a translated voice track for selected clips or the whole timeline, executed as a run of the built-in template `tpl.localise-dub` of `agent-workflows.Built-in templates` (the engine, approvals, retries and run view are that capability's; this requirement defines the behaviour of the steps): per-asset transcript → translation (`translation` role, with the approval the template defines) → speech per segment (`voice-tts` role, one voice per speaker, selectable; or a cloned voice per speaker through the `voice-design` role when the user enables "Keep original voices" and confirms "I have the right to clone these voices", which is stored with the run) → placement on a new audio track named "Dub (<language>)" with each segment starting at its source segment's start. Speakers come from the transcript's speaker labels when the routed transcription model declares diarisation; otherwise all segments belong to one speaker and the review list lets the user assign segments to up to 8 speakers by hand. A segment longer than its slot is sped up to at most 1.25×; if still too long it is listed as overflowing for the user to shorten the text or accept overlap. The original speech is handled per user choice: "Mute original", "Lower original to −18 dB", or "Keep music and effects", which replaces the original audio by the accompaniment stem of "Stem separation" and therefore requires `host-analysis`. Translated captions are optionally created through `captions-subtitles.Translate captions`. Optional "Lip sync" passes each affected video clip through the `lipsync` role. The complete result is one undo step and every segment stays an editable audio element. Roles follow design D12: `translation` and `voice-tts` are required, and a missing route for either is listed and blocks the start with the setup checklist; `voice-design` ("Keep original voices"), `lipsync` ("Lip sync") and the stem separation behind "Keep music and effects" are optional — when the user enabled one and its route (or `host-analysis`) is missing at run time, that step resolves to `skipped` with reason `no_route`, the run continues (catalogue voices instead of cloned voices; no lip sync; "Lower original to −18 dB" instead of the accompaniment stem), and the run summary lists what was skipped and how to add the provider. [NEW] [CAPCUT CC-203]

#### Scenario: Dub a two-speaker interview
- **WHEN** a clip whose transcript has two speaker labels is dubbed to Vietnamese with "Lower original to −18 dB"
- **THEN** a "Dub (vi)" audio track contains one audio element per segment using two distinct voices, and the original clip's volume is −18 dB

#### Scenario: No diarisation
- **WHEN** the routed transcription model does not declare diarisation
- **THEN** every segment is assigned to "Speaker 1" and the review list offers assignment to other speakers before speech is generated

#### Scenario: Overflowing segment
- **WHEN** a translated segment is 1.6× the length of its slot
- **THEN** it is listed as overflowing after the 1.25× speed-up and the user is asked to edit the text or accept overlap before the track is finalised

#### Scenario: Keep music without host analysis
- **WHEN** "Keep music and effects" is chosen on a host that does not advertise `host-analysis`
- **THEN** the option is disabled with "This host cannot run analysis"

#### Scenario: Missing role
- **WHEN** `translation` is configured but `voice-tts` is not
- **THEN** the Start button is disabled and the panel lists "voice-tts" as missing with "Configure"

#### Scenario: Optional role missing
- **WHEN** a dub is started with "Lip sync" enabled and the `lipsync` role has no route
- **THEN** the run completes with the dubbed audio track, the lip-sync step is `skipped` with reason `no_route`, and the summary names the `lipsync` role and links to its setup

### Requirement: Script to video
The tool id `script-to-video` is an entry point with no script model or pipeline of its own. Its panel in the AI tab SHALL offer: (1) "Write a script" — collects a topic (1–500 characters), target duration (15 s–10 min), tone, language and aspect ratio and opens a new script in `script-studio` with the screenwriter agent briefed with those values (`script-studio.Screenwriter agent and source material`); pasting an existing script (up to 20 000 characters) imports it through `script-studio.Import`; (2) "Draft timeline" on a chosen script — runs `script-studio.Draft timeline from a script`, which needs no host and fills shots with locally rendered `slate` stills; (3) "Generate video" on a chosen script — opens the run setup form of `agent-workflows.Run setup form` for the built-in template `tpl.one-prompt-video` with the script supplied as its script input, destination "New project" (default) or "Insert at playhead"; steps, approvals, cost and budgets are governed by `agent-workflows` and `prompt-to-video-workflow`. For a selected clip whose media kind is `slate`, the AI tools tab offers "Generate image" and "Generate video" pre-filled with the shot's visual description; applying a result replaces the slate with replace-media semantics and keeps the element's `scriptLink`. With no `screenwriter` route "Write a script" still opens the script for manual writing, and "Generate video" is enabled only when the template's required roles are configured. [NEW] [CAPCUT CC-232, CC-233]

#### Scenario: Start from a topic
- **WHEN** the user enters the topic "How bees make honey", 60 s, friendly tone, English, 9:16 and presses "Write a script"
- **THEN** a new script opens in the script editor and the screenwriter agent's brief contains those five values

#### Scenario: Draft timeline without a host
- **WHEN** "Draft timeline" is pressed for a script with 8 shots while no host is connected
- **THEN** the timeline receives 8 clips of media kind `slate`, each carrying a `scriptLink` to its shot

#### Scenario: Generate into a new project
- **WHEN** the user presses "Generate video" on an approved script with destination "New project"
- **THEN** the run setup form of `tpl.one-prompt-video` opens with the script pre-selected and, after the run succeeds, a new project exists whose elements carry a `workflowLink`

#### Scenario: Replace a slate
- **WHEN** an image is generated for a selected slate clip and applied
- **THEN** the clip shows the generated image with unchanged start, duration and `scriptLink`, in one undo step

### Requirement: Long video to shorts
`long-to-shorts` SHALL be the entry point and the step behaviour of the built-in template `tpl.long-to-shorts` of `agent-workflows.Built-in templates`; the engine, the human approval of candidates, retries and the run view are that capability's. Input: one video asset or clip between 2 minutes and 3 hours long. Behaviour of the steps: the per-asset transcript is obtained; the `editor` role (optionally with sampled frames through the `vision` role) selects highlights and returns 1–10 candidates (default 5) of a chosen length class (under 30 s, 30–60 s, 60–90 s, or custom 10–180 s), each with a title (1–80 characters), a one-sentence reason, a score 0–100 and start and end times snapped to sentence boundaries of the transcript and then to frames; candidates MUST NOT overlap, and a candidate outside the length class is discarded before presentation. Candidates are previewable and their in and out points adjustable in the approval step. "Create" turns each selected candidate into a new project (or a new scene in the current project) in 9:16 (or a chosen ratio) with `reframe` and auto captions applied in the transcript's language, as ordinary editable content. With no `editor` route the tool is disabled per "Offline and no-provider behaviour"; transcription itself can still run on-device. [NEW] [CAPCUT CC-237]

#### Scenario: Five highlights from a podcast
- **WHEN** a 45-minute podcast video is processed with the default settings and the 30–60 s class
- **THEN** at most 5 candidates are listed, each 30–60 s long, non-overlapping, with a title, reason and score, and each boundary coincides with a transcript sentence boundary within one frame

#### Scenario: Model returns an out-of-class candidate
- **WHEN** the model returns one candidate of 75 s for the 30–60 s class
- **THEN** that candidate is discarded and is not listed

#### Scenario: Create shorts
- **WHEN** the user selects 3 candidates and presses "Create" with "New project each"
- **THEN** 3 new 9:16 projects are created, each containing the trimmed clip with reframing keyframes and captions

#### Scenario: Source too short
- **WHEN** a 70 s clip is selected
- **THEN** the tool is disabled with "Select a video of at least 2 minutes"

### Requirement: Auto cut by silence, fillers and script
`auto-cut` SHALL be the single owner of silence, filler and script-match detection, their thresholds and the review list; `captions-subtitles.Transcript panel` and `timeline-editing.Transcript-driven cuts` invoke it with these defaults, and the cuts themselves are performed by the range-removal command of `timeline-editing.Transcript-driven cuts`. It offers three modes on selected clips or the main track. "Remove silences" (on-device, no model): a span is silent when the RMS level in consecutive 20 ms windows stays below the threshold (−60..−20 dBFS, default −40) for at least the minimum silence (0.2–5.0 s, default 0.5), and padding (0–1.0 s, default 0.1) is kept on each side. "Remove filler words" (on-device, using the per-asset transcript): detects words from the per-language lists enumerated in the section "Filler words" of `specs/ai-editing-tools/catalog.md` (en, vi, ja; user-editable per project) and immediate repetitions of the same word. "Match script" (host, `editor` role): aligns the transcript to a pasted script or a script of `script-studio` and keeps the last complete take of each line. Every mode shows a review list of proposed cuts with timecodes, durations, a play button and a checkbox per cut, plus the total time removed; "Apply" performs the checked cuts as ripple deletes across linked audio and video in one undo step, with a 2-frame audio crossfade at each cut when "Smooth cuts" is on (default on). With no `editor` route only "Match script" is disabled. [NEW] [CAPCUT CC-239] [PORT N-017]

#### Scenario: Remove silences
- **WHEN** fixture `speech-pauses-3/four-pauses`, a 60 s talking clip containing four pauses of 1.5 s, is processed with defaults and all cuts applied
- **THEN** the timeline is shortened by 5.2 s (4 × (1.5 − 0.2)) within one frame per cut, and one undo restores the original clip

#### Scenario: Detection accuracy
- **WHEN** the fixture set `speech-pauses-3` is processed with defaults
- **THEN** every proposed cut boundary is within 40 ms of the fixture's labelled boundary after padding

#### Scenario: Review and uncheck
- **WHEN** the user unchecks 1 of 4 proposed cuts and applies
- **THEN** only 3 cuts are made

#### Scenario: Nothing found
- **WHEN** no silence longer than the minimum is detected
- **THEN** the panel shows "No silences found with these settings" and Apply is disabled

#### Scenario: Filler list per language
- **WHEN** filler removal runs on a Vietnamese transcript
- **THEN** only the words of the `vi` list of the catalogue (plus project additions) and immediate word repetitions are proposed

### Requirement: Beat sync
`beat-sync` SHALL align the cut points of selected adjacent clips on a track to the beat markers of a selected music clip (the markers of `audio-editing.Beat markers on audio`, generated on-device by `audio-editing.Automatic beat detection` when absent). Options: cut every beat, every 2 beats, every 4 beats or every bar; start offset in beats; "Fit by trimming" (video clips are trimmed from their ends, images extended or shortened) or "Fit by speed" (constant speed between 0.5× and 2× per clip). The clip order is preserved, the result ends on a marker, and a clip whose source is too short for its slot is listed in a summary and left at its maximum length. The whole operation is one undo step and works offline. [NEW] [CAPCUT CC-239]

#### Scenario: Cut every 2 beats at 120 BPM
- **WHEN** 6 image clips are synced to a 120 BPM track with "every 2 beats"
- **THEN** each clip is 1.000 s long (snapped to frames) and every cut coincides with a beat marker within one frame

#### Scenario: Source too short
- **WHEN** a 0.4 s video clip must fill a 1.0 s slot with "Fit by trimming"
- **THEN** the clip stays 0.4 s, following clips close up to it, and the summary lists the clip

### Requirement: AI image generation
`generate.image` SHALL generate images through the `image` role from a prompt, with optional negative prompt, up to 4 reference images (image-to-image, with reference strength 0–100 where the model declares it), aspect ratio (1:1, 16:9, 9:16, 4:3, 3:4, 4:5 and the project ratio), count 1–4, seed (random by default, lockable) and the styles and sizes the routed model's catalogue entry declares. "Sticker" mode additionally runs `cutout.image` on each result and saves transparent PNGs. Results appear as a grid in the panel as they complete, are saved to the "AI generated" folder, and can be dragged to the timeline or added at the playhead with the default image duration; "Use current frame as reference" captures the preview frame as a reference image. With no `image` route the tool is disabled per "Offline and no-provider behaviour". [NEW] [CAPCUT CC-235] [PORT N-017]

#### Scenario: Generate four images
- **WHEN** the user submits a prompt with count 4 and aspect 9:16
- **THEN** 4 image assets with a 9:16 aspect ratio are added to "AI generated" with provenance metadata

#### Scenario: Sticker mode
- **WHEN** Sticker mode is on
- **THEN** each result is a PNG with a transparent background and is offered under the user's stickers

#### Scenario: Partial failure
- **WHEN** 1 of 4 images is rejected by the provider
- **THEN** 3 assets are added, the fourth tile shows the rejection reason with "Retry", and cost is recorded for the 3 delivered images as reported by the provider

### Requirement: AI expand
`expand.image` SHALL outpaint an image element, or the current frame of a video element exported as a still, to a larger canvas or a different aspect ratio through the `image` role route `expand` (models declaring outpainting): the user chooses a target ratio or drags the frame edges (expansion up to 2× per side), optionally adds a prompt, and receives 1–4 variants. Applying a variant switches the element to the new asset with the replace-media semantics of `timeline-editing.Replace media` such that the original content stays at the same canvas position and size within 1 px. With no outpainting-capable route the tool is disabled with "The configured image model does not support expand". [NEW] [CAPCUT CC-241]

#### Scenario: Expand a 1:1 photo to 16:9
- **WHEN** a 1:1 photo is expanded to 16:9 and a variant is applied
- **THEN** the element fills the 16:9 canvas and the original photo's pixels occupy the same canvas rectangle as before within 1 px

#### Scenario: Model without outpainting
- **WHEN** the routed image model does not declare outpainting
- **THEN** the tool's action is disabled with the stated message

### Requirement: AI video generation
`generate.video` SHALL generate video through the `video` role in four modes, each resolved through the task route of the same name in `orc-model-routing.Routes with primary and ordered fallbacks` and offered only when the routed model lists it in `modes[]` of `generation-providers.Capability metadata`: text-to-video (prompt; task route `text`), image-to-video (one start image plus prompt; task route `image`), first–last frame (start image and end image plus prompt; task route `first_last_frame`) and reference (prompt plus 1 to `maxReferenceImages` reference images of a character, location or prop; task route `reference`). Parameters come from the model's catalogue entry: duration options, resolution, aspect ratio, frame rate, audio generation on or off, seed, and count 1–4. Start and end images are chosen from the media library, uploaded, or captured with "Use current frame" / "Use last frame of selected clip". Jobs run in the server queue with stage and elapsed time; results are saved to "AI generated" with provenance and can be inserted at the playhead or dragged to the timeline. "Extend from here" on a result pre-fills image-to-video with that clip's last frame. With no `video` route the tool is disabled per "Offline and no-provider behaviour"; a mode the model lacks is hidden and listed under "Not supported by <model>". [NEW] [CAPCUT CC-234] [PORT N-017]

#### Scenario: Image to video from the current frame
- **WHEN** the user chooses image-to-video, presses "Use current frame", enters a prompt, picks 5 s and submits
- **THEN** a host job is created with that frame as the start image and, on success, a video asset of the model's delivered duration is added and insertable at the playhead

#### Scenario: First and last frame
- **WHEN** the routed model declares first–last frame support and both images are supplied
- **THEN** the provider request carries the start image in its first-frame field and the end image in its last-frame field, and both source asset ids are recorded in the result's provenance

#### Scenario: Mode not supported
- **WHEN** the routed model declares only text-to-video
- **THEN** the image-to-video and first–last frame tabs are hidden and listed under "Not supported by <model>"

### Requirement: AI music and sound effect generation
`generate.music` SHALL generate music through the `music` role from a prompt with duration 5–300 s (limited to the model's declared range), an "Instrumental" toggle, optional lyrics, and count 1–2; "Match selection length" sets the duration to the in/out range or the timeline duration. `generate.sfx` SHALL generate sound effects through the `sfx` role from a prompt with duration 0.5–30 s and count 1–4. Results are audio assets with provenance, previewable in the panel, insertable at the playhead on an audio track, and carry a "Generated" badge in the audio library. Each tool is disabled independently per "Offline and no-provider behaviour" when its role has no route. [NEW] [PORT N-017]

#### Scenario: Music to fit the timeline
- **WHEN** "Match selection length" is on for a 42 s timeline and the model supports 5–120 s
- **THEN** the requested duration is 42 s and the inserted clip is trimmed to exactly the timeline duration with a 1 s fade-out when the delivered audio is longer

#### Scenario: Sound effect variants
- **WHEN** a sound effect is requested with count 3
- **THEN** 3 audio assets are listed, each with a preview button

#### Scenario: Only music configured
- **WHEN** `music` has a route and `sfx` does not
- **THEN** music generation is enabled and sound effect generation shows "No provider is configured for sfx"

### Requirement: Object and text removal
`remove.object` SHALL erase an unwanted region from an image element (through the `image` role route `inpaint`) or a video clip (through the `video` role route `inpaint`): the user paints a mask with a brush (size 4–400 px, with eraser, undo and invert) or picks "Select object" (on-device segmentation from a click point with the manifest model `seg-click`); for video the mask is propagated across the clip on-device with the motion tracker and shown for review as an overlay that can be corrected on any frame before submission. "Detect text" pre-fills the mask with on-screen text regions found on-device with the manifest model `text-detect`, so that burned-in text can be removed; this is the behaviour behind the entry points of `masks-blending-keying.AI removal entry points`. The mask is dilated by 8 px before upload. The result is a new asset applied with the replace-media semantics of `timeline-editing.Replace media` for the trimmed range plus 1 s handles, with "Revert to original"; before applying, the tool composites the provider result over the source so that pixels farther than 16 px outside the mask are taken from the source unchanged. With no route whose model declares inpainting for the element type, the action is disabled per "Offline and no-provider behaviour". [NEW] [CAPCUT CC-159, CC-160]

#### Scenario: Remove an object from a photo
- **WHEN** the user masks a signpost in a photo and submits
- **THEN** a new image asset is applied to the element in which the masked region is filled
- **AND** every pixel farther than 16 px outside the mask equals the source pixel within 2 per channel

#### Scenario: Review the tracked mask on video
- **WHEN** a mask is propagated across a 6 s clip
- **THEN** scrubbing shows the mask overlay on every frame and the user can repaint it on any frame before the job is created

#### Scenario: Detect text
- **WHEN** "Detect text" is pressed on a frame with a burned-in subtitle line
- **THEN** the mask is pre-filled with a region covering the subtitle line and no provider call has been made yet

#### Scenario: Empty mask
- **WHEN** no pixel is masked
- **THEN** the primary action is disabled with "Paint over what you want to remove"

### Requirement: Avatar and lip-sync
`avatar` SHALL create a talking-presenter video from a portrait image (uploaded or generated) and speech (typed script synthesised through `voice-tts`, or an existing audio element) through the `lipsync` role route `avatar` (models declaring image input), producing a video asset whose duration equals the speech duration within one frame, inserted with its audio at the playhead; the avatar can be given a transparent background by `cutout.video`. `lipsync` SHALL re-time the mouth movements of an existing video clip to a chosen audio element through the `lipsync` role (models declaring video input), replacing the clip's media for the affected range with "Revert to original", and linking the clip to that audio; this is the behaviour behind `audio-editing.AI lip sync entry point`. Both require a detectable face in the input, checked on-device with the manifest model `face-mesh`; otherwise the job fails with `ai/no-subject-found` before any provider call. With no usable `lipsync` route both tools are disabled per "Offline and no-provider behaviour", and with no `voice-tts` route the avatar tool accepts only existing audio. [NEW] [CAPCUT CC-236, CC-225]

#### Scenario: Avatar from a portrait and a script
- **WHEN** a portrait and a 15 s script are submitted with a selected voice
- **THEN** speech is synthesised, a lip-synced video of the same duration (±1 frame) is generated, and both are inserted at the playhead in one undo step

#### Scenario: Lip-sync an existing clip
- **WHEN** a 10 s talking clip is lip-synced to a dubbed audio element of 10 s
- **THEN** the clip uses the new lip-synced asset for that range and "Revert to original" restores the source

#### Scenario: No face
- **WHEN** the supplied image contains no detectable face
- **THEN** the job fails with `ai/no-subject-found` and no provider request is made

### Requirement: Dialogue scene
`dialogue-scene` SHALL build a multi-character conversation from 2–4 character portraits, each assigned a name and a voice, and a script whose lines are tagged with a character name (up to 60 lines, each up to 500 characters). For every line it synthesises speech (`voice-tts`) and a lip-synced clip of the speaking character (`lipsync` role route `avatar`), then assembles the clips in script order on the main track with their audio and optional captions, as ordinary editable elements, in one undo step. A total cost estimate over all lines is shown before start, lines are generated as independent jobs so a failed line can be retried alone, and assembly waits until every line has succeeded or been skipped by the user. Multi-episode productions with consistent characters are the domain of `film-production.Studio navigation and stage tabs`, to which the panel links. [NEW] [CAPCUT CC-243]

#### Scenario: Two characters, six lines
- **WHEN** a script with 6 lines alternating between two characters is generated
- **THEN** 6 video clips are placed in order on the main track, each showing the speaking character, with a combined duration equal to the sum of the speech durations

#### Scenario: One line fails
- **WHEN** line 4 fails with `PROVIDER_ERROR` whose `details.class` is `timeout` after the retries of `generation-providers.Retry policy`
- **THEN** the other lines are kept, line 4 shows "Retry" and "Skip", and nothing is placed on the timeline until the user resolves it

### Requirement: Smart search of media
`smart-search` SHALL index project media on-device so that the media library search (owned by `media-library.Library search and filters`) can find moments by meaning: spoken words (from the per-asset transcript), visual content (an image–text embedding from the manifest model `embed-clip` of one frame every 2 s of video and of each image), and — only when the user has turned it on — people. **People search is opt-in (privacy).** The switch is "Group people in smart search": per device library on Personal ▸ Privacy, and for analysis run on a host the server key `library.peopleGrouping` on Host ▸ General (`settings-preferences.Host general settings`, `security-privacy.Biometric grouping is opt-in`), both default off. Face identity embeddings are biometric-style data, so people search is OFF by default for every project library and nothing computes or stores a face embedding or a face cluster while it is off. Turning on "Find people in this project" (media library search settings; a per-project, per-device setting kept in device preferences, never in the project document) shows a consent dialog: "Faces in this project's media will be grouped on this device so you can search by person. The groups stay on this device." with "Turn on" and "Cancel". While it is on, the manifest model `face-embed` clusters faces per project; clusters are labelled by the user and unlabelled ones appear as "Person 1", "Person 2". Face embeddings, clusters and their labels are device-local: they are never synchronised to other devices, never written into the project document, a project package, a template, a hand-off bundle or diagnostics, and never sent to a provider. They are computed on a host only after a separate confirmation per host ("Also group faces on the host <name>?"), in which case they stay on that host under the same rules. Turning the setting off deletes the embeddings, clusters and labels of that project on the device (and, when confirmed for a host, on that host) at once. The face mesh used by retouch is not an identity embedding and is not governed by this switch. **Indexing.** Indexing runs as a low-priority background job after import with a per-asset state (Not indexed, Indexing %, Indexed), can be paused, and is restricted to "While charging" on mobile by default. Where the embedding model fails admission on a device (iOS and Android; `embed-clip` peaks at 900 MiB), visual indexing runs as "Run on host" when `host-analysis` is available, and each text query is then embedded on the same host through `jagentchill.ai.analysis.create` with `tool: "smart-search"` and `params {query}` (the job result is the query vector; hits are ranked on the device from the synced index within 1.5 s of the query); otherwise the panel states "Visual search needs a host on this device" while speech and name search keep working. A query returns ranked hits within 300 ms for a project of 500 indexed assets on the reference desktop, each hit showing asset, time range, match type (speech, visual, person) and a thumbnail; activating a hit previews from that time, and dragging it to the timeline inserts that range (default 5 s around a visual hit, the sentence for a speech hit). Retrieval quality MUST meet the smart-search threshold of "AI acceptance fixtures". Speech and visual indexes stay on the device (or on the user's own host when indexed there), are never sent to a provider, and are deletable per project. [NEW] [CAPCUT CC-024]

#### Scenario: Find a spoken phrase
- **WHEN** the user searches "quarterly budget" in a project with an indexed interview
- **THEN** hits list each sentence containing the phrase with its time range, and activating one starts preview at that sentence

#### Scenario: Find by visual description
- **WHEN** the 30 labelled queries of fixture set `search-30` are run against its 60 indexed assets
- **THEN** for at least 21 queries a labelled relevant asset is among the first 5 visual hits

#### Scenario: Not yet indexed
- **WHEN** a newly imported asset is still indexing
- **THEN** it is shown with "Indexing 40 %" and its transcript and visual hits are absent until indexing completes, while name search already matches it

#### Scenario: Phone without a host
- **WHEN** smart search is opened on a phone with no host connected
- **THEN** the panel states "Visual search needs a host on this device" and a spoken-phrase query still returns hits

#### Scenario: People search is off by default
- **WHEN** media with faces is imported into a new project and indexing completes
- **THEN** no face embedding or cluster exists on the device, the search offers no person filter, and the settings show "Find people in this project" off

#### Scenario: Opt in
- **WHEN** the user turns "Find people in this project" on and confirms the dialog
- **THEN** faces are clustered on the device and a person filter appears; another paired device with the same project shows no clusters

#### Scenario: Opt out deletes
- **WHEN** the user turns the setting off
- **THEN** the project's face embeddings, clusters and labels are deleted from the device and person hits disappear

#### Scenario: Not exported
- **WHEN** a project with people search on is exported as a project package
- **THEN** the package contains no face embedding, cluster or label

#### Scenario: Phone with a host
- **WHEN** a visual query is typed on an iOS or Android phone whose project was indexed on the host
- **THEN** the query is embedded by the host through `jagentchill.ai.analysis.create` and ranked hits are shown within 1.5 s

### Requirement: AI tools on mobile
On phones and tablets the AI tools SHALL be entered through the structure owned by `mobile-editor`: clip-level tools are items of the selected clip's strip in the order and with the labels of `mobile-editor.Video clip tool strip` and `mobile-editor.Audio group and audio clip strips`, and project-level tools and generators are in the sheet opened by the "AI tools" item of `mobile-editor.Root toolbar`; this capability defines no mobile list of its own. Each tool opens as a titled bottom sheet under the rules of `mobile-editor.Tool sheets never cover the preview`. Sheets of tools that need touches on the preview — painting removal masks, drawing a tracking region, placing the relight handle, clicking a face — are canvas-interactive: preview touches go to the tool and do not close the sheet, and a magnifier loupe of 2× is shown above the finger. While an on-device job runs, a progress strip with percentage and a cancel button is overlaid at the bottom of the preview and the sheet can be closed without cancelling. Touch targets are at least 44×44 pt. On-device analysis enters `paused` when the app is backgrounded and resumes on return from the last completed source frame. [NEW]

#### Scenario: Tool sheet keeps the preview visible
- **WHEN** Retouch is opened on a phone
- **THEN** a bottom sheet with the sliders is shown and the full preview remains visible above it

#### Scenario: Painting on the preview does not close the sheet
- **WHEN** the Remove object sheet is open and the user drags a finger across the preview
- **THEN** a mask stroke is painted with the loupe shown, and the sheet stays open

#### Scenario: App backgrounded during analysis
- **WHEN** the user leaves the app during on-device stabilisation analysis and returns after 1 minute
- **THEN** the job shows `paused` in the background and continues from the last completed source frame on return

### Requirement: Agent access to AI tools
Every AI tool SHALL be invocable by an agent through the single tool `jc_ai_run`, which is defined by `agent-editing-tools.AI editing tool` — its parameters, where a call executes (host, host analysis, or dispatch to the device holding the edit lease or focused on the session) and the failures `DEVICE_REQUIRED` and `TIMEOUT` are owned there. This capability provides what that tool consumes: the tool table from which its `tool` enum is generated, and, per tool id, the parameter schema, result type, costs and the failure codes of "Failure handling and route fallback". Agent-initiated runs MUST use the same job, consent, cost, budget, cache and undo rules as user-initiated runs: provider jobs follow the approval thresholds of `generation-providers.Approval thresholds and spending caps` and the budgets of `generation-providers.Budgets with hard stop`, with the approval card shown in the chat timeline (tool, target, route, estimate); results are applied through the agent's change proposal so the user can accept or reject them, and are undoable; on-device and host jobs need no cost approval and appear in the AI jobs list labelled with the session. `jc_ai_run` is a tool of the server's agent tool endpoint (`server-api.Agent tool endpoint and session binding`) and is therefore available to creative agents and workspace agents alike. [NEW]

#### Scenario: Agent requests a paid generation
- **WHEN** the agent calls `jc_ai_run` with tool `generate.video` and an estimated cost above the approval threshold
- **THEN** an approval card with the estimate appears in the chat and no provider call is made until the user approves

#### Scenario: Agent result becomes a proposal
- **WHEN** the agent calls `jc_ai_run` with tool `auto-cut` and the detection completes
- **THEN** the proposed cuts are presented as a change proposal whose acceptance creates one undo step

#### Scenario: Every tool id has a parameter schema
- **WHEN** the contract test calls `jc_ai_run` with `dryRun: true` for each id of the tool table
- **THEN** each call is validated against that tool's parameter schema and none is rejected for an unknown tool id

### Requirement: AI RPC surface
The `ai` domain of `server-api.RPC domain ownership` SHALL consist of exactly these two channel P methods, through which a device starts the server jobs of this capability; the domain has no event and no subscribe method, because progress, cancellation, retry and listing use `jagentchill.job.*` and `jagentchill.job.updated` (`server-api.Job RPCs and events`):

| Method | Parameters → result | Scope | Creates |
|---|---|---|---|
| `jagentchill.ai.analysis.create` | `{tool, projectId, target: {elementId} \| {assetId}, range?: {startTicks, endTicks}, params, idempotencyKey}` → `{jobId}`; `tool` is a class (1) or class (2) tool id of `ai-editing-tools.Execution location per tool` | `jagentchill.projects.write` | one job of kind `ai.analysis` on the host, run against the synced original |
| `jagentchill.ai.generation.create` | `{tool, projectId, target?: {elementId} \| {assetId}, range?, params, route?: <task-route id>, count? (1–4), idempotencyKey}` → `{jobIds[], batchId?, route {provider, model}, estimateUsd}`; `tool` is a class (3) tool id | `jagentchill.generation.run` | one job of kind `generation.<type>` per requested output, sharing a `batchId` when there are several |

`jagentchill.ai.analysis.create` answers `ai/host-analysis-unavailable` when the server does not advertise the feature flag `host-analysis`, `PROJECT_NOT_SYNCED` when the project or the target's original is not on the host, and `ai/unsupported-input` when the target violates `ai-editing-tools.Input limits and validation`. `jagentchill.ai.generation.create` resolves the route with `orc-model-routing.Route resolution and fallback` (answering `ai/no-route` or `ai/no-key`), applies the consent rule of `ai-editing-tools.Consent for sending media to a provider` (`PERMISSION_DENIED` when consent for the resolved provider is missing), the estimate and approval thresholds of `generation-providers.Approval thresholds and spending caps` and the budgets of `generation-providers.Budgets with hard stop` (`BUDGET_EXCEEDED`) before any job is created, and never uploads media itself: the client uploads the trimmed input as a blob first and passes its `assetId`. Both methods are idempotent per `server-api.Idempotency of side-effecting RPCs`. On-device tool runs use no RPC. An agent starts the same jobs through its tools (`ai-editing-tools.Agent access to AI tools`), never through these methods. A handler under `jagentchill.ai.` other than these two MUST fail the contract test `rpc-ownership`. [NEW]

#### Scenario: Run on host
- **WHEN** an `editor` phone chooses "Run on host" for Stabilise on a synced clip of a host that advertises `host-analysis`
- **THEN** the client calls `jagentchill.ai.analysis.create` with `tool: "stabilise"` and receives a `jobId` whose job has kind `ai.analysis` and state `queued`

#### Scenario: Host analysis not advertised
- **WHEN** the same call reaches a host without the feature flag `host-analysis`
- **THEN** the response error code is `ai/host-analysis-unavailable` and no job is created

#### Scenario: Provider job from a panel
- **WHEN** an `editor` device submits the Generate image panel with `count: 4`
- **THEN** `jagentchill.ai.generation.create` returns four `jobIds` of kind `generation.image` sharing one `batchId`

#### Scenario: Viewer device
- **WHEN** a `viewer` device calls `jagentchill.ai.generation.create`
- **THEN** the response error code is `SCOPE_DENIED` with `details.requiredScope` `jagentchill.generation.run`

#### Scenario: Unlisted method
- **WHEN** server code adds a handler `jagentchill.ai.model.install`
- **THEN** the contract test `rpc-ownership` fails and names the method

### Requirement: AI error codes
The `ai/<kebab>` family of `server-api.RPC error envelope` SHALL be exactly the twelve codes of this table, defined here and nowhere else; every job failure, RPC error and tool result of this capability that is not a provider failure uses one of them or a general code of that registry. A provider failure is reported as `PROVIDER_ERROR` with the class of `generation-providers.Error and content-safety mapping` and is never re-coded into an `ai/` code.

| Code | Condition | Retryable | Raised by |
|---|---|---|---|
| `ai/no-gateway` | a provider or host tool was started with no connected host | no | client |
| `ai/no-route` | no route is configured for the tool's role and task route, or no route's model declares the needed capability flag | no | Host |
| `ai/no-key` | the resolved route's provider has no valid connection | no | Host |
| `ai/host-analysis-unavailable` | a host tool was requested and the server does not advertise `host-analysis` | no | Host |
| `ai/model-not-downloaded` | an on-device model is absent and cannot be downloaded now | yes | client |
| `ai/model-out-of-memory` | an on-device or host-local model exhausted memory while running | no | client, host |
| `ai/model-verification-failed` | a downloaded model's SHA-256 differs from the manifest | yes | client, host |
| `ai/unsupported-input` | the input violates a limit or cannot be processed by the tool (the message names the reason) | no | client, host |
| `ai/no-subject-found` | the tool found no subject, face or matte to work on | no | client |
| `ai/upload-failed` | uploading the input to the server failed | yes | client |
| `ai/download-failed` | fetching the result from the server or the provider's result location failed | yes | client, host |
| `ai/cancelled` | the user cancelled an on-device job (a cancelled host job has state `cancelled` and no code) | no | client |

Each code has a localisation key and the localised message shown beside "Retry" (`ai-editing-tools.Failure handling and route fallback`). The contract test `error-registry` MUST fail when code of this capability emits an `ai/` code that is not a row of this table. [NEW]

#### Scenario: Closed family
- **WHEN** the contract test `error-registry` collects the `ai/` codes emitted by the client and the server
- **THEN** the set is a subset of the twelve codes of this table

#### Scenario: Provider timeout is not an ai code
- **WHEN** a provider call of a text-to-speech job times out on every route
- **THEN** the job fails with `PROVIDER_ERROR` and `details.class` `timeout`, and no code beginning with `ai/` is recorded

#### Scenario: Unregistered code
- **WHEN** a tool panel reports a failure with code `ai/provider-timeout`
- **THEN** the contract test fails and names the code
