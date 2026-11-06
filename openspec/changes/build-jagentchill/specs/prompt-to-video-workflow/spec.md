## ADDED Requirements

### Requirement: Workflow run entry points and Gateway dependency
"One prompt → video" SHALL be the built-in template `tpl.one-prompt-video` of `agent-workflows.Built-in templates`: a workflow document executed by the engine of `agent-workflows`, with no engine, scheduler, state machine, retry policy, cache, budget ledger, event or RPC of its own (`agent-workflows.Contract for template capabilities`). This capability defines only the template's parameters, node graph, artifact contracts, acceptance rules, checkpoints and domain screens. A run of the template is started from the entry points of `agent-workflows.Entry points`: the home composer with target `video` (`app-shell-navigation.Home composer`), "Use template" on the Workflows screen, the editor command "Generate video from prompt", "Send to workflow…" on an approved script, the "Run workflow" instruction of `automations.Run-workflow instruction`, and the agent tools `jc_workflow_start`, `jc_workflow_status`, `jc_workflow_step` and `jc_workflow_cancel` of `agent-workflows.Workflow run tools` (this capability registers no tool with those names). Every interactive entry point creates a run in status `draft` and opens `agent-workflows.Run setup form` pre-filled with the context it has (prompt text, bound project, script); no job is created and nothing is billed before the estimate is confirmed. Above the estimate the setup form of this template shows a collapsed section "Pipeline" holding the template's graph on the canvas of `workflow-diagram` in read-only `view` mode, so the diagram of the run is visible before it starts; expanding it never creates a job. Runs, artifacts and candidates exist only on the host (`agent-workflows.Storage, RPC surface and Gateway dependency`); a client without a connected host shows the form with "Estimate and run" disabled, the notice "Connect to a host to generate videos" and a "Connect" action that opens pairing (`device-pairing-signing.Pairing flow on the new device`), and keeps the entered values as a local draft for 30 days. All traffic of a run — including the sessions of its agent nodes and the resolution of its approvals — travels on the single client channel of design decision D7 through JAgentChill Server, which checks the device role and the scopes below; a device holds no scope other than `jagentchill.*`. Starting, re-running and approving need scope `jagentchill.generation.run`, the export node additionally `jagentchill.export.run`, and reading a run `jagentchill.projects.read` (`agent-workflows.Roles, permissions and agent classes`); `viewer` devices watch runs without controls. The behaviour of this requirement is identical on web, on desktop (macOS, Windows and Linux) and on mobile (iOS and Android). [NEW] [CAPCUT CC-232, CC-233] [PORT N-017]

#### Scenario: Start from the home composer
- **WHEN** a connected `editor` device selects target `video` in the home composer, types a prompt of 20 characters and presses Send
- **THEN** a run of `tpl.one-prompt-video` is created in status `draft` and the run setup form opens with `prompt` pre-filled and every other parameter at its default
- **AND** no generation job exists until the user confirms the estimate

#### Scenario: Diagram before the run starts
- **WHEN** the user expands "Pipeline" in the setup form of a `draft` run
- **THEN** the template's graph is drawn read-only with every node in its neutral state, and no job is created

#### Scenario: Host not connected
- **WHEN** the client has no connected host and the user opens the run setup form
- **THEN** "Estimate and run" is disabled and the notice "Connect to a host to generate videos" is shown with a "Connect" action
- **AND** the entered prompt and settings are kept as a local draft for 30 days

#### Scenario: Started by the chat agent
- **WHEN** an agent in `edit` mode calls `jc_workflow_start {templateId: "tpl.one-prompt-video", prompt}`
- **THEN** the approval card of `agent-editing-tools.Cost guard` shows the estimate range before any billable node runs
- **AND** the run is listed in run history with origin `agent` and a link to the chat session

#### Scenario: Viewer device
- **WHEN** a `viewer` device opens a running run of the template
- **THEN** node states update live and no start, approve, re-run or cancel control is rendered

### Requirement: Run input contract
The template SHALL declare exactly these parameters (`agent-workflows.Parameters`), all exposed in the run setup form:

| Parameter | Type and range | Default |
|---|---|---|
| `prompt` | text, 0–4,000 characters after trimming | empty |
| `script` | `ScriptRef` of `script-studio` (an approved or draft version) | unset |
| `styleRefs` | list of `ImageRef`, 0–10: pictures that show the wanted look | none |
| `subjectRefs` | list of `ImageRef`, 0–10: pictures of a person, product or place that recurs | none |
| `footageRefs` | list of `MediaRef` (video or image), 0–10: the user's own material to cut in | none |
| `voiceSample` | list of `AudioRef`, 0–1: a recording to clone the narration voice from | none |
| `sourceTexts` | list of `FileRef` (text), 0–4: notes, an article or a finished script | none |
| `targetDuration_s` | integer 5–600 | 30 |
| `aspectRatio` | `16:9`, `9:16`, `1:1`, `4:5`, `4:3`, `3:4`, `21:9` | `9:16` |
| `resolution` | short edge `720p`, `1080p`, `2160p` (21:9 at 1080p is 2520 × 1080) | `1080p` |
| `frameRate` | 24, 25, 30, 60 | 30 |
| `language` | BCP-47 tag | app locale |
| `secondCaptionLanguage` | BCP-47 tag different from `language` | unset |
| `style` | `auto`, a style preset id of "Style presets and parameter presets", or custom text of 1–500 characters | `auto` |
| `voice` | `none`, `auto`, or a voice id of `generation-providers.Voice catalogue` | `auto` |
| `voiceConsent` | boolean; "I have the right to use this voice" | false |
| `musicMood` | `none`, `auto`, `calm`, `upbeat`, `dramatic`, `corporate`, `playful`, `dark`, `epic`, `romantic` | `auto` |
| `soundEffects` | boolean | true |
| `captions` | boolean | true |
| `visualSource` | `generate`, `stock`, `library`, `mixed` | `mixed` |
| `candidatesPerShot` | integer 1–4 | 1 |
| `allowMethodFallback` | boolean | true |
| `exportOnCompletion` | boolean | true |
| `exportPreset` | an export preset id of `export-share.Built-in export presets` | `match-project` |

The five reference lists together hold at most 10 files. The accepted file types and the size limit of each media file are those of `media-library.Type detection and supported formats` and `media-library.Import pipeline`, and those of each text file are the ones of `script-studio.Import`; this capability states no file size of its own and the form shows the limit it reads from those owners. `voice: "auto"` means "narrate when a voice is available": it resolves, when the form opens, to the first voice of `generation-providers.Voice catalogue` for the run language on a configured `voice-tts` route, and to `none` with the notice "No voice available for <language> — the video will have no narration" when there is no such route or voice; an explicit voice id is a request for narration and makes `voice-tts` a required role ("ORC role assignment per step"). Template rules checked by the form with a field-level message and by the host with `WORKFLOW_INPUT_INVALID` naming the parameter: at least one of `prompt` and `script` is set ("Write a prompt or choose a script"); the reference lists hold at most 10 files in total; `voiceSample` is set only with `voiceConsent` true ("Confirm you have the right to use this voice"); with `visualSource: "library"` the bound project's media library or `footageRefs` holds at least one video or image ("Add media to your library or change Visual source"). When `exportOnCompletion` is true and the host does not advertise the feature flag `remote-export`, the form shows "This host cannot export — the run will stop after review" and sets `exportOnCompletion` to false. [NEW] [CAPCUT CC-233]

#### Scenario: Minimal input
- **WHEN** the user supplies only a prompt of 1 character
- **THEN** the run is accepted with 30 s, 9:16, 1080p, 30 fps, app locale, style `auto`, voice `auto`, music `auto`, sound effects on, captions on, visual source `mixed`, 1 candidate per shot

#### Scenario: Prompt too long
- **WHEN** the prompt has 4,001 characters
- **THEN** the form shows "Prompt must be 4,000 characters or fewer" under the field and the primary button stays disabled

#### Scenario: Neither prompt nor script
- **WHEN** `prompt` is empty and `script` is unset
- **THEN** the form shows "Write a prompt or choose a script" and a start through `jc_workflow_start` fails with `WORKFLOW_INPUT_INVALID` naming `prompt`

#### Scenario: Too many references
- **WHEN** the lists already hold 10 files in total and the user attaches one more to `styleRefs`
- **THEN** the file is not added and a toast states "Up to 10 reference files"

#### Scenario: Unsupported reference type
- **WHEN** the user attaches a `.doc` file to `sourceTexts`
- **THEN** the file is rejected with the message `script-studio.Import` defines for that type

#### Scenario: Script instead of a prompt
- **WHEN** the run is started from "Send to workflow…" on an approved script and `prompt` is empty
- **THEN** the run is accepted, `script` holds that script's approved version, and `script_draft` is `skipped`

#### Scenario: Automatic voice with no voice model
- **WHEN** the form opens with `voice: "auto"` on a host where role `voice-tts` has no route
- **THEN** the voice field shows "None" with the notice "No voice available for <language> — the video will have no narration" and the start is not blocked

#### Scenario: Host cannot export
- **WHEN** the host does not advertise `remote-export` and the form opens
- **THEN** the form shows "This host cannot export — the run will stop after review" and `exportOnCompletion` is false and read-only

### Requirement: Style presets and parameter presets
The template SHALL ship exactly these style presets, authored by the project, each a descriptor text that is passed to the `brief` node as the requested look when `style` holds its id:

| id | Label | Descriptor |
|---|---|---|
| `cinematic` | Cinematic | Natural light, shallow depth of field, restrained colour with warm highlights and cool shadows, slow deliberate camera moves, wide establishing frames followed by close details. |
| `clean-product` | Clean product | Seamless light backdrop, soft even lighting, crisp edges, slow rotations and push-ins on the product, generous empty space for on-screen text. |
| `documentary` | Documentary | Hand-held observational framing, available light, muted natural colour, real locations, cutaways to hands and details. |
| `bold-social` | Bold social | High contrast, saturated accent colour, fast cuts every 1–2 s, large centred on-screen text, vertical framing with the subject in the upper two thirds. |
| `flat-illustration` | Flat illustration | Two-dimensional vector look, flat fills, limited palette of four colours, simple geometric characters, smooth eased motion. |
| `hand-drawn` | Hand-drawn | Pencil and ink line work on paper texture, loose cross-hatching, slight line wobble between frames, sparse colour washes. |
| `3d-render` | 3D render | Soft global illumination, rounded stylised forms, clean materials, gentle orbiting camera, shallow depth of field. |
| `retro-film` | Retro film | Warm faded colour, visible grain, soft halation around highlights, 4:3-style centred compositions, slow zooms. |
| `noir` | Noir | Black and white, hard side light, deep shadows, wet reflective surfaces, static low-angle frames. |
| `minimal-type` | Minimal type | Solid colour backgrounds, large typography as the main visual, one accent colour, text reveals in time with narration. |

`style: "auto"` lets the `brief` node choose one preset id or write its own look from the prompt and the `style` references. The template SHALL also ship exactly four parameter presets (`agent-workflows.Template parameters and save-as-template`), selectable at the top of the run setup form; a preset sets only the listed parameters and leaves the others at their defaults:

| Preset | `targetDuration_s` | `aspectRatio` | `style` | `voice` | `musicMood` | `visualSource` | `candidatesPerShot` |
|---|---|---|---|---|---|---|---|
| Short social video | 20 | `9:16` | `bold-social` | `auto` | `upbeat` | `mixed` | 1 |
| Product advertisement | 30 | `1:1` | `clean-product` | `auto` | `corporate` | `generate` | 2 |
| Explainer | 90 | `16:9` | `flat-illustration` | `auto` | `calm` | `mixed` | 1 |
| Story | 60 | `16:9` | `cinematic` | `auto` | `dramatic` | `generate` | 2 |

Preset and style labels and descriptors are locale resources (en, vi, ja); descriptors are sent to models in English. [NEW] [CAPCUT CC-233]

#### Scenario: Preset fills the form
- **WHEN** the user picks "Product advertisement" in the run setup form
- **THEN** duration is 30, aspect ratio `1:1`, style `clean-product`, music mood `corporate`, visual source `generate`, candidates per shot 2, and every other parameter keeps its default

#### Scenario: Style list is complete offline
- **WHEN** the style select is opened
- **THEN** it lists "Auto", the ten presets above in table order and "Custom…"

### Requirement: Typed step graph of the default workflow
The template document SHALL contain exactly the nodes of the table below — this table is the single node inventory of the template; `agent-workflows.Built-in templates` cites it and lists no node id of its own. "Step" in this capability means the node, or the closed body of nodes, named in the first column. Every type is a node type of `agent-workflows`; a `parallel` node and its `join` are two nodes; nodes of a body are indented under the node that owns the body.

| Node id | Type | Consumes (data edges; `→` names the `select` projection of the input port) | Produces |
|---|---|---|---|
| `start` | `trigger` | — | parameters |
| `options` | `branch` (`all_matches`) | parameters | control outputs `draft`, `voice`, `captions`, `music`, `sfx` |
| `brief` | `agent` | parameters, the five reference lists | `Brief` |
| `brief_defaults` | `tool` (`jc_video_defaults`, kind `brief`) | `Brief` | `Brief` with every open question carrying a default answer |
| `brief_gate` | `branch` | `Brief` → `openQuestions` | control output `ask` |
| `check_brief` | `approval` | `Brief` | `Brief` (possibly edited) |
| `script_draft` | `script` (`draft`) | `Brief`, `sourceTexts` | `ScriptRef` |
| `script_review` | `loop` (`maxIterations` 4) | `ScriptRef` | approved `ScriptRef` |
| · `script_approve` | `script` (`approve`) | `ScriptRef` | approved `ScriptRef`, `ReviewReport`, `Decision` |
| · `script_revise` | `script` (`revise`) | `ScriptRef`, notes | `ScriptRef` |
| `shot_list` | `agent` | `Brief`, approved script | `ShotList` |
| `check_shot_list` | `approval` | `ShotList` | `ShotList` (possibly edited) |
| `asset_plan` | `agent` | `Brief`, `ShotList` → `shots[].{id, description, shotSize, cameraMotion, subjects, setting, onScreenText}`, available methods | `AssetPlan` |
| `subjects` | `parallel` (`failurePolicy {minSuccessRatio: 0}`) | `AssetPlan` → `subjects[]` | one item per subject |
| · `subject_image` | `generate` (image; `onError: "continue"`) | subject entry, `subjectRefs` | `ImageRef` |
| `subjects_join` | `join` | — | `list<ImageRef>` (`null` for a failed subject) |
| `assets` | `parallel` (`concurrency` 4, `failurePolicy {minSuccessRatio: 0}`) | `AssetPlan` → one plan entry per item, subject images | one item per shot |
| · `shot_loop` | `loop` (`maxIterations` 4) | plan entry | ShotMedia |
| · · `shot_route` | `branch` | current method | control outputs `video`, `image`, `stock`, `library` |
| · · `shot_video` | `generate` (video; `onError: "route"`) | plan entry, subject images | candidates |
| · · `shot_image` | `generate` (image; `onError: "route"`) | plan entry, subject images | candidates |
| · · `shot_stock` | `tool` (`jc_video_find`, source `stock`; `onError: "route"`) | plan entry | candidates |
| · · `shot_library` | `tool` (`jc_video_find`, source `library`; `onError: "route"`) | plan entry | candidates |
| · · `shot_step` | `tool` (`jc_video_pack`, kind `shot`) | candidates or `error` of the node that ran, plan entry | `{done, method, media}` |
| `assets_join` | `join` | — | `list<json>` of ShotMedia, never `null` |
| `asset_select` | `tool` (`jc_video_defaults`, kind `candidates`) | ShotMedia list | ShotMedia list with `selectedAssetId` set on every shot that has media |
| `assets_gate` | `branch` (`first_match`) | ShotMedia list | control outputs `missing`, `choose` |
| `check_assets_missing` | `approval` (`human`, not overridable) | ShotMedia list | ShotMedia list |
| `check_assets` | `approval` | ShotMedia list | ShotMedia list |
| `assets_final` | `tool` (`jc_video_pack`, kind `shots`) | the decided ShotMedia list, the instances of `assets` | the current ShotMedia list |
| `voiceover` | `parallel` (`fail_fast`, `maxItems` 500) | approved script → spoken segments, voice map | one item per spoken segment |
| · `voice_take` | `generate` (voice) | segment, voice id | `AudioRef` |
| `voiceover_join` | `join` | — | `list<AudioRef>` |
| `timing` | `tool` (`jc_video_timing`) | `ShotList` → `shots[].{id, index, segmentIds, duration_ticks}`, approved script, takes | re-timed `ShotList`, `VoiceTrack` |
| `captions` | `tool` (`jc_video_captions`) | approved script, `VoiceTrack`, re-timed `ShotList` | `CaptionSet` |
| `music` | `generate` (music) | `Brief` → `musicDirection`, parameter `musicMood` | `AudioRef` |
| `music_pack` | `tool` (`jc_video_audio`, kind `music`) | `AudioRef` | `MusicTrack` |
| `sfx` | `parallel` (`failurePolicy {minSuccessRatio: 0}`) | `ShotList` → `shots[].{id, sound}` | one item per shot with `sound` |
| · `sfx_take` | `generate` (sfx; `onError: "continue"`) | `sound` text | `AudioRef` |
| `sfx_join` | `join` | — | `list<AudioRef>` |
| `sfx_pack` | `tool` (`jc_video_audio`, kind `sfx`) | takes | `SfxSet` |
| `assemble_plan` | `tool` (`jc_video_assemble_plan`) | re-timed `ShotList`, ShotMedia list of `assets_final`, `VoiceTrack`, `CaptionSet`, `MusicTrack`, `SfxSet` | `{operations[], sceneName}` |
| `assemble` | `editor` (`mode: "operations"`, `commit: "apply"`) | `operations` | `ProjectRef {projectId, revision}` |
| `review` | `loop` (`maxIterations` 3) | `{project, shotMedia}` | `{project, shotMedia, report, decision, reviewFailed}` |
| · `review_checks` | `tool` (`jc_video_checks`; `cache: "off"`) | `ProjectRef`, `Brief`, re-timed `ShotList`, `VoiceTrack`, `CaptionSet` | findings |
| · `review_report` | `agent` (`cache: "off"`; `onError: "route"`) | findings, `Brief`, frames | `ReviewReport` |
| · `review_gate` | `approval` (`agent`, not overridable; `cache: "off"`) | `ReviewReport` | `Decision`; control outputs `approved`, `changes_requested` |
| · `repair_plan` | `tool` (`jc_video_repair_plan`) | `ReviewReport`, loop `shotMedia`, `AssetPlan`, re-timed `ShotList` | `{items[], textOperations[]}` |
| · `repair_items` | `parallel` (`concurrency` 2, `failurePolicy {minSuccessRatio: 0}`) | `items[]` | one item per shot to regenerate |
| · · `repair_route` | `branch` | item capability | control outputs `video`, `image` |
| · · `repair_video` | `generate` (video; `cache: "off"`; `onError: "continue"`) | item | candidates |
| · · `repair_image` | `generate` (image; `cache: "off"`; `onError: "continue"`) | item | candidates |
| · · `repair_item_pack` | `tool` (`jc_video_pack`, kind `repair-item`) | candidates, item | `{shotId, assetId?, operations[]}` |
| · `repair_join` | `join` | — | `list<json>` |
| · `repair_apply` | `editor` (`mode: "operations"`, `commit: "apply"`) | operations of the items and `textOperations` | `ProjectRef` |
| · `review_pack` | `tool` (`jc_video_pack`, kind `review`) | loop value, `ReviewReport` or the `error` of `review_report`, `Decision`, `ProjectRef` of `repair_apply`, repair results | next loop value; its `shotMedia` output is published as `assets_final.shotMedia` (`publishAs`) |
| `final_gate` | `branch` (`first_match`) | `review` result | control outputs `review_failed`, `confirm` |
| `check_review_failed` | `approval` (`human`, not overridable) | deterministic findings, project preview | `Decision` |
| `check_final` | `approval` | `ReviewReport`, project preview | `Decision` |
| `export_gate` | `branch` | parameter `exportOnCompletion`, the final `Decision` | control output `go` |
| `export` | `export` | `ProjectRef`, `sceneName` | `FileRef` |

Rules of the graph. (1) Input ports that the table marks with a projection declare it as `select` (`agent-workflows.Ports and data types`), so the hash of the consuming execution covers only that projection; "Downstream invalidation rules" follows from these projections and from nothing else. (2) A value that reaches a consumer from one of several alternative producers uses an input in mode `first`: the `Brief` consumed after the brief checkpoint is the first of `check_brief.subject` and `brief_defaults.brief`; the decided ShotMedia list consumed by `assets_final` is the first of `check_assets_missing.subject`, `check_assets.subject` and `asset_select.shotMedia`, and `assets_final.shotMedia` is the one ShotMedia artifact that assembly, the review loop and the "Shots" tab read; the final `Decision` of `export_gate` is the first of `check_review_failed.decision`, `check_final.decision` and the `decision` of the `review` result. (3) `options` fires `draft` when `script` is unset, `voice` when the resolved `voice` is not `none`, `captions` when `captions` is true, `music` when `musicMood` is not `none` and `sfx` when `soundEffects` is true; a step whose control output did not fire is `skipped`. `timing` always runs and receives an empty take list when `voiceover` is skipped; `captions` runs without a `VoiceTrack` when voice is off ("Captions step contract"). (4) `brief` … `check_shot_list` form one chain; after `check_shot_list` the branches `asset_plan` → `subjects` → `assets` → `asset_select` → `assets_gate`, `voiceover` → `timing` → `captions`, `music` → `music_pack` and `sfx` → `sfx_pack` have no dependency on each other and are dispatched concurrently by `agent-workflows.Scheduler`; `assemble_plan` starts when the ShotMedia list, `timing`, `captions`, `music_pack` and `sfx_pack` are each `succeeded` or `skipped`. (5) A node whose ORC role is optional and has no route ends `skipped` with reason `no_route`; this is the engine rule of `agent-workflows.Required and optional roles of a run`, not a mechanism of this template, and every consumer of such a node takes its value through a non-required input or an input in mode `first`, so the run continues. (6) The worst case of one run — 200 shots, 500 spoken segments, 40 sound effects, 12 subjects, 4 method attempts per shot and 3 review iterations that each repair every shot — is at most 7,000 node executions and no fan-out above 500 items, inside the 20,000 executions and 1,000 fan-out items of `agent-workflows.Size limits`. (7) Every reference a node consumes carries its content revision (`agent-workflows.Ports and data types`): the project as `ProjectRef {projectId, revision}`, the script as `ScriptRef {scriptId, versionId}`, media by `blobSha256`; no parameter or port of this template carries the id of a mutable object as a scalar. The declared workflow outputs are `project` (`ProjectRef`), `file` (`FileRef`, absent when export is skipped), `script` (`ScriptRef`) and `review` (`ReviewReport`). The shipped document is `packages/workflow/templates/one-prompt-video.json`; it MUST pass `agent-workflows.Validation rules` and contain the 61 node ids of this table and no other. [NEW] [CAPCUT CC-233]

#### Scenario: Concurrent branches
- **WHEN** `check_shot_list` succeeds in a run with voice, music and sound effects enabled
- **THEN** `asset_plan`, the first `voice_take` instances, `music` and the first `sfx_take` instances become `ready` within 1 s of each other
- **AND** `assemble_plan` stays `pending` until the ShotMedia list, `timing`, `captions`, `music_pack` and `sfx_pack` are each `succeeded` or `skipped`

#### Scenario: Skipped inputs
- **WHEN** the run has `voice: "none"`, `musicMood: "none"`, `soundEffects: false` and `captions: false`
- **THEN** `voiceover`, `captions`, `music`, `music_pack`, `sfx` and `sfx_pack` are `skipped` and `timing` succeeds with unchanged shot durations
- **AND** `assemble` produces a timeline with no voiceover, caption, music or sound-effect elements

#### Scenario: Template validates
- **WHEN** the conformance suite loads `one-prompt-video.json`
- **THEN** validation returns no errors, the document contains exactly the 61 node ids of the table, and each has the stated type

#### Scenario: Worst case stays inside engine limits
- **WHEN** a run has 200 shots that each use 4 method attempts, 500 spoken segments and 3 review iterations
- **THEN** no fan-out lists more than 500 items and the run records fewer than 20,000 node executions

### Requirement: ORC role assignment per step
Each step SHALL be performed by the persona, ORC role or route below (personas of `chat-agent.Default agent personas`; roles of `orc-model-routing.Role catalogue`; resolution and fallback order per `orc-model-routing.Route resolution and fallback`):

| Step | Performer | ORC role or route | Required |
|---|---|---|---|
| `brief`, `asset_plan` | `jagentchill-director` | `director` | yes |
| `script_draft`, `script_revise` | `jagentchill-screenwriter` (`script-studio.Screenwriter agent and source material`) | `screenwriter` | yes, unless `script` is set |
| `script_approve` under policy `agent`; `review_report`, `review_gate`; reviewer of any checkpoint under `agent` | `jagentchill-reviewer` | `reviewer` | yes |
| `shot_list` | `jagentchill-storyboard` | `storyboard` | yes |
| `subject_image`, `shot_image`, `repair_image` | — | `image` | see the visual-source rule |
| `shot_video`, `repair_video` | — | `video.text`, or `video.image` when a first frame is supplied | see the visual-source rule |
| `shot_stock` | — | a connected stock source of `generation-providers.Stock media providers` | see the visual-source rule |
| `voice_take` | — | `voice-tts.narration` for narration, `voice-tts.dialogue` for dialogue | only when `voice` is an explicit voice id |
| candidate scoring, ranking of stock and library results, frame inspection in `review_report` | — | `vision` | no |
| word timing in `captions` | — | `transcription`; `translation` when `secondCaptionLanguage` is set | no |
| `music` | — | `music` | no |
| `sfx_take` | — | `sfx` | no |
| every `tool`, `branch`, `editor` and `export` node | none (no model) | — | — |

Visual-source rule: the run needs at least one usable way to obtain pictures for the chosen `visualSource` — for `generate`, a route for `image` or for `video`; for `stock`, a connected stock source that returns video or images; for `library`, media in the bound project's library or in `footageRefs`; for `mixed`, any one of these. The template declares its roles to the engine in the form of `agent-workflows.Template parameters and save-as-template`: `requiredRoles` = `director`, `storyboard`, `reviewer`, `{role: "screenwriter", when: script is unset}`, `{role: "voice-tts", when: voice is an explicit voice id}` and, when `visualSource` is `generate`, `{anyOf: ["image", "video"]}`; `optionalRoles` = `image`, `video`, `voice-tts`, `vision`, `transcription`, `translation`, `music`, `sfx` and the stock sources. The start gate is the engine's and this capability defines none of its own (`agent-workflows.Required and optional roles of a run`, `orc-model-routing.Required and optional roles`): the engine calls `jagentchill.orc.readiness.check`; a missing required role refuses the start with `NO_ROUTE` and `details.checklist[]`, and the form keeps the primary button disabled and shows that checklist under "To run this you need:" ("Add a model for writing — role screenwriter", "Add an image or video model", "Add a voice model for the chosen voice"), each line linking to `orc-model-routing.ORC settings page`, where a provider is connected in any of the three equal ways — an installed agent CLI, sign-in with the provider (OAuth), or an API key. For `visualSource` `stock`, `library` and `mixed` the visual-source rule is checked by the template's own parameter validation, like the rules of "Run input contract" (`WORKFLOW_INPUT_INVALID` naming `visualSource`, with the message "Add an image or video model, connect a stock source, or add media to your library"), because stock sources and library media are not roles. A missing optional role MUST NOT block the start; "Start on a host without optional providers" defines what the run does instead. The roles `music` and `sfx` always resolve, because the built-in profile `library` on the provider `jc-sound-pack` is the last candidate of both (`orc-model-routing.Default profiles from the enabled catalogue`); `voice-design` and `lipsync` are not used by this template. The "Models" section of `agent-workflows.Run setup form` lists one row per role in use with resolved provider and model and the per-run profile select of `orc-model-routing.Per-run override`; a role resolved to `jc-sound-pack` reads "Bundled sounds", and an optional role without a route reads "Not configured — step will be skipped". In a customised copy (see "Customising the template into a new workflow") any `agent` step can be reassigned to another persona or a user-created agent, or replaced by a `team` node (`agent-workflows.Team node`) — for example the shipped `video-production` Team of `multi-agent-orchestration.Shipped team templates` for the chain `brief` … `shot_list`. A substituting `team` node declares `outputSchema` with one property per artifact it replaces (`brief`: `Brief`, `script`: `ScriptRef`, `shotList`: `ShotList`); by the rule of `agent-workflows.Team node` each property becomes a typed output taken from the accepted result's `deliverables[]` by name, a deliverable above the hand-off size limit travels as a reference to an artifact, and a missing or invalid deliverable fails the node with `WORKFLOW_AGENT_OUTPUT_INVALID` — a `Handoff` is never connected to a `Brief`, `ScriptRef` or `ShotList` input. Steps given to agents or teams obey `multi-agent-orchestration.Tree limits` and `multi-agent-orchestration.Runtime eligibility for team roles`. The `orc-model-routing` switches `autoPrepareBrief` and `askWhenAmbiguous` do not apply inside a run: the `brief` step is the only brief of a run. [NEW] [JAD]

#### Scenario: Role mapping shown before start
- **WHEN** the user expands "Models" in the run setup form with all options on and every role configured
- **THEN** rows for `director`, `screenwriter`, `storyboard`, `reviewer`, `image`, `video`, `vision`, `voice-tts`, `transcription`, `music` and `sfx` each list provider, model and a profile select

#### Scenario: Missing required role
- **WHEN** role `screenwriter` has no route and `script` is unset
- **THEN** the primary button is disabled and the checklist shows "Add a model for writing — role screenwriter" with a link to ORC settings, and a start through `jc_workflow_start` fails with `NO_ROUTE` carrying the same checklist
- **AND** choosing an approved script for `script` removes the line and enables the button

#### Scenario: Explicit voice needs a voice model
- **WHEN** `voice` holds a catalogue voice id and role `voice-tts` has no route
- **THEN** the checklist shows "Add a voice model for the chosen voice" and the start is blocked until a route exists or `voice` is set to `none`

#### Scenario: Missing optional role
- **WHEN** role `transcription` has no route and every required role resolves
- **THEN** the primary button is enabled and the "Models" row for `transcription` reads "Not configured — step will be skipped"

#### Scenario: Step given to a team
- **WHEN** a user duplicates the template, replaces `brief`, `brief_defaults`, `brief_gate`, `check_brief`, `script_draft`, `script_review`, `shot_list` and `check_shot_list` with one `team` node targeting `video-production` whose `outputSchema` has the properties `brief`, `script` and `shotList`, and saves
- **THEN** validation reports no errors, the node exposes the typed outputs `brief` (`Brief`), `script` (`ScriptRef`) and `shotList` (`ShotList`), and a run of the copy shows the team node with its member count on the canvas

#### Scenario: Team result lacks a deliverable
- **WHEN** the team's accepted result has no deliverable named `shotList`
- **THEN** the team node fails with `WORKFLOW_AGENT_OUTPUT_INVALID` naming `shotList` and no downstream step starts

### Requirement: Start on a host without optional providers
A run of the template SHALL start on a host that has only the required roles of "ORC role assignment per step" — a freshly installed host on which the user has connected one language model and one image or video model — and SHALL then run without the parts it cannot make instead of pausing or failing (design decision D12, `agent-workflows.Required and optional roles of a run`). Before start the form lists, under the heading "Will run without:", one line per affected part with its setup hint; while and after the run the same lines appear in the run summary of `agent-workflows.Run view` under "Skipped" (from the run record's `skippedRoles[]`), each with "Add a provider", which opens the settings page where the provider is connected by an installed agent CLI, by sign-in with the provider (OAuth) or by an API key:

| Missing | What the run does | Line shown |
|---|---|---|
| `video` | `asset_plan` receives the available methods without `generate-video`; shots are stills with a motion preset | "Video clips — no video model. Add one in Model routing." |
| `image` | available methods omit `generate-image`; `subject_image` items are `skipped (no_route)` | "Generated images — no image model. Add one in Model routing." |
| stock source for video or images | available methods omit `stock-search` | "Stock footage — no stock source connected. Add one in Providers." |
| `voice-tts` with `voice: "auto"` | voice resolves to `none`; `voiceover` is `skipped`; captions are timed from the script | "Narration — no voice model. Add one in Model routing." |
| `transcription` | `captions` uses proportional timing with warning `CAPTIONS_APPROXIMATE_TIMING` | "Word-accurate caption timing — no transcription model." |
| `translation` with `secondCaptionLanguage` set | the second caption language is omitted with warning `CAPTIONS_TRANSLATION_UNAVAILABLE` | "Second caption language — no translation model." |
| `vision` | candidates carry no score, the first candidate is selected, and the model checks of the review are omitted with finding `REVIEW_FRAMES_UNAVAILABLE` (`info`) | "Automatic picture checks — no vision model." |
| a generative `music` model | `music` resolves to the built-in provider `jc-sound-pack`: the track of `audio-editing.Bundled sound pack` whose mood matches; the substitution is always stated, never silent | "Generated music — using the bundled music library." |
| a generative `sfx` model | each `sfx_take` resolves to `jc-sound-pack` by keyword search over the effect catalogue; an effect with no match is omitted | "Generated sound effects — using the bundled sound library." |

The list of available methods is computed when the run starts from the resolved routes and connected sources, is passed to `asset_plan` as an invariant and to the shot body as the fallback order, and is recomputed when a paused run resumes. A step skipped for a missing route costs nothing and makes no provider call. When a required role loses its last route while the run is executing, the engine's rule for required roles applies unchanged: an attended run pauses with `pauseReason: "no_route"` and an unattended run fails that node (`agent-workflows.Run state machine`). The template never offers to start with a required item missing. [NEW]

#### Scenario: Fresh host with a language model and an image model
- **WHEN** a host has routes only for `director`, `screenwriter`, `storyboard`, `reviewer` and `image`, and the user sends one prompt with every parameter at its default
- **THEN** the form lists "Will run without:" video clips, stock footage, narration, word-accurate caption timing and automatic picture checks, and the primary button is enabled
- **AND** the finished run holds a timeline of still images with motion presets, captions timed from the script, one track from the bundled music library and sound effects from the bundled sound library, with no node `failed` and no pause

#### Scenario: Run summary names what was skipped
- **WHEN** that run succeeds
- **THEN** its summary lists the same lines under "Skipped", and "Narration — no voice model. Add one in Model routing." opens `orc-model-routing.ORC settings page` at role `voice-tts`

#### Scenario: No way to obtain pictures
- **WHEN** `visualSource` is `generate` and neither `image` nor `video` has a route
- **THEN** the start is refused with `NO_ROUTE` and the checklist line "Add an image or video model"

#### Scenario: Sound effect without a match in the pack
- **WHEN** the sound pack is the only `sfx` source and a shot's `sound` text "glass harmonica" matches no catalogue entry
- **THEN** that item ends `skipped`, the `SfxSet` holds the other cues, and the run continues

### Requirement: Structured output validation
Every `agent` step of the template (`brief`, `shot_list`, `asset_plan`, `review_report`) SHALL return its artifact through `agent-workflows.Agent node structured output` against a Zod schema in `packages/workflow`, and the host SHALL then check the invariants stated in that step's contract. A result that fails the schema or an invariant is returned to the agent with the list of violations under the emit and corrective limits of that requirement; when they are exhausted the node fails with `WORKFLOW_AGENT_OUTPUT_INVALID` and `details.issues` holding the first 5 violations (path and message). Invariants marked "normalised" in a contract are repaired by the host instead of rejected, and each repair is logged as a warning on the node. A `team` node that replaces one of these steps is held to the same schema through its `outputSchema` ("ORC role assignment per step"). Prompts of the template's agent steps live in `packages/workflow/prompts/` (one English source file per step, each naming the requirement it implements) and are written from this specification only. [NEW]

#### Scenario: Invalid brief is corrected
- **WHEN** the first `brief` result has 9 `keyMessages`
- **THEN** the emit is refused with "keyMessages: at most 7 items" and the agent's corrected result with 7 items is accepted

#### Scenario: Still invalid after corrections
- **WHEN** every emit of `shot_list` in a turn and both corrective turns omit `segmentIds`
- **THEN** the node fails with `WORKFLOW_AGENT_OUTPUT_INVALID` and the node detail panel lists the first 5 issues

### Requirement: Brief step contract
The `brief` step SHALL produce a `Brief` with fields: `title` (1–80 characters); `intent` (`story`, `explainer`, `advertisement`, `tutorial`, `social-short`, `trailer`, `news`, `other`); `audience` and `tone` (each 1–200 characters); `keyMessages` (1–7 items, each `{text (1–200), evidence}` where `evidence` quotes a span of the prompt or of a `sourceTexts` file, or is the literal `assumption`); `structure` (2–12 ordered beats, each `{label, targetDuration_s}`); `visualStyle` (`presetId?`, text of 1–500 characters and 3–6 hex palette colours); `narrationPolicy` (`voiceover`, `dialogue`, `none`); `musicDirection` (0–300 characters); `constraints` (`aspectRatio`, `language`, `duration`, `mustInclude[]` 0–20, `mustAvoid[]` 0–20); `referenceUsage` (one entry per reference file id); `assumptions` (0–10, each `{text, source: "agent" | "default-answer" | "user"}`) and `openQuestions` (0–5, each `{id, question, suggestedAnswers[] (2–4), answer?}`). Invariants: `constraints.aspectRatio`, `.language` and `.duration` equal the run parameters; `narrationPolicy` is `none` when the resolved `voice` is `none`; beat durations sum to `targetDuration_s` (normalised: when the sum differs, durations are scaled proportionally and rounded to 0.1 s); a `keyMessages` item whose `evidence` is `assumption` is also listed in `assumptions`. When `script` is supplied the brief is derived from the script's metadata and segments and `openQuestions` is empty. `brief_defaults` (`jc_video_defaults`, kind `brief`; deterministic, no model) then sets, on every open question without an `answer`, `answer` to its first suggested answer and appends `{text: "<question> — <answer>", source: "default-answer"}` to `assumptions`, so that the `Brief` leaving it is complete whoever decides the checkpoint. `brief_gate` fires `ask` only when `openQuestions` is not empty; at `check_brief` a person changes any answer (free text allowed), which rewrites the matching assumption with `source: "user"`. The `brief` node's `timeout_s` is 120. [NEW]

#### Scenario: Brief generated
- **WHEN** the step runs for a 30 s prompt
- **THEN** the stored `Brief` has beat durations summing to 30.0 s
- **AND** `constraints.aspectRatio`, `constraints.language` and `constraints.duration` equal the run parameters

#### Scenario: Open questions at the checkpoint
- **WHEN** the `Brief` contains 2 open questions and the run uses mode `checkpoints`
- **THEN** `check_brief` is `waiting_approval` and shows each question with its suggested answers, the first one pre-selected, and a free-text field

#### Scenario: Open questions without a person
- **WHEN** the `Brief` contains 2 open questions and the checkpoint's effective policy is `auto`
- **THEN** the `Brief` consumed by `script_draft` carries both questions answered with their first suggested answer and two assumptions with `source: "default-answer"`, written by `brief_defaults` before the checkpoint

#### Scenario: Timeout
- **WHEN** the model call has not returned after 120 s
- **THEN** the node fails with `WORKFLOW_AGENT_TIMEOUT` after the retries of `agent-workflows.Retry and fallback`

### Requirement: Script step contract
The script of a run SHALL be a script document of `script-studio`, written, versioned, reviewed and approved by that capability; this template only configures the nodes. `script_draft` is a `script` node with operation `draft` (`agent-workflows.Script node`), input the `Brief` and the `sourceTexts` files, and constraints `{targetDuration_s: <speech target> (tolerance ±10 %), language, mustInclude, mustAvoid, captionSafe: captions}` from the brief. The speech target is `targetDuration_s` when the resolved `voice` is `none`, and otherwise `targetDuration_s − 0.4 s × ⌈targetDuration_s ÷ 4⌉` (never below 60 % of `targetDuration_s`): the room that "Voiceover step contract" adds around the takes of the assumed shot count is taken out of the writing target, so a script that meets its target yields a timeline that meets the run's. Drafting, duration estimation (`script-studio.Duration estimate`), constraint checking and the writer's retries are those of `script-studio.Full draft` and `script-studio.Constraint checking`, and a draft that still violates the duration constraint ends the node with `SCRIPT_CONSTRAINT_VIOLATION`. When a `sourceTexts` file contains a complete script its wording is preserved and only structured, as `script-studio.Screenwriter agent and source material` defines. `script_approve` is a `script` node with operation `approve`, designed node policy `human` and `overridable: true` (`agent-workflows.Script node`), so the run mode decides who approves ("Run modes"); `changes_requested` runs `script_revise` with the reviewer's or the person's notes and returns to `script_approve`, at most 3 revisions, after which the loop's `exhausted` output leaves the script waiting for a person; `rejected` ends the run `failed` with `WORKFLOW_REJECTED`. Downstream steps consume only the approved version, through the **segments** projection of `script-studio.Feeding workflows and the film pipeline` — the Script artifact of this template: an ordered list of `{id, beatLabel, kind: "narration" | "dialogue" | "on-screen-text" | "silent", speaker, text (0–400 characters), estimatedDuration_s}`; segments of kind `narration` and `dialogue` are the spoken segments. Because a `ScriptRef` carries `versionId`, a new approved version changes the input hash of every consumer. The script stores `links.workflowLink {runId, nodeId}` and opens in the script editor from the node's output. [NEW] [CAPCUT CC-232]

#### Scenario: Script within the speech target
- **WHEN** the target duration is 60 s in English with narration
- **THEN** the speech target is 54.0 s (60 − 0.4 × 15) and the approved script's total estimate is between 48.6 and 59.4 s

#### Scenario: Silent run uses the full duration
- **WHEN** the target duration is 60 s and the resolved voice is `none`
- **THEN** the approved script's total estimate is between 54 and 66 s

#### Scenario: User-supplied script preserved
- **WHEN** a `sourceTexts` file contains a 120-word script
- **THEN** the concatenated `text` of the segments equals the supplied script character for character, ignoring whitespace normalisation

#### Scenario: Duration cannot be met
- **WHEN** the draft and the writer's 2 retries all produce totals outside ±10 % of the speech target
- **THEN** `script_draft` fails with `SCRIPT_CONSTRAINT_VIOLATION` and the node detail panel shows the three measured totals

#### Scenario: Changes requested
- **WHEN** a person presses "Request changes" with a note at `script_approve`
- **THEN** `script_revise` creates a new script version using the note and `script_approve` waits again on that version

### Requirement: Shot list step contract
The `shot_list` step SHALL produce a `ShotList` of 1–200 shots covering every segment of the approved script in order. Each shot is `{id, index, segmentIds[], duration_ticks (120,000–1,800,000, i.e. 1–15 s), description (1–800 characters), shotSize: "extreme-wide" | "wide" | "medium" | "close-up" | "extreme-close-up" | "insert", cameraMotion: "static" | "pan" | "tilt" | "push-in" | "pull-out" | "track" | "handheld" | "orbit", subjects[] (0–6 names), setting (0–200), onScreenText (0–120), transitionOut ("cut" or a transition id of `transitions.Bundled transition library`), sound? (0–120 characters describing one sound effect)}`. A shot carries no spoken text: the words live only in the script segments its `segmentIds` name, the ShotList viewer shows them read-only next to the shot, and "Edit text" there opens the segment in `script-studio.Structured editor`, where the edit creates a script version that goes through `script_approve` again. Invariants: every segment id appears in at least one shot and shot order follows segment order; a segment listed by several shots belongs, for its spoken take, to the first of them; at most 40 shots carry `sound`; a shot longer than 15 s is split into parts of at most 15 s that keep the description (normalised); shot durations sum to the script's total estimate plus 48,000 ticks (0.4 s) for every shot that is the first shot of a spoken segment (normalised: scaled proportionally, each rounded up to a whole frame); more than 200 shots is a violation; a script with more than 500 spoken segments is a violation naming the rule "at most 500 spoken segments". When the script already has shots, the step starts from the **shot list** projection of `script-studio.Feeding workflows and the film pipeline` and only completes missing fields. Durations are provisional until `timing` has run. [NEW]

#### Scenario: Coverage of the script
- **WHEN** the script has 8 segments
- **THEN** every segment id appears in at least one shot's `segmentIds` and shot order follows segment order

#### Scenario: Shot duration bounds
- **WHEN** the model returns a shot of 22 s
- **THEN** the host splits it into shots of 11 s and 11 s before persisting and logs a warning on the node

#### Scenario: Shot count limit
- **WHEN** the model returns 201 shots in every attempt
- **THEN** the node fails with `WORKFLOW_AGENT_OUTPUT_INVALID` naming the rule "at most 200 shots" and no `ShotList` is persisted

#### Scenario: Durations normalised
- **WHEN** the script estimate is 26.8 s, 8 shots each start a spoken segment, and the returned shot durations sum to 33.0 s at 30 fps
- **THEN** each duration is scaled by 30.0/33.0, rounded up to a whole frame, and the stored sum is between 30.0 s and 30.0 s plus one frame per shot

#### Scenario: No spoken text on a shot
- **WHEN** the model returns a shot with a field holding narration words
- **THEN** the schema rejects the unknown field and the corrected result carries only `segmentIds`

### Requirement: Asset plan step contract
The `asset_plan` step SHALL assign to every shot exactly one acquisition method and the data every method of the fallback order needs: `{shotId, method, videoPrompt? (for `generate-video`, with an optional first-frame request and duration and resolution options), imagePrompt (always present, 1–2,000 characters), motionPreset: "none" | "slow-zoom-in" | "slow-zoom-out" | "pan-left" | "pan-right", stockQueries[] (always 1–3) with `stockMediaType: "video" | "image"`, library? {mediaId, in_ticks, out_ticks} (for `library`: a media id of the bound project's library or of `footageRefs`), card {text, backgroundColor, textStyle} (always present), subjectIds[]}`. `method` is one of `generate-video`, `generate-image`, `stock-search`, `library`, `title-card`. Invariants: the method is in the list of available methods the step received ("Start on a host without optional providers"); the methods respect `visualSource` — `generate` allows `generate-video`, `generate-image` and `title-card`; `stock` allows `stock-search` and `title-card`; `library` allows `library` and `title-card`; `mixed` allows all; every `library` media id exists. The plan also lists shared `subjects` (0–12 recurring characters, objects or places), each `{id, name, description (1–600), referenceImage: boolean}` with `referenceImage` true when any shot using the subject has a generate method, and each shot lists the subject ids it uses. [NEW]

#### Scenario: Visual source restricts methods
- **WHEN** `visualSource` is `stock`
- **THEN** no shot in the `AssetPlan` has method `generate-video`, `generate-image` or `library`

#### Scenario: Unavailable method is not planned
- **WHEN** the available methods are `generate-image`, `library` and `title-card` because no video model and no stock source exist
- **THEN** an emit that assigns `generate-video` to a shot is refused with "shots[2].method: not available on this host" and the agent corrects it

#### Scenario: Recurring subject
- **WHEN** the same character appears in 4 shots with a generate method
- **THEN** the `AssetPlan` contains one subject entry for the character with `referenceImage: true` and each of the 4 shots references that subject id

#### Scenario: Unknown library media
- **WHEN** the model assigns `library` with a media id that does not exist
- **THEN** the emit is refused with the violation "shots[3].library.mediaId: unknown media" and the agent corrects it

### Requirement: Asset step fan-out per shot
The `subjects` fan-out SHALL create one reference image per subject with `referenceImage: true` before `assets` starts; a subject whose image fails or is skipped yields `null`, the shots that use it generate without that reference, and the review reports `SUBJECT_REFERENCE_MISSING` (`warning`) for them. The `assets` fan-out SHALL instantiate one body per shot (`agent-workflows.Parallel and join nodes`; per-shot state is reported in `counts`). The body is the loop `shot_loop`, whose value is `{method, tried[], media?}` starting at the planned method and whose iteration is: `shot_route` fires the output of the current method (none for `title-card`); exactly one of `shot_video`, `shot_image`, `shot_stock`, `shot_library` runs; `shot_step` receives that node's candidates, or its `error`, through inputs in mode `first`, and returns `{done, method, media}`; the loop continues while `done` is false ("Shot method fallback chain" defines `shot_step`'s decision). `shot_video` and `shot_image` are `generate` nodes (`agent-workflows.Generate node`) called with the plan's prompt, the run aspect ratio, the available subject reference images and `candidates: candidatesPerShot`; duration and resolution are chosen from the options the model declares in `generation-providers.Capability metadata` — the smallest declared duration ≥ the shot duration, or the largest when none is ≥ (the clip is then extended at assembly). `shot_stock` calls `jc_video_find {source: "stock"}`, which queries the connected sources of `generation-providers.Stock media providers` with up to 12 results per query, discards results whose licence does not permit reuse, ranks the rest and keeps the top 4 as candidates with provider, author, licence name and source URL; `shot_library` calls `jc_video_find {source: "library"}`, which ranks the planned media and other library items the same way; both end with the tool error `NOT_FOUND` (`details.reason: "no_results"`) when nothing usable is found. A `title-card` shot produces no media. `shot_step` (`jc_video_pack`, kind `shot`) scores each candidate 0–1 against the shot description with the `vision` role when it has a route, and emits one ShotMedia `{shotId, method, fallbackApplied?, failure? {code, class, message}, candidates[] {assetId, source: "generated" | "stock" | "library" | "user", score?, licence?, provenance}, selectedAssetId?}`; every instance ends `succeeded`, with a ShotMedia that has no candidate when nothing was obtained, so `assets_join.results[i]` is never `null` and the join never fails for lack of successes. Video and image models, their options and their prices come only from the enabled catalogue of `generation-providers.Model catalogue`. [NEW] [CAPCUT CC-234]

#### Scenario: Subject reference generated first
- **WHEN** 3 shots depend on subject "Mai"
- **THEN** the `subject_image` instance for "Mai" is `succeeded` before any of those 3 shot instances is `running`

#### Scenario: Subject reference fails
- **WHEN** the reference image of subject "Mai" fails on every `image` route
- **THEN** `subjects_join` succeeds with `null` for "Mai", her 3 shots are generated without that reference, and the review lists `SUBJECT_REFERENCE_MISSING` for each of them

#### Scenario: Model duration options
- **WHEN** a shot lasts 7 s and the video model declares durations 5 s and 10 s
- **THEN** the instance requests 10 s and the assembled clip is trimmed to 7 s

#### Scenario: Stock results with unusable licence
- **WHEN** a stock query returns 12 results of which 5 have a licence that forbids reuse
- **THEN** only the remaining 7 are ranked and at most 4 become candidates, each storing provider, author, licence name and source URL

#### Scenario: Fan-out counter
- **WHEN** 5 of 12 shot instances have succeeded and 4 are running
- **THEN** the `assets` node reports `counts {total: 12, succeeded: 5, running: 4}` and the canvas shows "5/12"

#### Scenario: Every shot fails
- **WHEN** a 1-shot run's only acquisition node fails and no fallback applies
- **THEN** the instance is `succeeded` with a ShotMedia without candidates, `assets_join` succeeds, and the run reaches `check_assets_missing` instead of failing with `WORKFLOW_FANOUT_FAILED`

### Requirement: Shot method fallback chain
When a shot's acquisition node ends `failed` after the retries and route fallback of `agent-workflows.Retry and fallback` (attempt counts and delays: `generation-providers.Retry policy`; the template defines no retry of its own), its `onError: "route"` SHALL fire the `error` output with `{code, class, message, nodeId, attempt}` (`agent-workflows.Node timeouts and error routes`; `class` is the error class of `generation-providers.Error and content-safety mapping`), and `shot_step` SHALL decide the shot's next method from that payload, deterministically and without a model — the decision reads `error.class` exactly as a `branch` on `inputs.error.class` would, and is made in the tool because the same node also has to merge the candidates of the four alternative acquisition nodes and carry the loop value. An acquisition node that ends `skipped` with reason `no_route` (an optional role that lost its route during the run) hands `shot_step` neither candidates nor an error, which it treats as a downgrade failure of class `model_unavailable`. The fallback order is `generate-video` → `generate-image` with motion preset `slow-zoom-in` → `stock-search` → `title-card` (the plan's `card`, whose text is the text of the shot's first segment, else its description); `library` with no usable result enters the order at `stock-search`; a method that is not in the run's available methods or not allowed by `visualSource` is passed over. `shot_step` moves to the next method only when `allowMethodFallback` is true and the failure is a downgrade failure — `class` one of `content_blocked`, `invalid_output`, `capability_mismatch`, `server_error`, `timeout`, `model_unavailable`, `network`, or the tool error `NOT_FOUND` with reason `no_results`; it then records `fallbackApplied: <new method>` on the ShotMedia, which the review reports as a `warning`. Any other failure, or `allowMethodFallback: false`, ends the loop with a ShotMedia without candidates and the `failure` recorded. Budget, consent, missing-route and provider-account conditions are not downgrade failures and are not handled by this chain: in an attended run `BUDGET_EXCEEDED`, missing consent, `NO_ROUTE`, `auth_error` and `quota_exhausted` pause the run with the matching `pauseReason` of `agent-workflows.Run state machine`, the node stays `ready`, and the `error` route is never taken; in an unattended run the node fails with the engine's code for that condition, the `error` route fires, and `shot_step` ends the shot without media. A shot without media never fails the fan-out; it reaches `check_assets_missing`, which waits for a person with the actions "Retry", "Use a title card" and "Replace with my media" per shot ("Checkpoints mapped to approval nodes"). [NEW] [JAD]

#### Scenario: Method fallback chain
- **WHEN** every `video` route fails with `server_error` for shot 7 and `allowMethodFallback` is true
- **THEN** the loop's second iteration runs `shot_image` with `slow-zoom-in`, `fallbackApplied: "generate-image"` is recorded, and the review lists a warning for shot 7

#### Scenario: Content refused
- **WHEN** a provider refuses the video prompt of shot 2 on content grounds
- **THEN** no retry is made on that route, the provider's message is stored on the node, and the shot continues with `generate-image`

#### Scenario: Unavailable method is passed over
- **WHEN** shot 4's video generation fails with `timeout`, no `image` route exists and a stock source is connected
- **THEN** the next iteration runs `shot_stock` and `fallbackApplied` is `stock-search`

#### Scenario: Provider account failure in an attended run
- **WHEN** every `video` route answers `auth_error` in an attended run
- **THEN** the run is `paused` with `pauseReason: "provider_account"`, the affected `shot_video` executions stay `ready`, no shot is downgraded, and "Resume" after the key is fixed continues them

#### Scenario: Provider account failure in an unattended run
- **WHEN** the same happens in an automation-started run with 6 video shots
- **THEN** the 6 `shot_video` executions fail, none is downgraded, their ShotMedia carry `failure.class: "auth_error"` and no candidate, and the run parks at `check_assets_missing` listing 6 shots

#### Scenario: Fallback disabled
- **WHEN** `allowMethodFallback` is false and shot 3's video generation fails on all routes
- **THEN** shot 3 has no media and `check_assets_missing` waits with "Retry", "Use a title card" and "Replace with my media"

### Requirement: Voiceover step contract
The `voiceover` fan-out SHALL synthesise one take per spoken segment (kind `narration` or `dialogue`) with a `generate` node of capability `voice`, output 48 kHz mono, one candidate. Voices are assigned per speaker before the fan-out starts and recorded as the map `voices {<speaker>: voiceId}` of the `VoiceTrack`: narration uses the run's `voice`; every other `speaker` of the script receives, in order of first appearance, the next voice of `generation-providers.Voice catalogue` for the run language whose `voiceId` is not yet in the map, preferring a voice whose gender tag matches the script entity when the entity declares one; when the catalogue has fewer voices than speakers the remaining speakers reuse voices in order and the review reports `VOICE_SHARED_BY_SPEAKERS` (`warning`). The map is editable in the `VoiceTrack` viewer; changing a speaker's voice marks that speaker's takes `stale`. A failed take fails the fan-out (`fail_fast`) and the run. The `timing` step (`jc_video_timing`) SHALL then measure each take in ticks, build the `VoiceTrack` `{voices, takes[] {segmentId, shotId, assetId, start_ticks, duration_ticks}, total_ticks}` and re-time the shot list by one rule: a take belongs to the first shot that lists its segment and starts 24,000 ticks (0.2 s) after that shot's start; the shots that list the segment are extended only when the take plus a lead-in of 24,000 ticks and a lead-out of 24,000 ticks outlasts the sum of their durations, and then only the first of them is extended, by the difference rounded up to a whole frame; several segments of one shot follow each other separated by 24,000 ticks; shots are never shortened. When the re-timed total is outside the duration window — `targetDuration_s` ± 10 % or ± 2 s, whichever is larger — the step succeeds with warning `VOICEOVER_DURATION_DRIFT` carrying both durations, which the review reports. A `voiceSample` is used for cloning the narration voice only when `voiceConsent` is true and the resolved model declares cloning; otherwise the sample is ignored with the warning `VOICE_SAMPLE_UNUSED`. [NEW] [CAPCUT CC-232]

#### Scenario: Shots re-timed to speech
- **WHEN** a shot planned at 3.0 s is the only shot of a segment whose take lasts 3.6 s at 30 fps
- **THEN** the shot duration becomes 4.0 s (480,000 ticks), the take starts 0.2 s after the shot's start, and the run's total duration is recomputed

#### Scenario: Segment spanning two shots
- **WHEN** a segment is listed by two shots of 3.0 s each and its take lasts 5.0 s
- **THEN** the take is placed in the first shot, neither shot is extended (5.0 + 0.4 ≤ 6.0), and the `VoiceTrack` take has that first shot's `shotId`

#### Scenario: Two speakers get two voices
- **WHEN** the script has dialogue by "Lan" and "Minh" and the catalogue has 6 voices for the run language
- **THEN** the `VoiceTrack` map holds a different `voiceId` for each of them and for narration

#### Scenario: Duration drift
- **WHEN** the re-timed total is 34.0 s for a 30 s target (window 27.0–33.0 s)
- **THEN** `timing` succeeds and the review report contains a warning with code `VOICEOVER_DURATION_DRIFT` and both durations

#### Scenario: Inside the window
- **WHEN** the re-timed total is 33.0 s for a 30 s target
- **THEN** no `VOICEOVER_DURATION_DRIFT` warning is raised

#### Scenario: Take fails
- **WHEN** one take fails on every `voice-tts` route
- **THEN** the remaining take instances are cancelled, the run ends `failed` at `voiceover`, and all earlier artifacts are kept

### Requirement: Captions step contract
The `captions` step (`jc_video_captions`) SHALL build a `CaptionSet` from the approved script, the re-timed `ShotList` and, when the run has narration, the `VoiceTrack`: cue text comes from the script (never from re-transcription) for segments of kind `narration` and `dialogue`; each cue holds at most 2 lines of at most 42 characters for 16:9 and 21:9 and at most 2 lines of 24 characters for every other ratio, lasts 0.7–7 s, and cues do not overlap. Cue timing has three sources, tried in this order: word-level alignment of each take by the `transcription` role; when that role has no route or alignment fails after its retries, distribution across each take in proportion to character count, with warning `CAPTIONS_APPROXIMATE_TIMING`; and when the run has no `VoiceTrack`, distribution of each segment's text across the time range of the shots that list it, in proportion to character count, with no warning. When `secondCaptionLanguage` is set the `translation` role produces a parallel cue list with identical timing; when that role has no route or fails, the second language is omitted with warning `CAPTIONS_TRANSLATION_UNAVAILABLE`. Any other failure makes the step `skipped` with warning `CAPTIONS_UNAVAILABLE`. The caption model, styling and editing of the resulting cues are those of `captions-subtitles.Caption track and caption elements`. [NEW] [CAPCUT CC-232]

#### Scenario: Cue text matches the script
- **WHEN** the voiceover reads the segment "Meet the new lamp."
- **THEN** the cue text is exactly "Meet the new lamp." and its start and end lie within that take's time range

#### Scenario: Line length for vertical video
- **WHEN** the aspect ratio is 9:16
- **THEN** no cue line exceeds 24 characters

#### Scenario: Alignment unavailable
- **WHEN** the `transcription` role has no route, or fails after its retries and fallbacks
- **THEN** cue timing is distributed in proportion to character count and the step succeeds with warning `CAPTIONS_APPROXIMATE_TIMING`

#### Scenario: Captions without narration
- **WHEN** the run has `voice: "none"`, `captions: true` and a segment listed by one shot occupying 4.0–8.0 s
- **THEN** that segment's cues lie inside 4.0–8.0 s, split in proportion to character count, and no provider call is made

### Requirement: Music and sound-effect step contracts
The `music` step SHALL obtain one piece of music with a `generate` node of capability `music` (prompt from the brief's `musicDirection` and the parameter `musicMood`; instrumental; a prompt naming a real artist or song is refused before the call), requesting the smallest declared duration ≥ `targetDuration_s`, or the largest declared one. The candidates of role `music` end with the built-in provider `jc-sound-pack` of `generation-providers.Provider registry by capability type` (profile `library`, `orc-model-routing.Default profiles from the enabled catalogue`): a keyword search over the catalogue of `audio-editing.Bundled sound pack` that returns, for a mood, the first track of that mood (for `auto`, the mood named by the brief's `musicDirection`, else `calm`), at no cost and without a network call. Using a pack track in place of generated music is never silent: the form states it before the start, the estimate lists the step as "Bundled sounds", and the run summary carries the line "Generated music — using the bundled music library" ("Start on a host without optional providers"). A generative route that fails therefore falls through to the pack by the ordinary route fallback, and on a host with no music model the pack is the only candidate. When even the pack returns nothing the node fails and, by `onError: "skip"`, the step is `skipped` with warning `MUSIC_UNAVAILABLE`. `music_pack` builds the `MusicTrack` `{assetId, source: "generated" | "library", duration_ticks, bpm?, licence?, sourceUrl?}`; a pack track has `source: "library"` with the licence and source URL of its catalogue entry. The `sfx` fan-out SHALL create one sound effect per shot that carries `sound` (0–40 per run) with a `generate` node of capability `sfx`, requesting a length inside the range the resolved model declares; the same built-in provider ends the candidates of role `sfx`, searching the effect catalogue by the keywords of the `sound` text and returning the best match or `NOT_FOUND`. A failed or unmatched effect is omitted (`onError: "continue"`), and when no effect was obtained the step is `skipped` with warning `SFX_UNAVAILABLE`. `sfx_pack` builds the `SfxSet` `{cues[] {shotId, offset_ticks (0 by default), description, assetId, duration_ticks, source, licence?}}`. Neither step trims or loops audio files: fitting to the timeline is done at assembly, which is why `music` consumes neither the `ShotList` nor the run's measured length. [NEW] [CAPCUT CC-232]

#### Scenario: Music model fails
- **WHEN** music generation fails on the configured routes and the mood is "upbeat"
- **THEN** the bundled-pack candidate answers, and the `MusicTrack` has `source: "library"` with that track's licence and source URL

#### Scenario: Host without a music model
- **WHEN** role `music` has no configured route
- **THEN** `music` succeeds from the bundled sound pack without a provider call and at cost 0

#### Scenario: Mood none
- **WHEN** `musicMood` is `none`
- **THEN** `music` and `music_pack` are `skipped` and no provider call is made

#### Scenario: One effect fails
- **WHEN** 5 shots carry `sound` and the generation for one of them fails
- **THEN** the `SfxSet` has 4 cues and the step succeeds

#### Scenario: Music is not invalidated by the shot list
- **WHEN** the user edits a shot's duration in a completed run
- **THEN** `music` and `music_pack` keep status `succeeded`

### Requirement: Template helper tools
The server SHALL offer the tool family `jc_video_*` on its agent tool endpoint (`server-api.Agent tool endpoint and session binding`; MCP, named here by base name, no tool taking a caller-identity parameter, and a call that the server cannot bind to a session failing with `SESSION_UNBOUND`), defined here and listed in the index of `agent-editing-tools.Tool naming and families`. The tools are deterministic apart from the stated model calls, never write to a project, are marked `readOnly` in the manifest, return the envelope of `agent-editing-tools.Result envelope`, and are callable from `tool` nodes and by agents holding the workflow run tools:
- `jc_video_defaults {kind: "brief", brief}` → `{brief}` — the default answers of "Brief step contract"; `{kind: "candidates", shotMedia[], policy: "first" | "highest-score"}` → `{shotMedia[]}` — sets `selectedAssetId` on every shot that has candidates and none selected ("Candidates and selection"). No model call.
- `jc_video_find {source: "stock" | "library", queries[] (1–3), mediaType: "video" | "image", description, projectId?, plannedMediaId?, limit (1–12, default 4)}` → `{candidates[]}` — searches, filters by licence and ranks as "Asset step fan-out per shot" states; fails with `NOT_FOUND` and `details.reason: "no_results"` when nothing usable is found. Calls the `vision` role once per ranked candidate when it has a route.
- `jc_video_rank {description, candidates[] {assetId | previewUrl}, limit (1–12)}` → `{ranked[] {index, score (0–1)}}` — scores each candidate's middle frame against the description with the `vision` role; with no `vision` route it returns the candidates in input order without scores.
- `jc_video_pack {kind: "shot", plan, state, candidates?, error?, availableMethods[], allowMethodFallback}` → `{done, method, media}` — the decision of "Shot method fallback chain" and the ShotMedia of "Asset step fan-out per shot"; `{kind: "shots", decided[], instances[]}` → `{shotMedia[]}` — the current ShotMedia list of "Candidates and selection"; `{kind: "repair-item", item, candidates?}` → `{shotId, assetId?, operations[]}`; `{kind: "review", value, report?, reportError?, decision?, repairedProject?, repairs[]?}` → the next value of the `review` loop ("Automated review against the brief"). Kind `shot` calls the `vision` role once per candidate when it has a route; the other kinds make no model call.
- `jc_video_timing {shotList, segments[], takes[] {segmentId, assetId}, voices?, frameRate}` → `{shotList, voiceTrack, total_ticks, warnings[]}` — the rule of "Voiceover step contract"; no model call.
- `jc_video_captions {segments[], shotList, voiceTrack?, aspectRatio, language, secondLanguage?}` → `{captionSet, warnings[]}` — the rule of "Captions step contract"; calls the `transcription` role once per take and the `translation` role once when `secondLanguage` is set, each only when it has a route.
- `jc_video_audio {kind: "music" | "sfx", items[] {assetId, shotId?, description?, source, licence?, sourceUrl?}}` → `{musicTrack}` or `{sfxSet}` — probes durations and packs the typed artifact; no model call.
- `jc_video_assemble_plan {shotList, shotMedia[], voiceTrack?, captionSet?, musicTrack?, sfxSet?, canvas, frameRate, runId, project? {projectId, revision}}` → `{operations[] (at most 5,000 `{tool, args}`), sceneName, report}` — every rule of "Assembly into a real editor timeline"; no model call.
- `jc_video_checks {project {projectId, revision}, sceneName, brief, shotList, voiceTrack?, captionSet?, stepWarnings[]}` → `{findings[]}` — the deterministic checks of "Automated review against the brief"; reads the project at the stated `revision` through the host replica and fails with `CONFLICT` when the replica is at another revision; no model call.
- `jc_video_repair_plan {report, shotMedia[], assetPlan, shotList, project {projectId, revision}}` → `{items[] {shotId, capability: "video" | "image", prompt, instruction, params}, textOperations[] {tool, args}}` — the plan of the repair iteration; no model call.
These tools declare no ORC role in their manifests: the roles `vision`, `transcription` and `translation` are enhancements a tool uses when `jagentchill.orc.readiness.check` reports a route and does without otherwise, so a `tool` node of this family is never `skipped` for a missing route. A tool that takes a `project` is not served from cache across project revisions: `revision` is part of its arguments and therefore of the input hash (`agent-workflows.Determinism and cache reuse`). Invalid arguments return `INVALID_PARAMS` naming the field; a referenced asset that does not exist returns `NOT_FOUND`. Model calls made by these tools are costed, estimated and budgeted like any generation job (`generation-providers.Cost estimate`); for a tool node of a run the Cost guard applies its budget rule and the run's confirmed estimate replaces a per-call approval (`agent-workflows.Tool node`). [NEW]

#### Scenario: Timing without takes
- **WHEN** `jc_video_timing` is called with an empty `takes` list
- **THEN** it returns the shot list unchanged, a `voiceTrack` with no takes and `total_ticks` equal to the sum of shot durations

#### Scenario: Missing asset
- **WHEN** `jc_video_audio` receives an `assetId` that does not exist
- **THEN** it fails with `NOT_FOUND` and `details.assetId`

#### Scenario: Checks see the repaired project
- **WHEN** `jc_video_checks` runs in review iteration 2 after `repair_apply` moved the project from revision 14 to revision 15
- **THEN** its arguments carry `revision: 15`, its input hash differs from iteration 1, and it reads the repaired timeline

#### Scenario: Listed in the tool index
- **WHEN** the contract test lists the tools of the server's agent tool endpoint with MCP `tools/list`
- **THEN** the ten `jc_video_*` names appear in the list, in the tool manifest of `packages/protocol` and in the index of `agent-editing-tools`

### Requirement: Assembly into a real editor timeline
Assembly SHALL be two nodes. `assemble_plan` (`jc_video_assemble_plan`) computes, deterministically and without a model, the complete ordered list of editor operations from the artifacts; `assemble` is an `editor` node (`agent-workflows.Editor node`) in `mode: "operations"` with an empty configured list, which receives that list on its `operations` input (at most 5,000 operations per execution; a plan that needs more fails `assemble_plan` with `WORKFLOW_LIMIT_EXCEEDED` naming `editorOperations`), `commit: "apply"`, and `target: {create}` — or `target: "input"` when the run is bound to a project, in which case the operations add a new scene. No model takes part in assembly and assembly has no model cost. The operations build a real editor project whose stored fields are exactly those of capability `project-document` (`project-document.Canonical field list`); this requirement names fields and never restates their shape. Rules of the plan:

- **Project and scene.** Canvas from `aspectRatio` and `resolution`, frame rate from `frameRate` (`project-document.Project settings`); every time is an integer tick aligned to a frame. The scene is named "Video <run number>", with " (2)", " (3)"… appended until the name is unused in the project; the name is returned as `sceneName` and by the editor node's `scene` output.
- **Main track.** One element per shot in shot order, contiguous from tick 0, `duration` = the shot's re-timed duration. A video candidate becomes a `video` element with `trimStart: 0` and `trimEnd` = source length − shot duration (`project-document.Element common fields`), so the unused media stays available as trim handles. An image candidate becomes an `image` element whose motion preset is written as two keyframes at the element's first and last frame in the `animations` store (`project-document.Animation store`, paths of `project-document.Animatable property paths`): `slow-zoom-in` — `transform.scale.x` and `transform.scale.y` 1.00 → 1.08; `slow-zoom-out` — 1.08 → 1.00; `pan-left` / `pan-right` — scale 1.08 on both axes with `transform.position.x` travelling 4 % of the canvas width; `none` — no keyframe. A video shorter than its shot is followed by a freeze element holding its last frame (`project-document.Freeze field`, behaviour of `speed-retime.Freeze frame`) for the remainder. A `title-card` shot is a solid-colour element of the card's `backgroundColor` with one centred `text` element whose `content` is the card text.
- **Transitions.** Each shot's `transitionOut` other than "cut" is one record in the main track's `transitions[]` (`project-document.Track transition records`) between the two adjacent elements, with that transition's default duration shortened to what both elements allow.
- **Titles.** `onScreenText` as `text` elements on an overlay track named "Titles", each spanning its shot.
- **Voiceover.** One `audio` element per take on an audio track named "Voiceover" at the take's `start_ticks`, with `isVoice: true` (`project-document.Element audio level fields`).
- **Captions.** The `CaptionSet` as caption elements on one caption track (`project-document.Caption track fields`, `project-document.Caption element`), with the second language in the track's bilingual fields when present.
- **Music.** On an audio track named "Music": the track from tick 0 with element `volume` −18 dB, trimmed to the timeline length, or repeated end to end as further elements when shorter, the last element carrying `fadeOut.duration` of 1.5 s; the track's `ducking {enabled: true, amount: 12}` (`project-document.Track fields`, behaviour of `audio-editing.Equaliser, compressor and ducking`) lowers it under elements flagged `isVoice`.
- **Sound effects.** One `audio` element per cue on an audio track named "SFX" at its shot's start plus `offset_ticks`, at the element default volume, cut at the timeline end.
- **Shots without media.** A shot without a selected candidate is never replaced by dummy media: its place is a title card only when a person chose "Use a title card" at `check_assets_missing`; otherwise `assemble_plan` fails with `INVALID_PARAMS` naming the shot, which cannot happen after that checkpoint was approved.
- **Links.** Every created element carries `workflowLink` with `runId`, `stepId: "assemble"`, `shotId?` and `artifactVersionId`, and the project carries `workflowLink {runId}` (`project-document.Project provenance links`, `timeline-editing.Element provenance link`).

The changes are staged as one proposal and applied as one undo step labelled "Workflow: Assemble", by the lease rules of `agent-workflows.Editor node` (host principal `run:<runId>` when no device holds the lease). `assemble_plan` also returns `report {clips, freezes, titleCards, voiceElements, captionCues, musicElements, sfxElements, operationCount}`, shown in the node detail panel. [NEW] [CAPCUT CC-232, CC-233]

#### Scenario: Timeline structure
- **WHEN** assembly succeeds for a run with 6 shots, voiceover, captions, music and 2 sound effects
- **THEN** the project has 6 contiguous elements on the main track, a "Voiceover" track with one element per spoken segment, a caption track, one element on "Music" and 2 on "SFX"
- **AND** every element has a `workflowLink` whose `runId` is the run id

#### Scenario: Media longer than its shot
- **WHEN** a shot lasts 4 s and its selected clip lasts 10 s
- **THEN** the element has `trimStart` 0, `trimEnd` 6 s and `duration` 4 s, and the remaining media stays available as trim handles

#### Scenario: Media shorter than its shot
- **WHEN** a shot lasts 6 s and its selected clip lasts 5 s
- **THEN** the clip is followed by a 1 s freeze element of its last frame so the main track has no gap

#### Scenario: Still with a motion preset
- **WHEN** a 4 s shot holds an image with preset `slow-zoom-in`
- **THEN** the `image` element has keyframes on `transform.scale.x` and `transform.scale.y` of 1.00 at its first frame and 1.08 at its last frame

#### Scenario: Music shorter than the timeline
- **WHEN** the timeline lasts 45 s and the music lasts 30 s
- **THEN** the "Music" track holds the track followed by its first 15 s, ending with a 1.5 s fade-out at 45 s

#### Scenario: No model in assembly
- **WHEN** `assemble_plan` and `assemble` run for a 200-shot run
- **THEN** neither node records a route or a model cost, and two runs of `assemble_plan` on the same inputs return byte-identical operation lists

#### Scenario: One undo step
- **WHEN** the user opens the assembled project and presses Undo once
- **THEN** every element created by `assemble` is removed in that single step

### Requirement: Automated review against the brief
The `review` step SHALL be a loop of at most 3 iterations whose value is `{project {projectId, revision}, shotMedia[], report?, decision?, reviewFailed}`, starting from the output of `assemble` and the ShotMedia list of `assets_final`, with `continueWhile` "the last decision is not `approved` and `reviewFailed` is false". One iteration:

1. `review_checks` (`jc_video_checks`, `cache: "off"`) reads the project at the revision of the loop value and returns the deterministic findings: timeline duration outside the duration window of "Voiceover step contract" — `targetDuration_s` ± 10 % or ± 2 s, whichever is larger — is `REVIEW_DURATION_OUT_OF_RANGE` as a `warning`, and as a `blocker` only outside ± 25 %; project canvas ratio differs from `aspectRatio` (`blocker`); a gap or a zero-length element on the main track (`blocker`); a spoken segment without audio although the run has narration (`blocker`); a caption cue outside the timeline (`blocker`); summed peak audio level above −1 dBFS (`warning`); shot media below 50 % of the target short edge (`warning`); and one `warning` per recorded `fallbackApplied` and per step warning (`VOICEOVER_DURATION_DRIFT`, `VOICE_SHARED_BY_SPEAKERS`, `SUBJECT_REFERENCE_MISSING`, `CAPTIONS_APPROXIMATE_TIMING`, `CAPTIONS_TRANSLATION_UNAVAILABLE`, `MUSIC_UNAVAILABLE`, `SFX_UNAVAILABLE`).
2. `review_report` (`jagentchill-reviewer`, `cache: "off"`) receives the findings, the brief and the middle frame of each shot, rendered by `jc_frame_render` on the render host, and returns for each model check `{pass, confidence}`: relevance of the shot to its description, presence of each key message, absence of each `mustAvoid` item, readable on-screen text, language correctness. A failed check with confidence ≥ 0.7 is a `warning`, except `mustAvoid` and wrong language, which are `blocker`; a failed check below 0.7 is `info`. When no renderer is available (`RENDERER_UNAVAILABLE`) or the `vision` role has no route, the model checks are omitted with one `info` finding `REVIEW_FRAMES_UNAVAILABLE`. The result is the `ReviewReport` `{score (0–100), findings[] {severity: "blocker" | "warning" | "info", code, message, stepId?, shotId?, suggestedAction: "regenerate-shot" | "edit-text" | "tighten-script" | "none", correctedText?}}` with `score` = max(0, 100 − 25 × blockers − 5 × warnings); `edit-text` findings carry the `correctedText` for the shot's on-screen text, and the duration blocker carries `tighten-script`.
3. `review_gate` is an `approval` node that is not overridable, `cache: "off"`, with policy `{mode: "agent", threshold: 80, blockOnSeverity: "high", maxRounds: 2}` and the criteria "Meets the brief" (weight 40), "Technical correctness" (30), "Text and language" (20) and "Rights and safety" (10); its subject is the `ReviewReport` with the frames, and every `blocker` finding of the report is submitted as a finding of severity `high`, so a report with a blocker never passes. Its approval record is shared by the iterations of the loop (`agent-workflows.Approval node`): 3 iterations are round 1 and 2 revision rounds, which is why `maxIterations` is `maxRounds + 1`.
4. On `changes_requested` the repair body runs, wholly inside the loop and without re-running any node outside it: `repair_plan` (`jc_video_repair_plan`) turns each finding with `suggestedAction: "regenerate-shot"` whose shot's selected candidate was generated into one item `{shotId, capability, prompt, instruction: <the finding's message>, params}` taken from that shot's plan entry, and each `edit-text` finding into an editor operation that sets the `content` of the linked text element to `correctedText`; `repair_items` runs `repair_video` or `repair_image` per item (`generate`, same configuration as `shot_video` / `shot_image`, `cache: "off"`, one candidate); `repair_item_pack` turns each new candidate into the operation `ReplaceElementSource` of `timeline-editing.Element provenance link` for the main-track element whose `workflowLink.shotId` matches — position, effects, keyframes and transitions kept, `trimStart` and `trimEnd` preserved and clamped to the new source by that command's rule; `repair_apply` (`editor`, `mode: "operations"`, `target: "input"`, `commit: "apply"`) applies the items' operations and the text operations as one undo step labelled "Workflow: Repair <iteration>" and outputs the project at its new revision. Findings whose action is `tighten-script` or `none`, and `regenerate-shot` findings for stock, library, user or title-card shots, produce no item and stay in the report.
5. `review_pack` (`jc_video_pack`, kind `review`) builds the next loop value: the project of `repair_apply` when a repair ran, else the unchanged project; the ShotMedia list with every repair candidate appended to its shot and selected; the report and the decision. Its `shotMedia` output declares `publishAs {node: "assets_final", port: "shotMedia"}` (`agent-workflows.Data passing and output persistence`), so the repaired selection becomes the current ShotMedia artifact without marking `assemble_plan`, `assemble` or any execution of this loop `stale`.

When the review of the third iteration fails, `review_gate` escalates to a person instead of leaving the loop with unapproved work (`waitingReason: "escalated"`, `multi-agent-orchestration.Agent reviewer and escalation`), with the report attached and, on a finding with `tighten-script`, the action "Tighten script", which re-runs `script_revise` with the measured overrun as instruction through `agent-workflows.Re-run with downstream invalidation` once the run is paused. When `review_report` itself fails on every `reviewer` route, its `error` route reaches `review_pack`, which ends the loop with `reviewFailed: true`; `final_gate` then routes to `check_review_failed`, a `human`, non-overridable approval that shows the deterministic findings and offers "Approve without review" and "Retry review" (a re-run of `review_report`). A run MUST NOT reach `export` while its latest report has a `blocker`, or without a report, unless a person approved at the escalation, at `check_review_failed` or at `check_final`. [NEW]

#### Scenario: Clean review
- **WHEN** all checks pass
- **THEN** the report has score 100 and no `blocker`, and when the reviewer's weighted total is at least 80 `review_gate` records `approved` by the agent policy, the loop ends after one iteration and the run proceeds to `check_final`

#### Scenario: Score formula
- **WHEN** the report has 1 blocker and 3 warnings
- **THEN** `score` is 60

#### Scenario: Repair inside the loop
- **WHEN** the report has a `blocker` with `suggestedAction: "regenerate-shot"` for shot 3, whose media was generated
- **THEN** `repair_image` or `repair_video` produces one new candidate for shot 3, `repair_apply` replaces the source of the element linked to shot 3 keeping its position, and no execution of `assets`, `assemble_plan` or `assemble` is re-run or marked `stale`
- **AND** the ShotMedia artifact of `assets_final` gains the candidate, selected, as a new version with `author: "node"`

#### Scenario: Second iteration sees the repaired project
- **WHEN** iteration 2 starts after `repair_apply` moved the project from revision 14 to revision 15
- **THEN** `review_checks` and `review_report` execute again with `cacheHit: false` and read revision 15

#### Scenario: Blocker remains after the third review
- **WHEN** a blocker remains in iteration 3
- **THEN** `review_gate` is `waiting_approval` with reason `escalated`, shows the three review rounds, and the run does not reach `export` until a person decides

#### Scenario: Duration window
- **WHEN** the target is 30 s and the assembled timeline lasts 33.0 s
- **THEN** the duration check passes
- **AND** at 34.0 s it produces a `warning` with code `REVIEW_DURATION_OUT_OF_RANGE`, and at 38.0 s a `blocker` with `suggestedAction: "tighten-script"`

#### Scenario: Narrated run that obeyed every rule passes
- **WHEN** a 30 s narrated run has 8 shots, a script estimate of 26.8 s and takes that match the estimate
- **THEN** the assembled timeline lasts between 30.0 and 30.3 s and the duration check produces no finding

#### Scenario: Reviewer model fails
- **WHEN** `review_report` fails on every `reviewer` route
- **THEN** the loop ends with `reviewFailed: true`, `check_review_failed` waits for a person with the deterministic findings, and the run mode `auto` does not approve it

### Requirement: Export step
The `export` step SHALL be an `export` node (`agent-workflows.Export node`) with `preset: exportPreset`, `scene` = the `scene` output of `assemble` (the scene this run created — never a device's active scene), `destination: "project_exports"`, `onNoRenderer: "skip"` and `attachTo: "run_and_project"`, reached through `export_gate` only when `exportOnCompletion` is true and the final decision is `approved`. It runs on the host under `export-share.Host-initiated export` and never on a client. The codec is resolved by `server-api.Host encoder policy and codec table`: the default preset `match-project` yields MP4 with H.264 and AAC at the project's resolution and frame rate on a host where H.264 is available, and the node declares `codecPreference` H.264, then VP9 with Opus in WebM, so a host without an H.264 encoder still exports, with the run summary line "Exported as WebM (VP9) — this host has no H.264 encoder"; a preset the user chose explicitly whose codec is unavailable fails fast with `export/codec-unavailable` listing the alternatives, and the export never prompts. When the host stops advertising `remote-export` during the run the node ends `skipped` with reason `no_renderer`, the run succeeds, and the project stays openable. The exported file carries the metadata of `export-share.Provenance metadata`. A failed export ends the run `failed` at `export` with the project unchanged and the node action "Retry". [NEW]

#### Scenario: Export on completion
- **WHEN** `check_final` is approved and `exportOnCompletion` is true
- **THEN** a video file of the run's scene is produced, listed under the run's "Outputs" with size, duration and resolution, and downloadable from any paired client

#### Scenario: Bound project with other scenes
- **WHEN** the run was bound to a project that already had two scenes
- **THEN** the exported file contains only the scene named by `assemble`'s `scene` output

#### Scenario: Host without H.264
- **WHEN** the host's codec table lists VP9 and AV1 and no H.264 encoder, and `exportPreset` is the default
- **THEN** the export produces a WebM file with VP9 and Opus and the run summary states the substitution

#### Scenario: Export disabled
- **WHEN** `exportOnCompletion` is false
- **THEN** the run reaches `succeeded` after `check_final` with `export` in status `skipped`

#### Scenario: No renderer
- **WHEN** the render host is not available when `export` becomes ready
- **THEN** the node is `skipped` with reason `no_renderer`, the run is `succeeded`, and "Open in editor" works

#### Scenario: Export fails
- **WHEN** the encoder fails after the local retries of the export job
- **THEN** the run ends `failed` at `export` with the project still linked and a "Retry" action on the node

### Requirement: Run modes
The run setup form SHALL offer four run modes in its "Approvals" section, each a setting of the engine and not a behaviour of this capability (`agent-workflows.Contract for template capabilities`, item 3), shown with these labels and effects:

| Mode | Label | Engine setting | `script_approve` | Other overridable checkpoints |
|---|---|---|---|---|
| `checkpoints` (default for runs started by a person) | "Checkpoints" | none | `human` | as designed in "Checkpoints mapped to approval nodes" (`human`) |
| `reviewer` | "Reviewer agent" | `settings.approvalOverride {mode: "agent"}` | `agent` | `agent` |
| `auto` | "Automatic" | `settings.approvalOverride {mode: "auto"}`, with the template's per-node statement that this mode gives `script_approve` the policy `agent` | `agent` — the reviewer agent of `script-studio.Agent review rounds` | `auto` |
| `step` | "Step by step" | `settings.stepMode: true` | `human` | a human approval after every node |

"Automatic" is hands-free: with every required role configured, consent given and the budget sufficient, a run in that mode goes from one prompt to an assembled, reviewed and — when `exportOnCompletion` is true — exported video without any person acting. The script is the one step that keeps a reviewer in that mode (the agent reviewer, never a person), because everything downstream is paid for on the strength of it. A person is still needed in "Automatic" only where no policy can stand in: a shot without media (`check_assets_missing`), a review that failed three times or did not run (`review_gate` escalation, `check_review_failed`), a script whose agent review escalates under `script-studio.Escalation to a human`, and the items that always need a person under `multi-agent-orchestration.Common approval policy` (costs beyond thresholds or budgets, consent, out-of-project effects). Runs started by an automation use "Automatic" unless the instruction sets another mode. The mode can be changed while the run is `paused` or `waiting_approval` and applies to checkpoints not yet decided, including the one currently waiting when its node is overridable. No mode goes below the host minimum of `agent-workflows.Roles, permissions and agent classes`: designed policies are raised to it and the form states "Raised to <mode> by the host"; when the host minimum is `human`, `review_gate` is raised to `human` and `check_final`, having the same subject, is `skipped` with reason `redundant_approval` (`agent-workflows.Approval node`). A pending human decision never resolves by itself. [NEW]

#### Scenario: Checkpoint after script
- **WHEN** a run in mode `checkpoints` reaches `script_approve`
- **THEN** the node is `waiting_approval`, the script is shown for review and editing, and exactly one `script.review_required` notification is raised and no `workflow.approval_required` for the same item
- **AND** `shot_list` stays `pending` until a person approves

#### Scenario: Automatic mode is hands-free
- **WHEN** a person starts a run in mode `auto` with one prompt on a host where every required role has a route, and the reviewer agent scores the script above its threshold
- **THEN** the run reaches `succeeded` with a project and, when the host can export, a file, and no node was ever `waiting_approval` for a person

#### Scenario: Switch to automatic while waiting
- **WHEN** the user changes the mode from `checkpoints` to `auto` while `script_approve` waits for a person
- **THEN** the pending human review is withdrawn, the reviewer agent reviews that script version, and on a passing review `check_shot_list`, `check_assets` and `check_final` approve at once with `by.kind: "auto"`

#### Scenario: Step by step
- **WHEN** a run in mode `step` finishes any node
- **THEN** the run waits and shows that node's output with "Continue", "Edit", "Re-run" and "Cancel run"

#### Scenario: Host minimum agent
- **WHEN** the host minimum approval policy is `agent` and the user selects mode `auto`
- **THEN** overridable checkpoints are decided by the reviewer agent and the form states "Raised to Reviewer agent by the host"

#### Scenario: Host minimum human
- **WHEN** the host minimum is `human`
- **THEN** every checkpoint waits for a person, `review_gate` is decided by a person, and `check_final` is `skipped` with reason `redundant_approval`

### Requirement: Checkpoints mapped to approval nodes
Every checkpoint of the template SHALL be an approval of the engine carrying the common approval policy object of `multi-agent-orchestration.Common approval policy` (`mode`: `human`, `agent` or `auto`), with thresholds, rounds, escalation and the approval record as that requirement defines them. An approval decides and never produces data (`agent-workflows.Approval node`): every default decision is written by the deterministic node named in the column "Prepared by" before the checkpoint is reached, so the subject is complete under every policy, and a person changes it by editing the subject.

| Checkpoint | Subject | Reached when | Prepared by | Designed policy | Overridable | Under `agent` | Under `auto` |
|---|---|---|---|---|---|---|---|
| `check_brief` | `Brief` (editable) | `brief_gate`: `openQuestions` is not empty | `brief_defaults` — first suggested answer per question, recorded in `assumptions` | `human` | yes | criteria: faithful to the prompt and references (weight 50), assumptions reasonable (30), rights and safety (20); threshold 80; a failed review escalates to a person | approve |
| `script_approve` | script version | always | — | `human` | yes | `script-studio.Agent review rounds`; revisions through `script_revise` | not used: mode `auto` gives this node `agent` ("Run modes") |
| `check_shot_list` | `ShotList` (editable table) | always | — | `human` | yes | criteria: covers the script (weight 40), matches the brief (30), shot variety and continuity (20), rights and safety (10); threshold 80; a failed review escalates to a person with the findings and the action "Regenerate with findings" | approve |
| `check_assets_missing` | ShotMedia list (editable: per shot "Retry", "Use a title card", "Replace with my media", and candidate choice) | `assets_gate`: any shot has no candidate | `asset_select` | `human` | no | — | — |
| `check_assets` | ShotMedia list (editable: candidate choice) | `assets_gate`: no shot lacks media and at least one shot has more than one candidate | `asset_select` — the highest-scored candidate per shot, the first when scores are absent | `human` | yes | criteria: each selected candidate matches its shot (weight 70), rights and safety (30); threshold 80 | approve |
| `review_gate` | `ReviewReport` | every review iteration | — | `agent` (see "Automated review against the brief") | no | — | — |
| `check_review_failed` | deterministic findings and project preview | `final_gate`: the review did not run | — | `human` | no | — | — |
| `check_final` | `ReviewReport`, shown with the project preview | `final_gate`: the review ran | — | `human` | yes | criteria: the final cut matches the brief (weight 60), technical correctness (40); threshold 80 | approve — every report that reaches it has no `blocker` or was approved by a person at the escalation |

The outputs `changes_requested` of `check_brief`, `check_shot_list`, `check_assets` and `check_final` are unconnected: a failed agent review there has no revision path and therefore escalates to a person, who edits the subject or re-runs the producing step with the findings as instruction. "Retry" on a shot at `check_assets_missing` is the re-run of that shot's instance of `assets` ("Regenerate a step or a single shot"); "Use a title card" and "Replace with my media" are edits of the ShotMedia list. Human approvals are held and resolved by the server, which records the resolving device (`multi-agent-orchestration.Approvals resolved by the server`): a device with scope `jagentchill.generation.run` resolves them with `jagentchill.workflow.node.resolve`, except the script review, which is decided only through `jagentchill.script.review.resolve` (`agent-workflows.Script node`). An edit at a checkpoint creates an artifact version with `author: "user"`. Checkpoints appear in the run view's "Needs you" tab. Unattended runs follow `agent-workflows.Unattended runs`: a checkpoint that needs a person parks the run and raises one notification. [NEW]

#### Scenario: Brief without questions
- **WHEN** the `Brief` has no open questions
- **THEN** `check_brief` is `skipped` and `script_draft` starts with the `Brief` of `brief_defaults`

#### Scenario: Reviewer agent on the shot list
- **WHEN** mode `reviewer` is used and the reviewer scores the shot list 72 with a finding "segment 5 has no shot"
- **THEN** `check_shot_list` is `waiting_approval` with reason `escalated`, shows the finding, and "Regenerate with findings" re-runs `shot_list` with that finding as instruction

#### Scenario: Candidate choice by a person
- **WHEN** mode `checkpoints` is used and 3 shots have 2 candidates each
- **THEN** `check_assets` is `waiting_approval` with `waitingReason: "approval"`, lists those 3 shots first, and each already shows the candidate `asset_select` chose as selected

#### Scenario: Automatic selection needs no person
- **WHEN** mode `auto` is used and every shot has media
- **THEN** `asset_select` has set `selectedAssetId` on every shot before `check_assets` is reached, and `check_assets` approves at once without changing the ShotMedia list

#### Scenario: Shot without media in automatic mode
- **WHEN** mode `auto` is used and shot 3 has no candidate
- **THEN** `check_assets_missing` waits for a person with "Retry", "Use a title card" and "Replace with my media" for shot 3, and `check_assets` is `skipped`

#### Scenario: Unattended run needs a person
- **WHEN** an automation-started run in mode `checkpoints` reaches `script_approve`
- **THEN** the run is `waiting_approval` and parked, and exactly one `script.review_required` notification is raised

### Requirement: Viewable and editable step outputs
Every step output SHALL be a versioned artifact of `agent-workflows.Data passing and output persistence`, viewable and editable from `agent-workflows.Node detail panel` with these template-specific viewers: `Brief` as a structured form; the script in the editor of `script-studio.Structured editor`; `ShotList` as a table with one row per shot, every shot field editable inline and the words of its segments shown read-only with "Edit text" (which opens the segment in the script editor); `AssetPlan` as a per-shot method editor; ShotMedia as the "Shots" grid with candidates; `VoiceTrack` as a list with players and the speaker-to-voice map; `CaptionSet` as a cue list; `MusicTrack` and `SfxSet` as players with licence and source; `ReviewReport` as a findings list whose rows open the shot or step they concern. Editing an artifact uses `jagentchill.workflow.node.setOutput`, creates a version with `author: "user"`, keeps earlier versions (retention per that requirement) and applies "Downstream invalidation rules". An edit is refused with `CONFLICT` naming the running nodes, and the editor is read-only with the notice "Pause the run to edit", while any direct or transitive consumer of the artifact is `running` (`agent-workflows.Re-run with downstream invalidation`). [NEW] [CAPCUT CC-233]

#### Scenario: Edit the shot list at the checkpoint
- **WHEN** the user changes shot 2's description at `check_shot_list` and approves
- **THEN** a `ShotList` version 2 with `author: "user"` is stored and `asset_plan` consumes version 2

#### Scenario: Edit while a consumer is running
- **WHEN** `asset_plan` is `running` and the user opens the `ShotList`
- **THEN** the table is read-only and shows "Pause the run to edit"

#### Scenario: Restore a previous version
- **WHEN** the user selects version 1 of the `Brief` and presses "Restore this version"
- **THEN** a new current version equal to version 1 is created and the downstream steps are marked `stale`

### Requirement: Downstream invalidation rules
Changes to an artifact (edit, re-run, restore) SHALL mark dependants `stale` by `agent-workflows.Re-run with downstream invalidation` and by nothing else: this capability states no invalidation rule of its own. The engine compares, for every consumer, the `select` projection its input declares in "Typed step graph of the default workflow" (per item for a fan-out's `items`), so the consequences below are derived from that table and are listed here as the acceptance cases of the template:

| Change | Becomes `stale` | Unaffected |
|---|---|---|
| a shot's `description`, `shotSize`, `cameraMotion`, `subjects`, `setting` or `onScreenText` | `asset_plan`; then only the plan entries that changed: those shots' instances of `assets`, `subjects` items whose subject changed; `asset_select`, `assets_final`, `assemble_plan`, `assemble`, `review`, `export` | `timing`, `voiceover`, `captions`, `music`, `sfx` |
| a shot's `duration_ticks`, `index` or `segmentIds` (including reordering) | `timing`, `captions`, `assemble_plan`, `assemble`, `review`, `export` | `asset_plan` (its projection has none of these fields), `assets`, `voiceover`, `music`, `sfx` |
| a shot's `sound` | that shot's `sfx_take`, `sfx_pack`, `assemble_plan`, `assemble`, `review`, `export` | everything else |
| a shot's `transitionOut` | `assemble_plan`, `assemble`, `review`, `export` | everything else |
| a new approved script version | `shot_list` and everything after it; the `voice_take` items whose segment text or speaker changed (the fan-out's items are the spoken segments), `timing`, `captions` | `voice_take` items of unchanged segments; `music` |
| selecting another candidate of a shot, or "Replace with my media" | `assemble_plan`, `assemble`, `review`, `export` | every generation step |
| a speaker's voice in the `VoiceTrack` map | that speaker's `voice_take` items, `timing`, `captions`, `assemble_plan`, `assemble`, `review`, `export` | visuals, `music`, `sfx` |
| the `Brief` | every step that consumes it or a product of it; `music` only when `musicDirection` changed | `music` when `musicDirection` is unchanged |
| parameter `musicMood` | parameters are immutable in a run: a new mood is a re-run of `music` with an instruction | — |

A change to the `Brief` is made behind the confirmation "This will mark all following steps as outdated". Stale steps keep their artifacts with the label "Outdated", and "Apply changes" re-runs only stale steps, reusing the cache where a step's projection is unchanged — so a regenerated `shot_list` whose shots keep their visual fields re-uses the existing plan entries and media. [NEW]

#### Scenario: Single shot visual change
- **WHEN** the user edits shot 4's description in a completed run and "Apply changes" re-runs `asset_plan`, which returns the same entries for every other shot
- **THEN** only shot 4's instance of `assets` executes; the other instances are served unchanged
- **AND** `voiceover`, `timing`, `captions`, `music` and `sfx` keep status `succeeded` throughout

#### Scenario: Words change through the script
- **WHEN** the user presses "Edit text" on shot 2, changes one segment in the script editor, and the new script version is approved
- **THEN** that segment's `voice_take`, `timing` and `captions` become `stale` together with `shot_list` and its dependants, and the `voice_take` items of the other segments keep status `succeeded`

#### Scenario: Shot duration change leaves the plan alone
- **WHEN** the user changes shot 5's duration from 3 s to 4 s
- **THEN** `timing`, `captions`, `assemble_plan`, `assemble`, `review` and `export` become `stale` and `asset_plan`, `assets`, `music` and `sfx` do not

#### Scenario: Brief change
- **WHEN** the user edits the brief's key messages after the run completed
- **THEN** the confirmation "This will mark all following steps as outdated" is shown, and on confirm every step that consumes the brief or a product of it becomes `stale`, while `music` stays `succeeded` because `musicDirection` is unchanged

### Requirement: Regenerate a step or a single shot
Regeneration SHALL be the node re-run of `agent-workflows.Re-run with downstream invalidation` (`jagentchill.workflow.node.rerun`; for agents `jc_workflow_step {action: "rerun"}`), offered in this template as "Regenerate" on every step that is `succeeded`, `failed` or `stale`, and per item on one shot's media (the `path` of that item of `assets`), one voiceover take and one sound effect, with an optional instruction of 1–500 characters. A regeneration bypasses the cache, creates a new artifact version — for a shot, the new candidates are added to the existing ones by `assets_final`, which merges the instance's result into the current ShotMedia list — and marks dependants `stale` by "Downstream invalidation rules"; the one-shot case therefore re-runs exactly one fan-out instance and leaves every other shot untouched. It is refused with `CONFLICT` while a direct or transitive consumer is `running`, with the tooltip "Pause the run to regenerate"; the repair of the review loop is not a regeneration in this sense and never uses re-run ("Automated review against the brief"). The estimate confirmation for user actions is rule 6 of `generation-providers.Approval thresholds and spending caps` as applied by `agent-workflows.Re-run with downstream invalidation`, and the cost approval for agent calls is `agent-editing-tools.Cost guard`. [NEW] [CAPCUT CC-233]

#### Scenario: Regenerate one shot
- **WHEN** the user presses "Regenerate" on shot 5 with the instruction "night time"
- **THEN** only shot 5's instance runs, new candidates are added to shot 5, the other shots are untouched, and `asset_select`, `assets_final`, `assemble_plan`, `assemble`, `review` and `export` become `stale`

#### Scenario: Regenerate the shot list
- **WHEN** the user regenerates `shot_list` in a completed run
- **THEN** a confirmation lists the steps that become outdated — `check_shot_list`, `asset_plan`, `subjects`, `assets`, `asset_select`, `assets_gate`, `check_assets`, `assets_final`, `timing`, `captions`, `sfx`, `sfx_pack`, `assemble_plan`, `assemble`, `review`, `check_final`, `export` — and on confirm they become `stale`
- **AND** `voiceover` and `music` are not in the list

#### Scenario: Regenerate blocked by a running consumer
- **WHEN** `assemble` is `running` and the user presses "Regenerate" on a shot
- **THEN** the action is disabled with the tooltip "Pause the run to regenerate", and the same request through the RPC returns `CONFLICT` with `details.runningNodeIds` naming `assemble`

### Requirement: Candidates and selection
Shot media SHALL support 1–4 candidates per generation request (`candidatesPerShot`) and at most 12 retained candidates per shot, with exactly one `selectedAssetId` per shot that has media. Each generated or found candidate is scored 0–1 against the shot description by the `vision` role when it has a route. Selection is data written by nodes and people, never by an approval: `asset_select` selects, for every shot with candidates and no selection, the highest score (ties broken by creation order) or the first candidate when scores are absent; a person changes the selection at `check_assets` or `check_assets_missing` or afterwards in the "Shots" tab; `assets_final` is the node whose output is the current ShotMedia list consumed by assembly — it passes the decided list through, merges candidates added by a regenerated shot, and receives the repair candidates of the review loop through `publishAs`. The user can replace a shot's media with a file of `media-library` ("Replace with my media"), which becomes a candidate with `source: "user"` and is selected. Deleting the selected candidate selects the most recent remaining one; deleting the only candidate is not allowed; adding a 13th candidate removes the oldest unselected one. A selection change is an edit of the ShotMedia artifact of `assets_final`. [NEW] [CAPCUT CC-233]

#### Scenario: Choose among candidates
- **WHEN** a shot has 3 candidates and the user selects the second in an assembled run
- **THEN** the second is selected and `assemble_plan`, `assemble`, `review` and `export` become `stale`

#### Scenario: Automatic selection
- **WHEN** a run generates 2 candidates for a shot with scores 0.62 and 0.81
- **THEN** `asset_select` selects the candidate scoring 0.81 before any checkpoint is reached

#### Scenario: Selection without a vision model
- **WHEN** role `vision` has no route and a shot has 2 candidates
- **THEN** neither candidate has a score and the first is selected

#### Scenario: Last candidate
- **WHEN** a shot has exactly one candidate
- **THEN** its "Delete" action is disabled

#### Scenario: Thirteenth candidate
- **WHEN** a shot has 12 candidates and one more is generated
- **THEN** the oldest unselected candidate is removed and 12 remain

### Requirement: Cost and time estimate before start
The estimate of a run SHALL be computed by `agent-workflows.Cost and time estimate before a run` with these template assumptions, listed in the confirmation: shot count = ⌈`targetDuration_s` ÷ 4⌉ (or the script's shot count when `script` is supplied); spoken segments = shot count, or 0 when the resolved voice is `none`; sound effects = ⌈shot count ÷ 4⌉; `candidatesPerShot`; one script review round by the reviewer agent in mode `reviewer` or `auto`; one review iteration in the low figure and three iterations with one repaired shot each in the high figure; assembly at no model cost; steps of roles resolved to the bundled sound pack at cost 0; steps that will be skipped for a missing optional role at cost 0 and listed as "Will run without". The estimate is recomputed with real counts when `check_shot_list` succeeds; because nodes of a started run raise no per-call cost approval, the confirmed-estimate guard of `agent-workflows.Budgets during a run` pauses an attended run that would pass 120 % of the confirmed high estimate. Before "Run" is enabled the confirmation also lists every provider on the resolved routes that would receive project-derived content (reference files, frames, voice samples) and lacks consent under `generation-providers.Data leaving the machine`, each with "Allow for <provider>"; "Run" stays disabled until each is allowed or its step is switched off. Runs with origin `automation` skip the confirmation: their high estimate is checked against the instruction's cost limit (`automations.Run-workflow instruction`) and missing consent prevents the automation from being saved. Amounts, unknown-price handling and the agent-started path are those of the referenced requirement. [NEW]

#### Scenario: Estimate displayed
- **WHEN** the user presses "Estimate and run" for a 30 s run
- **THEN** the confirmation shows the total cost range in USD, the total time range, a per-step table and the assumption "8 shots"

#### Scenario: Estimate refined
- **WHEN** the approved shot list has 14 shots where 8 were assumed
- **THEN** the run's estimate is recomputed for 14 shots and shown in the run header within 2 s

#### Scenario: Consent missing
- **WHEN** the resolved `video` route's provider has no consent and the run has `subjectRefs`
- **THEN** the confirmation lists "Allow for <provider>" and "Run" is disabled until it is pressed

#### Scenario: Bundled sounds cost nothing
- **WHEN** roles `music` and `sfx` resolve to the bundled sound pack
- **THEN** the per-step table lists `music` and `sfx` at 0.00 USD with the source "Bundled sounds"

### Requirement: Customising the template into a new workflow
A user or an authoring agent SHALL be able to turn the template into a new workflow: "Duplicate to edit" on the template card, "Open on canvas" from a `draft` run, or `jc_workflow_create {templateId: "tpl.one-prompt-video"}` creates an ordinary user workflow (`meta.origin: "template"`, `meta.templateId` set) that opens in the free-form canvas of `workflow-diagram` and is edited with `agent-workflows.Graph operations` — nodes added, removed, reconnected, reassigned to other personas, agents or teams, and policies changed — under the engine's validation and size limits; the built-in template itself stays read-only. The step configurations of this capability are available in the node palette as presets named after their step ("Brief", "Shot list", "Asset plan", "Shots", "Voiceover", "Captions", "Music", "Sound effects", "Assemble", "Review"), each inserting the node or body with its ports, `select` projections, schema and default performer ("Shots" inserts `assets` with its whole shot body, `assets_join`, `asset_select`, `assets_gate`, both asset checkpoints and `assets_final`; "Assemble" inserts `assemble_plan` and `assemble`; "Review" inserts the `review` loop with its repair body, `final_gate`, `check_review_failed` and `check_final`). A copy declares its own required and optional roles, pre-filled from the template's, and a `team` node substituted for agent steps declares `outputSchema` as "ORC role assignment per step" states. A customised workflow keeps the "Shots" and "Preview" tabs of "Run view layout and live status" as long as it contains the "Shots" preset's `assets_final` node and an `assemble` preset node. Saving it as a template, exporting and importing it as a `.jcworkflow` file, and agent edits to it as proposals are those of `agent-workflows.Template parameters and save-as-template`, `agent-workflows.Import and export file format` and `agent-workflows.Proposal and diff for agent edits`. [NEW]

#### Scenario: Remove music
- **WHEN** the user duplicates the template, deletes the `music` and `music_pack` nodes and saves
- **THEN** validation reports no errors and runs of the copy produce a timeline without a "Music" track

#### Scenario: Type mismatch
- **WHEN** the user drags the `MusicTrack` output onto the `voiceTrack` input of `captions`
- **THEN** the connection is refused with `WORKFLOW_TYPE_MISMATCH` and nothing is applied

#### Scenario: Agent customises
- **WHEN** the user tells the Producer persona "add a translation step for Japanese captions before assembly" on a copy the agent did not create
- **THEN** the change arrives as a workflow proposal showing the added node and edges on the canvas, and is applied only when the user accepts

#### Scenario: Built-in stays read-only
- **WHEN** an edit batch targets `tpl.one-prompt-video`
- **THEN** it is refused with `WORKFLOW_READ_ONLY` and the UI offers "Duplicate to edit"

### Requirement: Run view layout and live status
Runs of the template SHALL use `agent-workflows.Run view` (header, live canvas, step list, bottom tabs) and add two template tabs next to "Outputs": **Shots** — a grid with one tile per shot (thumbnail of the selected candidate through `server-api.Authenticated media delivery` variant `thumb`, index, method, `fallbackApplied` chip, instance status and progress, candidate count) whose tile opens the candidates with "Use this", "Regenerate", "Replace with my media" and "Delete"; and **Preview** — the assembled project in the preview player once `assemble` has succeeded, with "Open in editor". The run summary of that view carries, besides the engine's content, the section "Skipped" with one line per skipped role (`skippedRoles[]` of the run record) in the wording of "Start on a host without optional providers", each with "Add a provider", and one line per substitution the run made (bundled sounds in place of generated audio, WebM in place of MP4, proportional caption timing). The canvas presents the template like any workflow; this capability defines no layout rule. Text of `agent` and `script` steps streams into the node detail panel while they run (`agent-workflows.Live run events`, `stream.text`). A tile reflects a status or progress change within 500 ms of the event arriving. A run started by a device that is revoked is cancelled with reason `device_revoked` together with the jobs it queued, by the engine's rule (`agent-workflows.Pause, resume and cancel`); its produced artifacts and project are kept. [NEW]

#### Scenario: Live progress
- **WHEN** shot 3's instance reports progress 0.4
- **THEN** its tile shows 40 % within 500 ms and the `assets` row of the step list shows its counts

#### Scenario: Preview after assembly
- **WHEN** `assemble` succeeds
- **THEN** the "Preview" tab plays the assembled project and offers "Open in editor"

#### Scenario: Shots before the plan exists
- **WHEN** the "Shots" tab is opened before `shot_list` has succeeded
- **THEN** it shows "Shots appear after the shot list is ready"

#### Scenario: Summary lists substitutions
- **WHEN** a run used the bundled music library and proportional caption timing
- **THEN** the summary lists both lines under "Skipped", each with "Add a provider"

### Requirement: Result opens in the editor with a link back
When `assemble` succeeds the run SHALL list the project under "Outputs" with "Open in editor", which opens it in the full editor on the current device after it is delivered by `cross-device-sync.Opening a synced project on another device`. The project's `workflowLink {runId}` (`project-document.Project provenance links`) makes the editor show the "From workflow" chip (`timeline-editing.Element provenance link`), which opens the run. Changes made in the editor never alter run artifacts and never mark nodes stale. When stale steps are re-run after the project was edited, "Apply changes" asks "Update this project" or "Create a new project". With "Update this project" `assemble_plan` receives the existing project and returns, in place of a full build, only `ReplaceElementSource` operations (`timeline-editing.Element provenance link`) for elements whose `workflowLink.artifactVersionId` no longer names the current version of its artifact: start time, track, transform, effects, masks, adjustments, `animations` and transitions are kept; `trimStart` and `trimEnd` are preserved and clamped to the new source's duration by that command's rule, so every part of a split clip keeps its own in-point; an element is shortened only when the new media is shorter than the span it shows, and is then flagged "Trim adjusted"; every element without a `workflowLink` is untouched. The operations are applied by `assemble` as one undo step through the lease rules of `agent-workflows.Editor node`. With the device preference `openWhenDone` (default on for the device that started an attended run) the editor opens automatically when the run succeeds and the app is in the foreground. When the project is in the Trash (`projects.Trash`), "Open in editor" is replaced by "Restore project", and after the 30-day retention by "Re-assemble". [NEW] [CAPCUT CC-232, CC-233]

#### Scenario: Open result
- **WHEN** a run succeeds and the user presses "Open in editor"
- **THEN** the editor opens the project with all tracks populated and a "From workflow" chip
- **AND** pressing the chip opens the run

#### Scenario: Re-run after manual edits
- **WHEN** the user added a text element in the editor, regenerated shot 2, pressed "Apply changes" and chose "Update this project"
- **THEN** only the clip linked to shot 2 changes its source, its position and effects are kept, and the user's text element is unchanged

#### Scenario: Split clip keeps its in-points
- **WHEN** the user split shot 2's 6 s clip at 2 s and shot 2 is then regenerated with a new 6 s clip and applied to this project
- **THEN** the first part shows source 0–2 s and the second part source 2–6 s of the new clip

#### Scenario: Project deleted
- **WHEN** the linked project is in the Trash
- **THEN** "Open in editor" is replaced by "Restore project"

### Requirement: Operation from mobile
On the compact form factor of `design-system.Breakpoints and layout constants`, on iOS and on Android alike, runs of the template SHALL follow `agent-workflows.Mobile presentation`, with the template tabs added to the run view's segmented control as "Canvas | Steps | Shots | Needs you | Outputs" (the control scrolls horizontally; "Preview" and "Log" are reached from "Outputs"), shot candidates browsed by horizontal swipe with a "Use this" button, step outputs opened as full-height sheets, the "Pipeline" section of the setup form as a full-width read-only canvas, and the "Will run without" and "To run this you need" lists shown above the primary button. Reference files are attached from the photo library, the camera and the document picker of the platform. Every action of this capability — starting a run, approving a checkpoint, answering brief questions, editing the shot list, selecting a candidate, regenerating, replacing media, retrying a failed shot, changing the run mode — is available by touch with targets of at least 44 × 44 pt on iOS and 44 × 44 dp on Android (the one target size of `i18n-accessibility.Touch target size and gesture alternatives`). Push notifications are those of `agent-workflows.Mobile presentation` and carry the notification kind and an opaque id only, so the device shows the right title and actions without content leaving the host. A phone is never the host: a run needs a paired host and keeps executing there when the app is closed. [NEW]

#### Scenario: Approve on a phone
- **WHEN** a run reaches a human `script_approve` while the phone app is backgrounded and push is enabled, on iOS or on Android
- **THEN** a push notification of kind `script.review_required` arrives and tapping it opens the script review with "Approve"

#### Scenario: App closed during a run
- **WHEN** the user starts a run on a phone and force-quits the app
- **THEN** the run keeps executing on the host and its current state is shown when the app reconnects

#### Scenario: Select a candidate by touch
- **WHEN** the user taps a shot in "Shots" and swipes through its candidates
- **THEN** "Use this" selects the visible candidate

### Requirement: Automation and agent control of runs
The template SHALL be startable unattended by the "Run workflow" instruction of `automations.Run-workflow instruction`, which supplies the parameters of "Run input contract" (the prompt as a text template with variables), a run mode (default "Automatic") and a required cost limit used as the run's `budgetUsd`. Such runs follow `agent-workflows.Unattended runs`: the estimate confirmation is skipped, the editor is never opened, a budget stop fails the node with `BUDGET_EXCEEDED`, and checkpoints behave per their policy (the automation editor shows "This run will wait for a person" when the chosen mode leaves a checkpoint's effective policy `human`); the export node declares the codec preference of "Export step", so an unattended run never stops on a missing encoder. An agent controls runs only through `agent-workflows.Workflow run tools`: reading state; writing the answers to the brief's questions into the `Brief` on the user's instruction (`jc_workflow_step {action: "set_output"}` on `brief_defaults` — the person, or the policy, still decides `check_brief`); selecting candidates and editing artifacts (`action: "set_output"`); regenerating a shot (`action: "rerun"` with the item's `path`); and cancelling. An agent cannot resolve a checkpoint whose policy is `human` (`WORKFLOW_HUMAN_REQUIRED`). Costed agent calls are governed solely by `agent-editing-tools.Cost guard`. The session an agent node or a chat-started run uses is private to its owner by default (design decision D7 and `server-api.Agent session relay`); a `viewer` sees the run's node states, and the text of an agent step only when the session was shared with the host. A run started in a chat session shows the inline run widget and the session's Diagram tab (`workflow-diagram.Inline widget in chat`, `workflow-diagram.Session workspace Diagram tab`) and reports back per `agent-workflows.Workflow started from a chat session`. [NEW]

#### Scenario: Scheduled run
- **WHEN** an automation fires the template with a cost limit of 3.00 USD
- **THEN** a run starts with origin `automation`, mode `auto` and `budgetUsd` 3.00, and the node that would exceed it fails with `BUDGET_EXCEEDED` without a provider call

#### Scenario: Agent regenerates a shot
- **WHEN** the user tells the agent "make shot 3 brighter" in the run's session
- **THEN** the agent calls `jc_workflow_step {action: "rerun", nodeId: "assets"}` with the `path` of item 2 and the instruction "brighter", and the Cost guard decides whether an approval card is shown

#### Scenario: Agent answers the brief questions
- **WHEN** the user tells the agent "answer the brief questions: audience is students" while `check_brief` waits under policy `human`
- **THEN** the agent writes the answer into the `Brief` with `set_output`, the checkpoint shows the new answer, and it stays `waiting_approval` until a person approves

#### Scenario: Agent cannot approve for a person
- **WHEN** an agent calls `jc_workflow_step {action: "answer"}` on `check_shot_list` whose policy is `human`
- **THEN** the call fails with `WORKFLOW_HUMAN_REQUIRED`

### Requirement: Content provenance of workflow outputs
Every media asset produced by a run SHALL enter the library with the provenance of `media-library.AI-generated asset provenance` (role, provider, model, prompt, seed, references, job id, cost) plus `{runId, stepId, shotId?}`, and every stock, bundled-pack or library candidate SHALL store licence name, author and source URL. The run's "Outputs" tab lists a "Credits" section with every non-generated source and its licence, copyable as text and attached to the project's description. Files exported by the `export` step carry the metadata of `export-share.Provenance metadata`, which computes the digital source type from the timeline's elements (an element whose `workflowLink` names a generated asset counts as AI-generated; `footageRefs`, stock, bundled-pack and library media do not); the visible label is the user's export option of `export-share.AI label burn-in` and is off for this step. [NEW]

#### Scenario: Credits for stock media
- **WHEN** a run used 3 stock clips
- **THEN** "Credits" lists 3 entries with provider, author, licence and URL

#### Scenario: Generated media marked
- **WHEN** a shot was produced by the `video` role
- **THEN** its media item in the library shows the "AI" badge with provider and model in its details

#### Scenario: Mixed sources on export
- **WHEN** the timeline holds generated clips and one clip from `footageRefs`
- **THEN** the exported file's metadata declares a composite that includes algorithmically generated media
