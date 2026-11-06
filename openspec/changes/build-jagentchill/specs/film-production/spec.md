## ADDED Requirements

### Requirement: Film entity
The system SHALL model a film as the root entity of Film Studio with fields: `id`, `title` (1–120 characters), `description` (0–2,000 characters), `aspectRatio` (one of 16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3, 4:5, 5:4, 21:9; default 16:9), `artStyle` (`cinematic-realistic`, `anime`, `comic`, `watercolour`, `3d-animation`, or `custom` with `artStyleText` of 1–500 characters; default `cinematic-realistic`), `language` (BCP-47 tag of story, dialogue and generated text; default = app locale), `frameRate` (24, 25 or 30; default 24), `videoResolution` (480p, 720p, 1080p short edge; default 720p), `imageResolution` (1K, 2K, 4K; default 2K), `styleBibleVersionId` (the current version of "Creative direction and style bible"; unset until that stage has run), `roleOverrides` (the per-container override of `orc-model-routing.Override precedence`, shape `{<roleId>[.<routeId>]: {profileId, thinking?, params?}}`), `capabilityOverrides` (per model: parameter values), `stageAssignments` (see "Stage assignment to agents and teams"), `approvalPolicies` (per checkpoint, see "Stage checkpoints and approval policies"), `budgetId` (a budget of scope `film` owned by `generation-providers.Budgets with hard stop`; unset = no film budget), `settings {voiceNarration (default true), requireVoice (default false; when on, a pipeline run needs a voice model, see "Pipeline roles and missing routes"), timelineUpdates: "automatic" | "ask", visibleAiLabel (default false), showAiBadges (default true)}`, `pipelineWorkflowId` (a customised pipeline, see "Film pipeline diagram view"; unset = the built-in template), `revision` (see "Film storage, permissions and Gateway dependency"), `createdAt_ms`, `updatedAt_ms`, `lastOpenedAt_ms`, `trashedAt_ms`. A film owns episodes, characters, locations, props, speakers, a style bible and jobs. The domain code lives in `packages/film` and its wire schemas in `packages/protocol`. Non-copy rule: the reference product named in `openspec/config.yaml` is a behaviour reference only — no code, schema text, field naming scheme, prompt wording or asset of it is copied; prompts live in `packages/film/prompts/` (one English source file per step, each naming the requirement it implements) and are written from this specification only, checked by the clean-room rule of `platform-skeleton.Clean-room prompt authoring`. [NEW]

#### Scenario: Create with defaults
- **WHEN** a film is created with only a title
- **THEN** it has aspect ratio 16:9, art style `cinematic-realistic`, language = app locale, 24 fps, 720p video, 2K images, no budget and no style bible

#### Scenario: Custom style without text
- **WHEN** `artStyle` is `custom` and `artStyleText` is empty
- **THEN** the save is rejected with a field error "Describe the custom style"

#### Scenario: Prompt file names its requirement
- **WHEN** the policy check of the build reads a file under `packages/film/prompts/`
- **THEN** the file's header names one requirement of this capability, and a file without that header fails the check

### Requirement: Episode and clip entities
An Episode SHALL have `id`, `filmId`, `number` (unique per film, 1–999), `title` (0–120 characters), `summary` (0–1,000 characters), `sourceText` (0–60,000 characters), `scriptId` (the episode's screenplay, a script document of `script-studio.Script document` with `links.filmLink {filmId, episodeId}`; unset until the script stage has run or a screenplay is imported), `screenplayOrigin` (`converted` or `imported`), `pipelineRunId` (the latest run of "Film pipeline template" for this episode), `timelineProjectId` (the linked editor project, unset until assembly), `subtitles` (`off`, `film-language`, `film-language-and-translation` with `translationLanguage`; default `film-language`), `musicChoice` (`unset`, `music`, `none`; see "Music cues"), `reviewReport` (the latest report of "Episode review"; unset until that stage has run), `revision`, and the computed, never stored `readiness` of "Stale markers and stage readiness". A film has 1–200 episodes. A Clip SHALL have `id`, `episodeId`, `index` (contiguous from 0), `sourceStart` and `sourceEnd` (character offsets into the episode `sourceText`; clips of an episode cover the text without gaps or overlaps), `summary` (0–400 characters), `locationId`, `characterRefs` (list of `{characterId, appearanceId}`), `propIds`, `sceneIds` (the scenes of the episode's script that hold this clip's screenplay, see "Screenplay conversion") and `screenplayEdited` (boolean). An episode has 0–60 clips. [NEW]

#### Scenario: Clip coverage invariant
- **WHEN** an episode has 5 clips
- **THEN** clip 0 starts at offset 0, each clip starts where the previous ends, and the last clip ends at the text length

#### Scenario: Episode number collision
- **WHEN** the user sets an episode number already used in the film
- **THEN** the change is rejected with "Episode 3 already exists"

#### Scenario: Screenplay lives in the script
- **WHEN** the script stage succeeds for an episode with 6 clips
- **THEN** the episode's `scriptId` names one script whose scenes are grouped in 6 groups, and each clip's `sceneIds` lists the scenes of its group

### Requirement: Panel entity
A Panel SHALL have: `id`, `clipId`, `index` (contiguous from 0 within the clip), `duration_ticks` (120,000–1,800,000; default 480,000), `shotSize` (extreme-wide, wide, full, medium, medium-close, close-up, extreme-close-up, insert), `cameraMotion` (static, pan-left, pan-right, tilt-up, tilt-down, push-in, pull-out, track, orbit, handheld), `action` (visual description, 1–1,200 characters), `sourceExcerpt` (the story text it depicts, 0–1,200 characters), `locationId` and `locationVariantId` (the variant of that location the panel is set in; defaults to the location's `selectedVariantId`), `cast` (0–8 entries `{characterId, appearanceId, slotId?, performance}` with `performance` of 0–300 characters; a `slotId` belongs to the panel's `locationVariantId`), `propIds` (0–8), `dramaticMode` (everyday, emotional, action, spectacle, suspense), `cinematography` `{composition, lighting, palette, atmosphere, lensNotes}` (each 0–300 characters), `imagePrompt` (0–2,000 characters), `videoPrompt` (0–2,000 characters), `firstLastPrompt` (0–2,000 characters), `linkToNext` (boolean), `continuity` (boolean, default false), `sketchVersionId`, `videoMode` (`text`, `image`, `first_last_frame`, `reference` — the mode names of `orc-model-routing.Routes with primary and ordered fallbacks`, routes `video.<mode>`), `useLipSync` (boolean, default true when a lip-sync version exists), `warnings[]`, `fieldsEdited` (set of field names changed by the user), `suggestions` (pass output held back for edited fields, keyed by field name) and the media state

`media {image, video, lipSync}`, each `{currentVersionId?, stale (boolean), staleReason?, pendingCandidateIds[] (0–4 AssetVersion ids offered and not yet used or dismissed)}`, plus `imageHistory {entries[] (AssetVersion ids, at most 20), position}` for "Working undo history for panel images".

Outdated state is therefore per medium: a panel can have a current image, an outdated video and no lip-sync at the same time. An episode has at most 600 panels and a clip at most 40. [NEW]

#### Scenario: Duration bounds
- **WHEN** the user enters a panel duration of 16 s
- **THEN** the field is clamped to 15 s and the hint "Maximum 15 s" is shown

#### Scenario: Panel limit per clip
- **WHEN** a clip has 40 panels and the user inserts another
- **THEN** the insert is refused with "A clip can have at most 40 panels"

#### Scenario: Per-medium outdated state
- **WHEN** a panel's image is replaced while it has a current video and a lip-sync version
- **THEN** `media.video.stale` and `media.lipSync.stale` are true, `media.image.stale` is false, and all three `currentVersionId` values are unchanged

#### Scenario: Slot of another variant
- **WHEN** a cast entry is saved with a `slotId` that belongs to a different variant than the panel's `locationVariantId`
- **THEN** the save is rejected with `INVALID_PARAMS` naming `cast[0].slotId`

### Requirement: Character, appearance, location and prop entities
A Character SHALL have `id`, `filmId`, `name` (1–60 characters, unique per film ignoring case), `aliases` (0–10), `introduction` (who the character is and how others address them, 0–600 characters), `profile` (`importance`: lead, supporting, minor; `genderPresentation`; `ageRange`; `era`; `occupation`; `traits` 0–8; `signatureFeature`; `paletteHex` 0–5 colours; `wardrobeNotes`), `profileConfirmed` (boolean), `speakerId`, `hubSourceId`, `artStyleOverride?` (same value set as the film's `artStyle`, used instead of it for this asset's images) and 1–8 Appearances. An Appearance has `id`, `index` (0 = primary), `label` (1–40 characters, e.g. "Default", "Wedding dress"), `changeNote` (what differs from the primary, 0–300 characters), `descriptionOptions` (1–3 texts of 1–1,500 characters), `selectedDescription` (index) and `sheetVersionId` (the selected sheet, an AssetVersion). A Location has `id`, `name` (unique per film), `summary`, `hasCrowd`, `artStyleOverride?`, 1–3 Variants each with `id`, `description`, `slots` (2–6 placement slots, each `{id, phrase}` with `phrase` of 1–160 characters anchored on a visible object) and `plateVersionId` (the selected plate, an AssetVersion), plus `selectedVariantId`. A Prop has `id`, `name` (unique per film), `summary` (for people), `description` (purely visual, for generation), `artStyleOverride?` and `sheetVersionId`. Characters, locations and props imported from the Asset hub also carry `hubSourceId` and `hubSourceRevision` ("Asset hub shared across films"). A film has at most 200 characters, 200 locations and 200 props. These are the film assets that `script-studio.Character, location and prop references` links to through `filmAssetId`. [NEW]

#### Scenario: Duplicate character name
- **WHEN** the user renames a character to a name that differs from an existing one only by letter case
- **THEN** the rename is rejected with "A character with this name already exists"

#### Scenario: Primary appearance protected
- **WHEN** the user tries to delete the appearance with index 0 while other appearances exist
- **THEN** the delete is refused with "Make another appearance primary first"

#### Scenario: Slot count
- **WHEN** a location variant is saved with one slot
- **THEN** validation fails with "A location needs 2 to 6 placement slots"

### Requirement: Speaker, voice and voice line entities
A Speaker SHALL have `id`, `filmId`, `name` (unique per film), `characterId` (unset for speakers such as a narrator), and `voice` (`{source: library | designed | cloned | hub, provider, voiceId, previewVersionId, description?, referenceVersionId?, consent? {deviceId, at_ms}, assignedBy: "user" | "default"}` or unset). A VoiceLine SHALL have `id`, `episodeId`, `order` (contiguous from 0), `kind` (`dialogue`, `inner`, `narration`), `speakerId`, `text` (1–600 characters), `translations {<BCP-47 tag>: text}` (the subtitle text in other languages, see "Subtitles"), `emotion` (0–200 characters; empty = automatic), `intensity` (0–1, default 0.5), `rate` (0.5–2.0, default 1.0), `panelId` (unset when unbound), `scriptLineId` (the line of the episode script it was taken from; unset for lines added by hand), `matchConfidence` (0–1, the confidence of the proposed panel binding; unset for manual bindings), `orphaned` (true when its `scriptLineId` no longer exists in the approved script; shown as "No longer in script"), `takes` (0–10) and `activeTakeId`. A Take is `{id, versionId (its audio AssetVersion), duration_ticks, stale (boolean), wordTimings? [{text, start_ticks, end_ticks}], timing: "aligned" | "proportional", created_ms}`. An episode has at most 1,000 voice lines. MusicCue and SfxCue entities are defined in "Music cues" and "Sound-effect cues". [NEW]

#### Scenario: Line bound to a panel
- **WHEN** a voice line is bound to a panel that is then deleted
- **THEN** the line's `panelId` becomes unset and the line is listed under "Unbound lines"

#### Scenario: Speaker without voice
- **WHEN** a line's speaker has no voice
- **THEN** the line's Generate action is disabled with the hint "Assign a voice to <speaker>"

#### Scenario: Line limit
- **WHEN** an episode has 1,000 voice lines and another is added
- **THEN** the add fails with `FILM_LIMIT_EXCEEDED` and `details {limit: "linesPerEpisode", max: 1000, actual: 1001}`

### Requirement: Versioning of generated assets
Every generated or uploaded media item (character sheet, location plate, prop sheet, panel sketch, panel image, panel video, lip-sync video, voice take, music cue audio, sound-effect audio) SHALL be stored as an immutable AssetVersion: `id`, `targetType`, `targetId`, `kind`, `version` (integer from 1), `blobSha256`, `mimeType`, `width`, `height`, `duration_ticks`, `origin` (`generated`, `edited`, `uploaded`, `hub`, `library`), `prompt`, `provider`, `model`, `parameters`, `referenceVersionIds`, `seed`, `jobId`, `costUsd`, `styleBibleVersion`, `score?` (0–1, the `vision` score against the target's description when one was computed), `state` (`candidate` — offered and not yet used; `current`; `retained` — a former current or a candidate another one was chosen over; `dismissed`), `candidateGroupId?` (the generation request it came from), `created_ms`, `pinned`. State is host data, so the candidate strip, "Use" and "Dismiss all" survive a reload and show the same on every paired device: "Use" makes a `candidate` `current` and the former `current` `retained`; "Dismiss all" makes the group's remaining candidates `dismissed`; a target has at most one `current` version per kind. A target keeps at most 20 versions per kind; when a 21st is created the oldest version that is neither `current` nor pinned is deleted, and when all are pinned or current the creation is refused with `FILM_VERSIONS_PINNED` and the message "Unpin a version to continue". The version history panel lists versions newest first with thumbnail, origin, model, time and cost in USD, and offers Preview, Compare (side by side with the current one), Restore (makes it current without deleting others), Pin and Delete. Two further version records exist: a StoryboardVersion `{id, clipId, number, panels[] (a snapshot of the clip's panel records including their `media` state), reason: "regenerate" | "restore", created_ms}` — at most 5 per clip, oldest removed first ("Storyboard step retry and invalidation") — and a FilmExport `{id, filmId, jobId, kind: "episode" | "film" | "archive", episodeIds[], presetId, container, videoCodec, duration_ticks, sizeBytes, created_ms, expires_ms}` for every finished export or archive, listed in Film settings ▸ "Exports". [NEW]

#### Scenario: Restore a version
- **WHEN** the user restores version 2 of a panel image whose current version is 5
- **THEN** version 2 becomes `current`, version 5 becomes `retained`, versions 1–5 all remain, and dependants follow "Stale markers and stage readiness"

#### Scenario: Retention
- **WHEN** a panel image already has 20 versions, none pinned, and a new one is generated
- **THEN** the oldest non-current version is deleted and the new one is stored as version 21

#### Scenario: Candidates on another device
- **WHEN** 3 candidates were generated for a panel on the desktop and the panel is opened on a phone
- **THEN** the phone shows the same 3 candidates in the strip, and "Use" on one of them updates the desktop within 2 s

### Requirement: Film storage, permissions and Gateway dependency
Film data — films, episodes, clips, panels, assets, asset versions, speakers, lines, cues, the style bible, storyboard versions, export records, the Asset hub and their history — SHALL exist only on the host: it is stored in the server's host SQLite store and blob directory (`server-api.Host data store`, content-addressed by sha256), is never part of a client's local project library, is not synced as a document by `cross-device-sync`, and is accessed only on the single client channel (`server-api.Single client channel`) through the methods of the `film` domain. Every film and every episode carries `revision`, an integer that increases with each committed change to it or to an entity it owns; the film's revision also increases when one of its episodes changes. The domain consists of exactly 32 methods — `jagentchill.film.list|get|create|update|duplicate|trash|restore|import|split|entity.update|entity.reorder|generate|version.select|image.edit|direction.get|direction.update|assemble|export|archive|batch.revert|timeline.pending|timeline.apply|timeline.revert|voice.clone|voice.proposal|hub.list|hub.update|hub.folder.update|hub.import|hub.save|subscribe|unsubscribe` — whose parameters, results and scopes are those of this table; "read" stands for scope `jagentchill.projects.read`, "write" for `jagentchill.projects.write`, "generate" for `jagentchill.generation.run`, "export" for `jagentchill.export.run`:

| Method `jagentchill.film.…` | Params | Result | Scope |
|---|---|---|---|
| `list` | `{query?, cursor?, limit (1–50), trashed?}` | `{films[], nextCursor?}` | read |
| `get` | `{filmId?, episodeId?, hub?: boolean, include[] (the values of `jc_film_get` plus `exports`, `activity`, `pendingTimeline`), ids?[]}` | the snapshot with `revision` | read |
| `create` | `{title, story?, aspectRatio?, artStyle?, language?}` | `{filmId, episodeId}` | write |
| `update` | `{filmId, baseRevision, patch}` (film fields and settings; `budgetId` needs `jagentchill.config.write`) | `{revision}` | write |
| `duplicate` | `{filmId, title?}` | `{filmId}` | write |
| `trash`, `restore` | `{filmId}` | `{}` | write |
| `import` | `{filmId, blobSha256 | text, format: "auto" | "text" | "fountain" | "docx"}` | `{kind: "screenplay" | "prose", characters, proposal?}` | write |
| `split` | `{filmId, method: "markers" | "model", targetCount?, proposal?, apply?: boolean}` | `{proposal}` or `{episodeIds[]}`; `model` returns `{jobId}` | write; generate for `model` |
| `entity.update` | `{filmId?, hub?: boolean, baseRevision, changes[] (1–100; the change shape of `jc_film_update`, including `restore_version`, `bind`, `import_from_hub`, `save_to_hub`)}` | `{revision, batchId, created[]}` | write |
| `entity.reorder` | `{filmId, entity, parentId, orderedIds[]}` | `{revision}` | write |
| `generate` | `{filmId?, hub?: boolean, episodeId?, kind, targets, options?, confirm? {estimateUsd}}` (kinds and options of `jc_film_generate`) | `{batchId, jobIds[], skipped[], estimateUsd}` | generate |
| `version.select` | `{filmId?, hub?, targetType, targetId, kind, versionId? | step?: "undo" | "redo", action?: "use" | "dismiss_group" | "pin" | "unpin" | "delete" | "keep_stale"}` | `{revision}` | write |
| `image.edit` | `{filmId?, hub?, targetType, targetId, instruction (1–500), referenceBlobSha256s?[] (0–4), referenceAssetIds?[] (0–4)}` | `{jobId}` | generate |
| `direction.get` | `{filmId, version?}` | the style bible version and the version list | read |
| `direction.update` | `{filmId, action: "draft" | "update" | "regenerate_section" | "set_current", patch?, section?, instruction?, version?}` | `{version}` or `{jobId}` | write; generate for `draft` and `regenerate_section` |
| `assemble` | `{filmId, episodeId, reassemble?: boolean, alsoReorder?: boolean, withoutMissing?: boolean}` | `{jobId}`; the job result is the assembly report | generate |
| `export` | `{filmId, scope: "episode" | "film", episodeIds[], gapTicks?, presetId?, codecPreference?[], captions?: "burn-in" | "sidecar" | "none"}` | `{jobId, exportId}` | export |
| `archive` | `{filmId?, hub?, folderId?, episodeIds?[], include[]}` | `{jobId, exportId, estimatedBytes}` | export |
| `batch.revert` | `{filmId, batchId}` | `{revision}` or `CONFLICT` with `details.fields[]` | write |
| `timeline.pending` | `{filmId, episodeId}` | `{changes[] {id, panelId?, lineId?, cueId?, kind, created_ms}, applied[] {batchId, label, created_ms, revertible}}` | read |
| `timeline.apply` | `{filmId, episodeId, changeIds?[] (all when absent), discard?: boolean}` | `{batchId?}` | write |
| `timeline.revert` | `{filmId, episodeId, batchId}` | `{}` or `CONFLICT` with `details.elements[]` | write |
| `voice.clone` | `{filmId?, hub?, speakerId | hubVoiceId, blobSha256, consent: true}` | `{jobId}` | generate |
| `voice.proposal` | `{filmId?, hub?, speakerId?, proposalId, action: "use" | "save_to_hub" | "discard"}` | `{revision}` | write |
| `hub.list` | `{folderId?, type?, query?, cursor?, limit}` | `{folders[], assets[], nextCursor?}` | read |
| `hub.update` | `{baseRevision, changes[]}` (the change shape of `entity.update` on hub assets and voices) | `{revision}` | write |
| `hub.folder.update` | `{op: "create" | "rename" | "move" | "delete", folderId?, parentId?, name?}` | `{folderId}` | write |
| `hub.import` | `{filmId, hubAssetIds[] (1–50), onClash: "replace" | "keep_both" | "skip"}` | `{created[], skipped[]}` | write |
| `hub.save` | `{filmId, entity, id, folderId?}` | `{hubAssetId}` | write |
| `subscribe`, `unsubscribe` | `{filmId | hub: true}` | `{revision}` | read |

`trash` and `restore`, and `subscribe` and `unsubscribe`, are each two methods. This table is the method list that `server-api.RPC domain ownership` names for the domain; a handler under `jagentchill.film.` outside it fails the contract test `rpc-ownership`, and a requirement of this capability that needs another method adds it to this table. Three things are deliberately not film methods: a pipeline checkpoint is resolved with `jagentchill.workflow.node.resolve` — also from the stage banner — and the script approval with `jagentchill.script.review.resolve`; files are uploaded through the blob routes of `server-api` (scope `jagentchill.media.write`; this is the route that carries a reference audio, a sketch or an imported script file) and then attached by `blobSha256` in `entity.update`, `import`, `image.edit` or `voice.clone`; and media bytes and their variants are downloaded only through "Media access and cache" with scope `jagentchill.media.read`. Changes are announced by the event `jagentchill.film.updated` on stream `film:<filmId>` (and `film:hub`) with payload `{filmId, revision, changes[] {entity, id, op}}`; events are not replayed, so a client that sees a `seq` gap or reconnects refetches the affected snapshot (`server-api.Event delivery`). Clients keep a read-only cache of the last fetched film list and of opened film snapshots: without a connected host the Film Studio list shows that cache with the banner "Connect to a host to work on films" and every create, edit and generate control disabled. A call without the scope fails with `SCOPE_DENIED`; `viewer` devices see live state with mutating controls hidden; creating or raising a film budget needs `jagentchill.config.write`. Jobs and pipeline runs a device started are cancelled with reason `device_revoked` when that device is revoked (`server-api.Job cancellation and restart recovery`); what they already produced is kept. Text edits are saved 800 ms after the last keystroke; a save rejected because of a newer `revision` (`CONFLICT`) shows "Changed on another device" with "Reload" and "Overwrite". Deleted films go to the typed Trash of `projects.Trash` as kind `film`, and deleted panel media as kind `film-panel-asset`, both for 30 days and both stored on the host. [NEW]

#### Scenario: Offline studio
- **WHEN** the host connection is lost while a film is open
- **THEN** the banner appears within 5 s, inputs become read-only, and unsaved text is kept locally and saved on reconnect

#### Scenario: Conflicting edit
- **WHEN** two devices edit the same panel field and the second save carries an outdated revision
- **THEN** the second device sees "Changed on another device" with "Reload" and "Overwrite"

#### Scenario: Viewer device
- **WHEN** a `viewer` device opens a film
- **THEN** no Generate, Edit or Delete control is rendered and job progress still updates live

#### Scenario: Editor cannot raise the budget
- **WHEN** an `editor` device calls `jagentchill.film.update` with a `budgetId` change
- **THEN** it fails with `SCOPE_DENIED` and the dialog shows "Ask an admin device to raise the budget"

#### Scenario: Upload then attach
- **WHEN** the user picks a 40 MiB reference recording for cloning
- **THEN** the file is uploaded through the blob route under scope `jagentchill.media.write` and `jagentchill.film.voice.clone` receives only its `blobSha256`

#### Scenario: Method outside the table
- **WHEN** the contract test `rpc-ownership` finds a handler `jagentchill.film.panel.rewrite`
- **THEN** the test fails, because the domain has exactly the 32 methods of the table

#### Scenario: No local copy
- **WHEN** a film is created while the device's local project library is inspected
- **THEN** the library contains no file or row for the film; only the read-only cache holds its snapshot

### Requirement: Media access and cache
Film media SHALL be delivered to clients only through `server-api.Authenticated media delivery` (route `GET /jagentchill/v1/media/{kind}/{id}/{variant}`, per-request signature, no credential in a URL): grids, cards, candidate strips, pickers and the diagram use variant `thumb` (320 px); players, the panel editor, compare views and the edit dialog use `preview` (720p proxy for video, 1,440 px long edge for images); "Download", ZIP archives and assembly use `original`. Variants are produced on the host when an AssetVersion is stored (kind `media.proxy` jobs) and a card shows a neutral skeleton until its `thumb` exists. Clients keep fetched variants in a least-recently-used cache inside the cache budget of `project-storage.Cache management`, keyed by `blobSha256` and variant, so a version is fetched once per device. Downloads are resumable by `Range` on every platform. A fetch that fails shows a broken-media tile with "Retry"; a `SCOPE_DENIED` or revoked device shows the requires-pairing state instead of media. [NEW]

#### Scenario: Grid uses thumbnails
- **WHEN** the Storyboard stage shows 120 panel cards
- **THEN** each card requests the `thumb` variant of its current image and no `original` is requested

#### Scenario: Cached variant
- **WHEN** the user reopens a film whose panel thumbnails were fetched earlier and are still in the cache
- **THEN** no media request is made for those thumbnails

#### Scenario: Fetch failure
- **WHEN** a `preview` request fails with a network error
- **THEN** the player area shows a broken-media tile with "Retry" and the rest of the stage stays usable

### Requirement: Studio navigation and stage tabs
The app SHALL provide the destination "Film Studio" in the primary navigation of `app-shell-navigation.Primary navigation`, with the routes of `app-shell-navigation.Route map`: the film list, a film at episode and stage (`…/film/[filmId]/episode/[episodeId]/[stage]` with `stage` one of `story`, `script`, `assets`, `storyboard`, `video`, `voice`, `sound`, `timeline`), the film-level Direction screen (`…/film/[filmId]/direction`) and the Asset hub (`…/film/hub`, `…/film/hub/[folderId]`). A film opens in a workspace with: a top bar (film title, episode selector with add / rename / reorder / delete, and the actions Direction, Asset hub, Tasks with a count badge, Diagram, Run pipeline, Film settings); a stage tab strip with exactly these tabs in order — Story, Script, Assets, Storyboard, Video, Voice, Sound, Timeline; the stage content; and a collapsible chat pane on the left that hosts the film's `chat-agent` session. The visual language, type scale, row heights, radii and colours are the tokens of `design-system`; this capability states no literal token value. The current episode and stage are part of the route so that reload, deep link and Back restore them. On desktop and web the eight stage tabs are bound to the actions `film.stage.1` … `film.stage.8`, whose default bindings are listed only in `keyboard-shortcuts`. [NEW]

#### Scenario: Deep link
- **WHEN** the user opens a link to film F, episode 2, stage `storyboard`
- **THEN** the workspace opens on that episode with the Storyboard tab selected

#### Scenario: Keyboard stage switch
- **WHEN** the user triggers the action `film.stage.4` in the workspace
- **THEN** the Storyboard tab becomes active

#### Scenario: Delete the only episode
- **WHEN** a film has one episode and the user chooses Delete episode
- **THEN** the action is disabled with the tooltip "A film needs at least one episode"

### Requirement: Film list and creation
The Film Studio list SHALL show films as cards (cover = first selected panel image or character sheet, title, episode count, panel count, last opened time, spend to date in USD) sorted by last opened, with search by title, pagination of 24 per page, and per-film actions Open, Rename, Duplicate (copies configuration, style bible and assets but not episodes' panels and media), Film settings, Move to trash. "New film" (scope `jagentchill.projects.write`) opens a dialog asking for title, aspect ratio, art style and language, and offers three starts: "Paste or write a story", "Import a script file" and "Start from an idea" (opens "AI story expansion"). A fourth start is the home composer with target `film` (`app-shell-navigation.Home composer`) and the chat command `/film <story>`: text of at least 1 character creates a film with default settings, title = the first 60 characters of the text, and the text stored as episode 1 `sourceText`; a text shorter than 600 characters opens "Write with AI" pre-filled with it, a longer one opens the Story stage with the estimate of "Create script" shown; nothing billable starts without confirmation. The empty state shows "No films yet" with the "New film" button. Creating a film never depends on model routes: when `jagentchill.orc.readiness.check` reports missing roles for the pipeline, the dialog shows the two lists of "Pipeline roles and missing routes" — "To run the pipeline you need:" for missing required roles and "Will run without:" for missing optional ones — with a link to `orc-model-routing.ORC settings page`, and creation remains possible. [NEW]

#### Scenario: Empty state
- **WHEN** no film exists
- **THEN** "No films yet" and a "New film" button are shown

#### Scenario: Missing roles warning
- **WHEN** the `video` role has no route, `image` has one, and the user creates a film
- **THEN** the film is created and the notice "Will run without: video (no video model configured)" links to ORC settings

#### Scenario: Start from the home composer with a long story
- **WHEN** the user sends 2,400 characters with composer target `film`
- **THEN** a film titled with the first 60 characters is created, the text is episode 1's source text, the Story stage opens with the "Create script" estimate, and no job has been queued

#### Scenario: Start from the home composer with an idea
- **WHEN** the user sends "a lighthouse keeper finds a message in a bottle" with composer target `film`
- **THEN** the film is created and "Write with AI" opens with that idea pre-filled

### Requirement: Film configuration and models via ORC
Film settings SHALL let a device with scope `jagentchill.projects.write` edit title, description, aspect ratio, art style, language, frame rate, default video and image resolution, the film switches of "Film entity", per-role model selection, stage assignments and checkpoint policies; the budget row is editable only with scope `jagentchill.config.write`. Model selection uses `orc-model-routing`: for each role used by the studio (`director`, `screenwriter`, `storyboard`, `image`, `video`, `voice-tts`, `voice-design`, `lipsync`, `music`, `sfx`, `vision`, `translation`, `transcription`, `editor`, `reviewer`) the dialog shows the globally resolved provider and model — with the access method that serves it: an installed agent CLI, sign-in with the provider (OAuth) or an API key, all three of equal standing — and allows choosing another configured profile for this film, stored in `roleOverrides` as the per-container level of `orc-model-routing.Override precedence`. The image routes `image.character`, `image.location`, `image.prop`, `image.panel` and `image.edit`, the video routes `video.text`, `video.image`, `video.first_last_frame` and `video.reference`, and the speech routes `voice-tts.narration` and `voice-tts.dialogue` are the route ids of `orc-model-routing.Routes with primary and ordered fallbacks`; each defaults to its role and can be overridden per film. Model parameters (resolution, duration, frames per second, native audio, reasoning level) are offered only with the values the model declares in `generation-providers.Capability metadata`. Changing aspect ratio or art style after images exist shows a confirmation stating how many images become outdated and does not delete them. [NEW] [JAD]

#### Scenario: Per-film override
- **WHEN** the user selects a different profile for `image.panel` in one film
- **THEN** panel images of that film use that profile and other films are unaffected

#### Scenario: Props use their own route
- **WHEN** the user overrides `image.prop` and generates a prop sheet
- **THEN** the job's route is `image.prop` with the overriding profile, not `image.location`

#### Scenario: Capability-limited parameter
- **WHEN** the selected video model declares resolutions 480p and 720p
- **THEN** the film's video resolution select offers only 480p and 720p and a stored 1080p value is replaced by 720p with a notice

#### Scenario: Change aspect ratio with existing images
- **WHEN** the film has 30 panel images and the user changes the ratio from 16:9 to 9:16
- **THEN** a confirmation states "30 panel images will be marked outdated" and on confirm they are marked outdated, not deleted

### Requirement: Film pipeline template
The per-episode film pipeline SHALL be the built-in template `tpl.film-episode` of `agent-workflows.Built-in templates`: a workflow document executed by the engine of `agent-workflows`, with no engine, scheduler, state machine, retry policy, cache, budget ledger or approval mechanism of its own (`agent-workflows.Contract for template capabilities`). Every stage is a closed set of nodes of that engine; run and node statuses are exactly those of `agent-workflows.Run state machine` and `agent-workflows.Node state machine`.

**Parameters.** `filmId` (`EntityRef` of kind `film`, required), `episodeId` (`EntityRef` of kind `episode`, required), `fromStage` and `toStage` (stage ids of the table; defaults `direction` and `export`), `targets` (`missing` — default —, `outdated`, `failed`, `all`), `candidates` (1–4, default 1) and `confirmOverwrite` (boolean, default false). There is no separate export switch: the range decides. This capability registers the `EntityRef` resolvers of `agent-workflows.Ports and data types` for the kinds `film` and `episode`; each returns the object's `revision` of "Film storage, permissions and Gateway dependency", so no execution is served from the cache of a run that saw other studio data.

**Node inventory.** The shipped document `packages/workflow/templates/film-episode.json` contains the trigger `start` and exactly the nodes of this table — the single node inventory of the template, which `agent-workflows.Built-in templates` cites — and MUST pass `agent-workflows.Validation rules`. `(p)` marks a `parallel` node, whose body nodes follow in brackets and whose `join` is named after it; `→ x_apply` means the `agent` node is followed by the `tool` node `x_apply` calling `jc_film_apply`.

| Stage id | Nodes in dispatch order (type) | Default performer or role | Result written to the studio |
|---|---|---|---|
| `direction` | `direction_gate` (`branch`); `direction_load` (`tool`); `direction` (`agent`) → `direction_apply`; `check_direction` (`approval`); `direction_commit` (`tool`, `jc_film_apply`) | `jagentchill-director` (`director`) | a style bible draft; made current by `direction_commit` |
| `script` | `script_gate` (`branch`); `script_load` (`tool`); `characters`, `locations`, `props` (`agent`, concurrent) → `characters_apply`, `locations_apply`, `props_apply`; `clips` (`agent`) → `clips_apply`; `screenplay` (p) [`screenplay_clip` (`agent`) → `screenplay_clip_apply`], `screenplay_join`; `script_approve` (`script`, operation `approve`) | director for the three analyses; `jagentchill-screenwriter` (`screenwriter`) for `clips` and `screenplay_clip` | film assets, clips, the episode script |
| `profiles` | `profiles_gate` (`branch`); `profiles_load` (`tool`); `profiles_default` (`tool`, `jc_film_apply`); `check_profiles` (`approval`); `appearances` (p) [`appearance_text` (`agent`) → `appearance_text_apply`], `appearances_join` | director | confirmed profiles, appearance descriptions |
| `assets` | `assets_gate` (`branch`); `assets_load` (`tool`); `asset_images` (p) [`asset_image` (`tool`, `jc_film_generate`)], `asset_images_join`; `assets_default` (`tool`, `jc_film_apply`); `assets_choice_gate` (`branch`); `check_assets` (`approval`) | routes `image.character`, `image.location`, `image.prop` | asset image candidates and selections |
| `storyboard` | `storyboard_gate` (`branch`); `storyboard_load` (`tool`); `storyboard` (p) [`plan` → `plan_apply`; `cinematography` → `cinematography_apply` ‖ `acting` → `acting_apply`; `detail` → `detail_apply` (all `agent`)], `storyboard_join`; `voice_lines` (`agent`) → `voice_lines_apply`; `check_storyboard` (`approval`) | `jagentchill-storyboard` (`storyboard`); screenwriter for `voice_lines` | panels, voice lines |
| `panel_images` | `panel_images_gate` (`branch`); `panel_images_load` (`tool`); `panel_images` (p) [`panel_image` (`tool`, `jc_film_generate`)], `panel_images_join`; `panel_images_default` (`tool`, `jc_film_apply`); `panel_images_choice_gate` (`branch`); `check_panel_images` (`approval`) | route `image.panel` | panel images |
| `panel_videos` | `panel_videos_gate` (`branch`); `panel_videos_load` (`tool`); `panel_videos` (p) [`panel_video` (`tool`, `jc_film_generate`)], `panel_videos_join` | routes `video.<mode>` | panel videos |
| `voice` | `voice_gate` (`branch`); `voice_load` (`tool`); `voices_default` (`tool`, `jc_film_apply`); `voices_choice_gate` (`branch`); `check_voices` (`approval`); `voice_takes` (p) [`voice_take` (`tool`, `jc_film_generate`)], `voice_takes_join`; `subtitle_translation` (`tool`, `jc_film_generate`) | routes `voice-tts.narration`, `voice-tts.dialogue`; `transcription`; `translation` | speaker voices, takes with word timings, translated line text |
| `lipsync` | `lipsync_gate` (`branch`); `lipsync_load` (`tool`); `lipsync` (p) [`lipsync_panel` (`tool`, `jc_film_generate`)], `lipsync_join` | role `lipsync` | lip-sync videos |
| `sound` | `sound_gate` (`branch`); `sound_load` (`tool`); `score` (`agent`) → `score_apply` ‖ `sfx_suggest` (`agent`) → `sfx_suggest_apply`; `sound_default` (`tool`, `jc_film_apply`); `check_sound` (`approval`); `sound_audio` (p) [`sound_cue` (`tool`, `jc_film_generate`)], `sound_audio_join` | director; roles `music`, `sfx` | the music choice, music and sound-effect cues with audio |
| `assembly` | `assembly_gate` (`branch`); `assemble` (`tool`, `jc_film_assemble`) | none (no model) | the episode's timeline project |
| `review` | `review_gate` (`branch`); `review_checks` (`tool`, `jc_film_checks`); `review` (`agent`) → `review_apply`; `final_gate` (`branch`); `check_final_blocked` (`approval`, `human`, not overridable); `check_final` (`approval`) | `jagentchill-reviewer` (`reviewer`); `vision` | the episode's review report |
| `export` | `export_gate` (`branch`); `export` (`export` node) | none | exported file |

That is 101 nodes besides `start`. Rules common to every stage:

1. **Stage gate.** `<stage>_gate` fires `run` only when the stage is inside `fromStage` … `toStage` and is not already done (rule 6); otherwise every node of the stage ends `skipped` with reason `out_of_range` or `already_done`. Stages run in table order; inside a stage, nodes without a data dependency on each other run concurrently.
2. **Loader.** `<stage>_load` calls `jc_film_get` with `cache: "off"` and returns the stage's input snapshot — exactly the studio data the stage reads, each part with its content hash: source text, the style bible version, asset descriptions and selected images, clip scenes, the script's `approvedVersionId`, panels, lines, cues — and, for a stage with a fan-out, the item list for the run's `targets` (at most 1,000 items, rule 7). The snapshot is the only data input of the stage's `agent` and media nodes, so an execution's `inputHash` changes exactly when the studio data it depends on changes, and after an edit of the story "Create script" drafts from the edited text instead of returning the previous run's result.
3. **Agent nodes never write the studio.** Every `agent` node returns its stage result through `agent-workflows.Agent node structured output` and is followed by its `_apply` node, which validates the result ("Structured step output") and merges it into the studio by the rules of the stage's own requirement as one mutation batch ("Undo and redo of studio edits").
4. **Default decisions.** An approval decides and produces no data (`agent-workflows.Approval node`). The `_default` nodes write the decision a checkpoint would otherwise need a person for into the studio, as one revertible mutation batch labelled "Pipeline defaults", before the checkpoint is reached; `direction_commit` makes the approved draft current after `check_direction`. "Stage checkpoints and approval policies" states what each writes.
5. **Media nodes.** Each body node of a media fan-out is a `tool` node calling `jc_film_generate {wait: true}` for one item, with `timeout_s: 3,600`, `onError: "continue"` and `candidates` from the run parameter; it declares the ORC role of its kind (`asset_image`, `panel_image` → `image`; `panel_video` → `video`; `voice_take` → `voice-tts`; `lipsync_panel` → `lipsync`; `sound_cue` → `music` or `sfx`; `subtitle_translation` → `translation`). The tool returns `{status: "pending", jobIds}` and the node attaches to those jobs (`agent-workflows.Tool node`): queueing behind the film's and the provider's limits does not count toward the timeout, a re-dispatch re-attaches through the idempotency key so no second provider request exists, a job failure is a non-retryable tool error carrying the provider error class, and retries are only those of `generation-providers.Retry policy`. For the run principal the Cost guard applies its scope and budget rules and the run's confirmed estimate stands in for per-call approval (`agent-workflows.Tool node`, `agent-workflows.Budgets during a run`). A model whose metadata declares deferred delivery is never used by a pipeline run: when it is the only candidate of a route the item is skipped with reason `deferred_model`. Fan-outs run with `failurePolicy {minSuccessRatio: 0}`, concurrency 4 (video and lip-sync 2) and report per-item state in `counts`; failed items are listed in the run summary with "Retry failed" and do not fail the run.
6. **Work that exists is not redone.** With `targets: "missing"` a stage whose result exists is `already_done`: `direction` when the film has a current style bible (`direction` is film-scoped: it runs inside an episode's pipeline only for a film without one, or when the run was started with `fromStage: "direction"` and `targets: "all"`); `script` when the episode has an approved script version; `profiles` when no profile is unconfirmed and every expected appearance has descriptions; `sound`'s nodes `score`, `sfx_suggest`, `sound_default` and `check_sound` when the episode's `musicChoice` is not `unset`. Fan-outs list only what is missing: `screenplay` clips without scenes, `storyboard` clips without panels (`voice_lines` runs only when a clip was storyboarded in this run or the episode has no lines), media fan-outs the items without a current version. `outdated` lists items whose medium is `stale`; `failed` the items whose last job failed; `all` lists everything and re-drafts the agent stages, replacing existing work by each stage's own merge rules — behind the stage's confirmation in the UI ("Storyboard and media of this episode will be marked outdated", "n images and m videos will be marked outdated"), and from a tool call or an automation only with `confirmOverwrite: true` (otherwise the start fails with `INVALID_PARAMS` naming `confirmOverwrite`).
7. **Engine limits.** At the studio's own limits — 60 clips, 600 panels, 1,000 voice lines and 1,000 cues per episode — every fan-out lists at most 1,000 items and a whole-range run stays under 9,000 node executions, inside `agent-workflows.Size limits` (1,000 items, 20,000 executions). The one list that can be longer, the assets of a large film, is segmented by the loader: `assets_load` lists the first 1,000 assets used by the episode in studio order and reports `remaining`, which the run summary shows as "n assets left — run the Assets stage again".
8. **Roles.** "Pipeline roles and missing routes" declares the required and optional roles; a node of an optional role without a route ends `skipped` with reason `no_route` and the pipeline continues.

**Starting.** The pipeline run of an episode is started by "Run pipeline" (whole range), by the stage buttons "Create script" (`script` … `script`) and "Create storyboard" (`storyboard` … `storyboard`), by `jc_film_run_script`, `jc_film_run_storyboard` and `jc_workflow_start`, and by `automations.Run-film-step instruction`; at most one non-terminal pipeline run exists per episode (a second start returns `CONFLICT` with the running run's id). Single-item and batch generation started from stage screens are jobs, not runs (see "Task execution, limits and recovery"); both paths execute the same stage operation of `packages/film`. Preparation before the pipeline — episode splitting, global asset analysis, AI story expansion — and the single-item helpers of the stages run as jobs of kind `film.step`. [NEW]

#### Scenario: One engine
- **WHEN** an episode pipeline run and a one-prompt video run execute at the same time
- **THEN** both appear in the run history of `agent-workflows.Run history, logs and retention` and are paused, resumed and cancelled by the same methods

#### Scenario: Stage range
- **WHEN** the user presses "Create storyboard" on an episode
- **THEN** a run of `tpl.film-episode` starts with `fromStage` and `toStage` both `storyboard`, and every node of the other twelve stages is `skipped` with reason `out_of_range`

#### Scenario: Fan-out skips finished items
- **WHEN** 10 of 24 panels already have a current image and the `panel_images` stage starts with `targets: "missing"`
- **THEN** the fan-out has 14 items and its counter reads "0/14"

#### Scenario: Whole-range run on a second episode keeps the film's look
- **WHEN** the film has a current style bible and "Run pipeline" is pressed on episode 2
- **THEN** every node of `direction` is `skipped` with reason `already_done`, no new style bible version exists, and no image or video of episode 1 is marked outdated

#### Scenario: Hand-made script and storyboard are kept
- **WHEN** an episode has an approved script and panels on all of its clips, and the whole range is run with `targets: "missing"`
- **THEN** `characters`, `clips` and `screenplay_clip` do not run, the `storyboard` fan-out lists 0 clips, and no existing panel is changed

#### Scenario: Overwrite from an automation needs the flag
- **WHEN** an automation starts the template with `targets: "all"` and without `confirmOverwrite: true`
- **THEN** the start fails with `INVALID_PARAMS` naming `confirmOverwrite` and nothing is changed

#### Scenario: Edited story is not served from cache
- **WHEN** "Create script" ran yesterday, the user changed the episode's story text and presses "Create script" again with `targets: "all"`
- **THEN** `script_load` returns a snapshot with a different source-text hash, `characters`, `clips` and `screenplay_clip` execute with `cacheHit: false`, and the applied result reflects the edited text

#### Scenario: Second run on the same episode
- **WHEN** a pipeline run of the episode is `waiting_approval` and the user presses "Run pipeline" again
- **THEN** no run is created and the existing run opens

#### Scenario: Limits at the largest episode
- **WHEN** an episode has 60 clips, 600 panels, 1,000 voice lines and 1,000 cues and the whole range runs with `targets: "all"`
- **THEN** no fan-out lists more than 1,000 items and the run records fewer than 20,000 node executions

#### Scenario: Template validates
- **WHEN** the conformance suite loads `film-episode.json`
- **THEN** validation returns no errors, the document contains `start` and exactly the 101 node ids of the table with the stated types, and `filmId` and `episodeId` are `EntityRef` parameters

### Requirement: Pipeline roles and missing routes
The template SHALL declare its roles to the engine (`agent-workflows.Required and optional roles of a run`, `orc-model-routing.Required and optional roles`) and SHALL start on a host that has only the required ones. `requiredRoles`: `director`, `screenwriter`, `storyboard` and `reviewer` — each counted only when a stage in the requested range uses it —; `{anyOf: ["image", "video"]}` when the range includes `assets`, `panel_images` or `panel_videos`; and `{role: "voice-tts", when: the film setting requireVoice is on}`. `optionalRoles`: `image`, `video`, `voice-tts`, `voice-design`, `lipsync`, `music`, `sfx`, `vision`, `transcription`, `translation`. The start gate is the engine's: a missing required role refuses the start with `NO_ROUTE` and the setup checklist, shown in the "Run pipeline" dialog as "To run this you need:" with one line per role linking to `orc-model-routing.ORC settings page`, where a provider is connected by an installed agent CLI, by sign-in with the provider (OAuth) or by an API key. A missing optional role never blocks; the dialog lists "Will run without:" and the run does this instead:

| Missing | What the pipeline does | Line in the dialog, the run summary and the Timeline stage |
|---|---|---|
| `image` (with `video` present) | `asset_image` and `panel_image` items are `skipped (no_route)`; assets contribute text descriptions only; `panel_video` uses mode `reference` or `text` | "Skipped: images (no image model configured)" |
| `video` (with `image` present) | `panel_video` items are `skipped (no_route)`; the `lipsync` fan-out lists nothing; assembly uses each panel's still with the camera-motion keyframes of "Assembly of an episode into a timeline project" | "Skipped: video (no video model configured)" |
| `voice-tts` | `voices_default`, `check_voices` and `voice_take` items are skipped; the `lipsync` fan-out lists nothing; subtitles are placed from the lines' panel bindings | "Skipped: voices (no voice model configured)" |
| `lipsync` | `lipsync_panel` items are `skipped (no_route)`; assembly uses the panel videos as generated | "Skipped: lip-sync (no model configured)" |
| `transcription` | takes are stored with `timing: "proportional"` | "Subtitle timing is approximate (no transcription model)" |
| `translation` | `subtitle_translation` is `skipped (no_route)`; subtitles are in the film language only | "Skipped: translated subtitles (no translation model)" |
| `vision` | `_default` nodes select the first candidate; the model checks of "Episode review" are omitted | "Skipped: automatic picture checks (no vision model)" |
| a generative `music` model | each music `sound_cue` resolves to the built-in provider `jc-sound-pack`: the track of `audio-editing.Bundled sound pack` whose mood matches the cue, stored as a take with `origin: "library"` | "Music: from the bundled music library" |
| a generative `sfx` model | each sound-effect `sound_cue` resolves to `jc-sound-pack` by keyword search over the effect catalogue; a cue without a match stays without audio | "Sound effects: from the bundled sound library" |
| `voice-design` | not used by the pipeline (voice design is a manual action, disabled with "No voice design model configured") | — |

The roles `music` and `sfx` therefore always have a route (`orc-model-routing.Default profiles from the enabled catalogue`), and a substitution by the sound pack is always stated, never silent. Every skipped role is recorded in the run's `skippedRoles[]`; the run summary and the Timeline stage list the lines above, each with "Add a provider". The Film Studio never refuses to create or open a film because of a missing role: creation shows the same two lists as a notice. [NEW]

#### Scenario: Host with a language model and an image model only
- **WHEN** a host has routes for `director`, `screenwriter`, `storyboard`, `reviewer` and `image` only, and "Run pipeline" is confirmed for an episode with a story
- **THEN** the dialog lists "Will run without:" video, voices, lip-sync, approximate subtitle timing and automatic picture checks, and the run starts
- **AND** it ends `succeeded` with an assembled timeline of still panels carrying camera-motion keyframes, subtitles placed by panel, music and sound effects from the bundled library, and — when the host can export — an exported file, with no pause and no failed node

#### Scenario: Timeline stage names what was skipped
- **WHEN** that run has finished
- **THEN** the Timeline stage lists "Skipped: lip-sync (no model configured)" with "Add a provider"

#### Scenario: No model for pictures at all
- **WHEN** neither `image` nor `video` has a route and the range includes `panel_images`
- **THEN** the start is refused with `NO_ROUTE` and the checklist line "Add an image or video model"

#### Scenario: Voices required by the film
- **WHEN** the film setting `requireVoice` is on and `voice-tts` has no route
- **THEN** the start is refused with the checklist line "Add a voice model"

### Requirement: Episode review
The `review` stage SHALL check the assembled episode and produce a `ReviewReport` `{score (0–100), findings[] {severity: "blocker" | "warning" | "info", code, message, panelId?, lineId?, cueId?}}` that is stored with the episode and shown in the Timeline stage, each finding with the action "Open panel" (or "Open line", "Open cue") that opens the item it concerns. `review_checks` calls the read-only tool `jc_film_checks` with `cache: "off"`; it reads the episode, its assembly report and the timeline project at its current revision, makes no model call, and returns:

| Code | Condition | Severity |
|---|---|---|
| `FILM_REVIEW_NOT_ASSEMBLED` | the episode has no timeline project, or it is in the Trash | blocker |
| `FILM_REVIEW_PANEL_OMITTED` | a panel had neither image nor video and was left out | blocker |
| `FILM_REVIEW_CANVAS_MISMATCH` | project canvas or frame rate differs from the film | blocker |
| `FILM_REVIEW_DIALOGUE_OVERLAP` | two elements on "Dialogue" overlap | blocker |
| `FILM_REVIEW_SUBTITLES_MISSING` | `subtitles` is not `off`, the episode has placed lines and the project has no cue for one of them | blocker |
| `FILM_REVIEW_LINE_UNPLACED` | a line is unbound, has no take, or its panel was omitted | warning |
| `FILM_REVIEW_PANEL_STILL` | a panel is shown as a still because it has no video | warning |
| `FILM_REVIEW_CUE_UNPLACED` | a music or sound-effect cue has no audio or was not placed | warning |
| `FILM_REVIEW_MEDIA_OUTDATED` | a placed medium is `stale` | warning |
| `FILM_REVIEW_STUDIO_CHANGES_PENDING` | studio changes are waiting to be applied to the timeline | warning |
| `FILM_REVIEW_ROLE_SKIPPED` | one per role of the run's `skippedRoles[]` | info |

`review` (`jagentchill-reviewer`, `cache: "off"`) then receives those findings and, for each main-track clip, its middle frame rendered by `jc_frame_render` on the render host, and returns per panel `{pass, confidence}` for: the frame shows the panel's `action`; each cast member matches the selected sheet of its appearance; no entry of the style bible's `avoid[]` is visible; subtitles at that frame are readable. A failed check with confidence ≥ 0.7 is a `warning` (`FILM_REVIEW_ACTION_MISMATCH`, `FILM_REVIEW_IDENTITY_MISMATCH`, `FILM_REVIEW_SUBTITLE_UNREADABLE`), except a visible `avoid[]` entry, which is a `blocker` (`FILM_REVIEW_STYLE_VIOLATION`); below 0.7 it is `info`. Episodes with more than 120 main-track clips are sampled: every clip is checked for `avoid[]` in batches of 40 frames per model call, and the other three checks cover the first panel of every film clip plus every fifth panel. When no renderer is available or `vision` has no route, the model checks are omitted with one `info` finding `FILM_REVIEW_FRAMES_UNAVAILABLE`. `score` = max(0, 100 − 25 × blockers − 5 × warnings), the formula of `prompt-to-video-workflow.Automated review against the brief`. `review_apply` stores the report. This template has no automatic repair: a report with a `blocker` always goes to `check_final_blocked`, which only a person decides, whatever the run mode ("Stage checkpoints and approval policies"), who opens the panels concerned, fixes them in the studio and re-runs the range `assembly` … `review`. When `review` itself fails on every route, `review_apply` stores the deterministic findings alone with the `blocker` finding `FILM_REVIEW_MODEL_UNAVAILABLE`, so `check_final_blocked` waits for a person. [NEW]

#### Scenario: Omitted panel blocks
- **WHEN** 2 panels had no media and the episode was assembled without them
- **THEN** the report has 2 `FILM_REVIEW_PANEL_OMITTED` blockers, `score` is at most 50, and each finding's "Open panel" opens that panel in the Storyboard stage

#### Scenario: Clean episode
- **WHEN** every deterministic and model check passes
- **THEN** the report has score 100 and `check_final` approves by policy in run mode `auto`

#### Scenario: Blocker waits for a person in automatic mode
- **WHEN** the report has a `FILM_REVIEW_STYLE_VIOLATION` blocker and the run mode is `auto`
- **THEN** `check_final_blocked` is `waiting_approval` for a person, `check_final` is `skipped`, and `export` does not start

#### Scenario: Review after a repair reads the new timeline
- **WHEN** the user regenerated the flagged panel, the change was applied to the timeline and `assembly` … `review` is run again
- **THEN** `review_checks` executes with `cacheHit: false` and no longer reports the finding

### Requirement: Stage assignment to agents and teams
Every stage with a performer SHALL be assignable in Film settings ▸ "Stage assignments" (`stageAssignments`, one row per stage of "Film pipeline template" that has `agent` nodes: `direction`, `script`, `profiles`, `storyboard`, `sound`, `review`) to one of: the default persona; another persona or user-created agent (`{kind: "agent", agentId}`); or a fixed-role Team (`{kind: "team", teamId}`) of `multi-agent-orchestration.Team model`, with the shipped `film-studio` Team of `multi-agent-orchestration.Shipped team templates` offered first. The switch "Produce with the Film studio team" assigns all six stages to `film-studio` in one action. When a pipeline run is instantiated (the instantiation hook of `agent-workflows.Contract for template capabilities`), a stage assigned to an agent keeps its `agent` nodes with that agent as performer, and a stage assigned to a Team has each of its `agent` nodes replaced by one `team` node (`agent-workflows.Team node`) with the same id whose `outputSchema` is the replaced node's output schema. By the rule of that requirement the `team` node then has the same typed outputs as the `agent` node: each property is taken from the accepted result's `deliverables[]` by name; a deliverable larger than the hand-off limit — for example a `plan` result for 40 panels — is passed as a reference to an artifact, never truncated; and a missing or schema-invalid deliverable fails the node with `WORKFLOW_AGENT_OUTPUT_INVALID`. The following `_apply` node is unchanged and applies the same checks as for a persona. The node's brief is the stage's instruction with the loader's snapshot as input, its acceptance criteria are the invariants of the stage's requirement, and the brief's route category is `planning` for `direction`, `research` for the analyses and `appearance_text`, `script` for `clips`, `screenplay_clip` and `voice_lines`, `ui` for the storyboard passes, `script` for `score` and `sfx_suggest`, and `audit` for `review`. A Team-assigned `storyboard` or `script` stage creates one team run per item and pass (up to 240 team runs for 60 clips): its fan-out therefore runs with concurrency 1, and the estimate shown before the run states the number of team runs. Team shape, hand-back, dissent, result approval and limits are those of `multi-agent-orchestration.Team model`, `multi-agent-orchestration.Common approval policy`, `multi-agent-orchestration.Tree limits` and `multi-agent-orchestration.Runtime eligibility for team roles`; team members are disposed when their run ends; cost of every member is attributed to the stage node. Assigning a workspace agent or a Team containing one follows the agent-class rule of `agent-workflows.Roles, permissions and agent classes` (`admin` device, or `editor` when the host allows it). Media stages have no performer: they are assigned by ORC routes ("Film configuration and models via ORC"). [NEW]

#### Scenario: Storyboard by the team
- **WHEN** the `storyboard` stage is assigned to `film-studio` and the stage runs
- **THEN** the run shows `team` nodes `plan`, `cinematography`, `acting` and `detail` with the Team's member count, at most one clip is in work at a time, and the resulting panels are written by `plan_apply`, `cinematography_apply`, `acting_apply` and `detail_apply` exactly as for a persona

#### Scenario: Large result travels by reference
- **WHEN** the Team's accepted `plan` result for a 40-panel clip is larger than the hand-off limit
- **THEN** the deliverable is passed as a reference to an artifact and `plan_apply` receives all 40 panels

#### Scenario: Team result fails the schema
- **WHEN** the Team's accepted result for `plan` lacks `duration_ticks` on a panel
- **THEN** the `plan` node fails with `WORKFLOW_AGENT_OUTPUT_INVALID` naming the path and no panel is written

#### Scenario: Workspace agent needs an admin
- **WHEN** an `editor` device on a host without "Allow workspace agents for editors" assigns a workspace agent to `script`
- **THEN** the save fails with `SCOPE_DENIED` on that row

### Requirement: Stage checkpoints and approval policies
The pipeline's checkpoints SHALL be approvals of the engine that carry the common approval policy object of `multi-agent-orchestration.Common approval policy` (`mode`: `human`, `agent`, `auto`; thresholds, rounds, escalation and the approval record as that requirement defines them); the designed policy of each is stored per film in `approvalPolicies` and editable in Film settings ▸ "Approvals". An approval decides and never produces data: whatever a checkpoint would need a person to choose is first written to the studio by the deterministic node in the column "Prepared by", so the checkpoint reviews a complete state under every policy, and a person changes that state in the stage screen before approving.

| Checkpoint (name in the UI) | Subject | Prepared by — what it writes | Designed policy | Under `agent` (role `reviewer`) | Under `auto` | Skipped when |
|---|---|---|---|---|---|---|
| `check_direction` ("Look approval") | the drafted style bible (editable); for a film that has only an idea, also the 3 alternatives | `direction_apply` — the draft of the first-ranked alternative | `human` | criteria: consistent with the story (weight 40), internally consistent (30), usable as generation instructions (30); threshold 80 | approve | — |
| `script_approve` | the episode script | — | effective policy of `script-studio.Approval policy and precedence`, `overridable: true` | `script-studio.Agent review rounds` | `script-studio.Auto policy` | — |
| `check_profiles` ("Character review") | unconfirmed character profiles (editable) | `profiles_default` — marks every unconfirmed profile for confirmation and fills `importance` with `supporting` where it is empty | `human` | criteria: profiles consistent with the story (weight 60), complete enough to draw (40); threshold 80 | approve | no profile is unconfirmed |
| `check_assets` ("Asset images") | assets whose image was selected by default among several candidates | `assets_default` — for every asset without a selected image, selects the candidate with the highest `vision` score against its description, or the first successful one when scores are absent | `human` | criteria: each selected image matches its description (weight 70), rights and safety (30); threshold 80 | approve | `assets_choice_gate`: no asset has more than one unreviewed candidate |
| `check_storyboard` ("Storyboard review") | panels and voice lines of the episode (editable) | — | `human` | criteria: covers the screenplay (weight 40), continuity of place and cast (30), shot variety (20), rights and safety (10); threshold 80; `maxRounds` 2 | approve | no panel was created or changed in this run |
| `check_panel_images` ("Panel images") | panels whose image was selected by default among several candidates | `panel_images_default` — for every panel without a current image, makes the highest-scored (else first successful) candidate current | `human` | criteria as `check_assets` | approve | `panel_images_choice_gate`: no panel has more than one unreviewed candidate |
| `check_voices` ("Voices") | speakers that received a default voice or still have none | `voices_default` — for every speaker with lines and no voice, assigns the first voice of `generation-providers.Voice catalogue` for the film language whose gender tag matches the character's `genderPresentation` (any voice of the language when none matches), not yet used by another speaker of the film where possible, with `assignedBy: "default"` | `human` | criteria: voice fits the character (weight 70), distinct voices for distinct speakers (30); threshold 75 | approve | `voices_choice_gate`: every speaker with lines already had a voice |
| `check_sound` ("Music choice") | the proposed music directions including "No music", and the proposed sound-effect cues | `sound_default` — records the first-ranked direction as the episode's `musicChoice`, creates its cues, and accepts the proposed sound-effect cues | `human` | criteria: music supports the story (weight 50), effects match the action (30), restraint (20); threshold 75 | approve | `musicChoice` was already set |
| `check_final` ("Final review") | the `ReviewReport`, shown with the timeline preview | — | `human` | criteria: the cut tells the story (weight 60), technical correctness (40); threshold 80 | approve | `final_gate`: the report has a `blocker` |
| `check_final_blocked` ("Final review — problems found") | the same report with its blockers first | — | `human`, not overridable | — | — | `final_gate`: the report has no `blocker` |

`final_gate` sends a report with a `blocker` to `check_final_blocked` and every other report to `check_final`, so no run mode approves a blocked cut; `export_gate` takes the decision of whichever of the two ran through an input in mode `first`. At `check_direction` a person picks another of the 3 alternatives with "Use this direction instead", which re-runs `direction` with that alternative as instruction; "Request changes" re-runs it with the note. The `changes_requested` outputs of the other checkpoints are unconnected: a failed agent review escalates to a person. Every default written by a `_default` node is listed in the checkpoint ("Chosen automatically") and is one revertible mutation batch. Checkpoints raise the notification kind `film.step_review_required` through the node's `notificationKind` (`agent-workflows.Approval node`), except `script_approve`, which raises `script.review_required`. Run modes (`checkpoints`, `reviewer`, `auto`, `step`) are the engine settings described in `prompt-to-video-workflow.Run modes`; in "Automatic" the pipeline is hands-free up to a blocked review. No mode goes below the host minimum, and costs beyond thresholds or budgets, consent and out-of-project effects always need a person. Human checkpoints are resolved in the stage screen they concern ("Needs you" banner at the top of the stage with "Approve", "Request changes" and "Open in pipeline") or in the run view, with `jagentchill.workflow.node.resolve`, by a device with scope `jagentchill.generation.run`; the server records the resolving device (`multi-agent-orchestration.Approvals resolved by the server`). Unattended runs park per `agent-workflows.Unattended runs`. [NEW]

#### Scenario: Look approval
- **WHEN** a pipeline run reaches `check_direction` under policy `human`
- **THEN** the run is `waiting_approval`, the Direction screen shows the draft with "Approve" and "Request changes", `styleBibleVersionId` is unchanged, and no asset image job exists
- **AND** after approval `direction_commit` makes the draft the current version

#### Scenario: Default selection of asset images
- **WHEN** a character sheet has candidates scored 0.55, 0.83 and 0.71 and `assets_default` runs
- **THEN** the candidate scored 0.83 is the asset's selected image before `check_assets` is reached, and under `auto` the checkpoint approves without changing any selection

#### Scenario: Default voices
- **WHEN** 3 speakers with lines have no voice and the catalogue has 5 voices for the film language
- **THEN** `voices_default` assigns 3 different voices with `assignedBy: "default"`, `check_voices` lists the 3 speakers with a preview and "Change", and `voice_takes` starts after the checkpoint is decided

#### Scenario: Nothing to decide
- **WHEN** every speaker with lines has a voice when the `voice` stage starts
- **THEN** `voices_default` changes nothing, `check_voices` is `skipped` and `voice_takes` starts

#### Scenario: Single candidate needs no choice
- **WHEN** the run has `candidates: 1` and every asset image succeeded
- **THEN** each asset's only candidate is selected by `assets_default` and `check_assets` is `skipped`

#### Scenario: Unattended run
- **WHEN** an automation-started run reaches `check_storyboard` under policy `human`
- **THEN** the run is `waiting_approval` and parked, and one `film.step_review_required` notification is raised

### Requirement: Creative direction and style bible
Each film SHALL have a style bible: a versioned text document that fixes how the film looks and sounds — never what happens — and is the single style source for every generation of the film. It is `{version, origin: "agent" | "user", logline (0–300), look {medium (1–200), rendering (0–300), palette (3–6 entries `{hex, use}` with `use` of 1–60 characters), lighting (0–300), texture (0–300), lineWork (0–300)}, camera {framing (0–300), movement (0–300), lens (0–300)}, pacing {rhythm (0–300), transitions (0–300)}, performance (0–300), sound {music (0–300), ambience (0–300), voice (0–300)}, assetSheets {background (0–200), lighting (0–200)}, rules[] (0–12 statements of 1–200 characters, each a positive instruction), avoid[] (0–12 entries of 1–120), assumptions[] (0–10)}`. The `direction` stage drafts it with the `director` role from the film's art style, language and the available story text of all episodes; when the film has only an idea and no story, the `direction` node returns exactly 3 ranked alternative directions (title, 2-sentence summary, palette) together with the full draft of the first-ranked one; at the look approval (`check_direction`) a person can take another alternative with "Use this direction instead" or describe one in free text, which re-runs `direction` with that choice as instruction. The stage is film-scoped: it runs once per film, and an episode's pipeline skips it when the film already has a current version ("Film pipeline template", rule 6). A draft becomes current only after `check_direction` is decided, through `direction_commit`. The Direction screen shows the document as a form with palette swatches, "Regenerate section" per section with an instruction of 1–500 characters, version history (at most 20 versions, restore, compare) and "Approve". Every image, video, storyboard, appearance-description, music and voice-design request of the film receives the current version as a "Style" block in its prompt context in place of the bare art-style name (an asset's `artStyleOverride` replaces only `look.medium` and `look.rendering`); style is carried as text only and never as a style image. Making another version current marks every generated image and video of the film outdated behind a confirmation stating the counts; nothing is deleted. The document is also written to the pipeline run's shared context under the key `film.style` (`agent-workflows.Shared run context and agent sessions`). Until a version is current, asset and panel generation shows the notice "No creative direction yet" with "Create direction" and proceeds with the art style alone when the user continues. [NEW]

#### Scenario: Draft from a story
- **WHEN** the `direction` stage runs for a film with 2 episodes of story text
- **THEN** a draft with a palette of 3–6 colours and every section within its length limits is shown at `check_direction`, and `styleBibleVersionId` is still unset

#### Scenario: Three directions from an idea
- **WHEN** the film has only a 12-word idea and the stage runs
- **THEN** `check_direction` shows exactly 3 alternative directions, the full draft of the first-ranked one and a free-text field, and choosing the second alternative re-drafts the document for it

#### Scenario: Injected into generation
- **WHEN** a panel image is generated after version 2 became current
- **THEN** the job's stored prompt context contains the "Style" block of version 2 and the AssetVersion records `styleBibleVersion: 2`

#### Scenario: New version marks media outdated
- **WHEN** the user makes version 3 current in a film with 40 panel images and 12 videos
- **THEN** a confirmation states "40 images and 12 videos will be marked outdated" and on confirm they show "Outdated"

#### Scenario: Invalid palette
- **WHEN** the user saves a palette with 2 colours
- **THEN** the save is rejected with "Use 3 to 6 palette colours"

### Requirement: Structured step output
Every model step of the studio that returns data — the analyses, clip splitting, screenplay conversion, appearance descriptions, the storyboard passes, voice-line analysis, score and sound-effect suggestions, bridging panels, shot suggestions, the style bible draft and the review — SHALL have a Zod schema in `packages/film`. Inside the pipeline the result arrives through `agent-workflows.Agent node structured output`; in `film.step` jobs the call uses the model's structured-output mode when `generation-providers.Capability metadata` declares one and otherwise JSON in text with one lenient repair pass (code fences, trailing commas, unescaped quotes). `jc_film_apply` and the job runner then validate the schema and the invariants stated in the step's requirement (entry counts, name resolution, coverage, length limits). A result that fails is discarded and counts as one attempt of error class `invalid_output` under `generation-providers.Retry policy` (retried once on the same route with the violations appended, then the next route of `orc-model-routing.Route resolution and fallback`); when attempts are exhausted the step fails with `FILM_MODEL_OUTPUT_INVALID` and `details.issues` holding the first 3 violations (path and message), shown in the task's "View error". No partial result of a failed step is written. [NEW]

#### Scenario: Repairable output
- **WHEN** a model without structured-output mode returns the JSON inside a code fence with a trailing comma
- **THEN** the repair pass parses it and the result is validated normally

#### Scenario: Invalid after all attempts
- **WHEN** every attempt of the `clips` step returns clips whose anchors are missing
- **THEN** the step fails with `FILM_MODEL_OUTPUT_INVALID`, "View error" lists up to 3 issue paths, and the episode's existing clips are unchanged

### Requirement: Stale markers and stage readiness
Each stage tab SHALL show a readiness state for the current episode, computed on the host from studio data and returned as `readiness {story, script, assets, storyboard, video, voice, sound, timeline}` (each `{ready: boolean, done, total, outdated}`; never stored): Story is ready when the episode has source text; Script when at least one clip has a screenplay; Assets when every character, location and prop used by the episode has a selected image; Storyboard when at least one panel exists; Video when at least one panel has a video; Voice when at least one line has a take; Sound when at least one cue exists or the music choice is `none`; Timeline when the episode has a linked timeline project. A stage that is not ready stays openable and shows an empty state naming the prerequisite and a button that performs it. When an upstream item changes, dependants are marked outdated — never deleted — on the field that holds that medium: `Panel.media.image.stale`, `Panel.media.video.stale`, `Panel.media.lipSync.stale`, `Take.stale`, the `stale` flag of a cue's active take, and `stale` on an asset's selected image, each with `staleReason`. The rules: changing an appearance's selected description or sheet marks the images of panels using it; changing a prop's or location variant's selected image marks the images of panels using it; changing a panel's `action`, `cast`, `locationId`, `locationVariantId`, `propIds`, `cinematography`, `imagePrompt` or sketch marks its image; changing the panel's current image marks its video (and, for a panel linked from the previous one, that panel's video); changing the current video or a bound line's active take marks its lip-sync; changing a line's text or its speaker's voice marks its takes; making another style bible version current, or changing aspect ratio or art style, marks all asset images, panel images and videos of the film. Outdated items show an "Outdated" chip with "Regenerate" and "Keep as is" (clears that one flag through `version.select {action: "keep_stale"}`). These flags are studio data; inside a pipeline run the corresponding nodes carry the engine status `stale` by `agent-workflows.Re-run with downstream invalidation`, and a run with `targets: "outdated"` regenerates exactly the flagged items of each stage. [NEW]

#### Scenario: Empty storyboard stage
- **WHEN** the user opens Storyboard for an episode with no clips
- **THEN** the stage shows "Create the script first" with a button "Go to Story"

#### Scenario: Appearance change marks panels
- **WHEN** the user selects a different sheet for an appearance used by 12 panel images
- **THEN** those 12 panels have `media.image.stale` true and show "Outdated", and no image is deleted

#### Scenario: Prop change marks panels
- **WHEN** the user selects a new sheet for a prop listed by 5 panels that have images
- **THEN** those 5 panel images show "Outdated"

#### Scenario: Keep as is clears one medium
- **WHEN** the user presses "Keep as is" on an outdated panel image whose video is also outdated
- **THEN** `media.image.stale` becomes false, the video still shows "Outdated", and the panel is not included in "Regenerate outdated" for images

#### Scenario: Readiness is computed
- **WHEN** 14 of 24 panels have a current video and 3 of those are outdated
- **THEN** `readiness.video` is `{ready: true, done: 14, total: 24, outdated: 3}`

### Requirement: Story input
The Story stage SHALL provide a text editor for the current episode's source text (0–60,000 characters; live character and word count; safe with input-method composition; autosave 800 ms after the last keystroke), aspect ratio and art style pickers, and the buttons "Write with AI", "Import", "Split into episodes" and "Create script". When the text exceeds 6,000 characters and the film has a single episode, a prompt offers "Split into episodes" or "Keep as one episode". "Create script" starts the `script` stage ("Story-to-script run") after showing its estimate; it is disabled for empty text. At 60,000 characters further input is refused with "Episode text limit reached — split into episodes". [NEW]

#### Scenario: Long text prompt
- **WHEN** the user pastes 9,000 characters into the only episode
- **THEN** a prompt offers "Split into episodes" and "Keep as one episode"

#### Scenario: Empty text
- **WHEN** the editor is empty
- **THEN** "Create script" is disabled and the hint "Write, paste or import a story" is shown

### Requirement: AI story expansion
"Write with AI" SHALL take an idea of 1–2,000 characters, a target film length (30 s, 1 min, 2 min, 3 min, 5 min, 10 min; default 1 min), and an optional tone, and produce plain story prose in the film language using the `screenwriter` role as one `film.step` job, sized at 250 words per target minute ± 20 % (for languages without word spaces: 400 characters per target minute ± 20 %). The host accepts a result only when its size is inside that range and it contains no Markdown heading, list marker or emphasis mark; a result outside the range is retried as `invalid_output` per "Structured step output". The result streams into a preview; the user chooses "Insert" (appends), "Replace" (asks confirmation when the editor has text) or "Discard". Insert and Replace are single undoable edits. The estimated cost is shown before generating. [NEW]

#### Scenario: Expansion sized to target
- **WHEN** the target is 2 minutes in English
- **THEN** the accepted result has between 400 and 600 words

#### Scenario: Markup rejected
- **WHEN** the model returns prose that starts with a `#` heading line
- **THEN** the result is discarded as `invalid_output` and the step is attempted again

#### Scenario: Replace existing text
- **WHEN** the editor contains text and the user presses "Replace"
- **THEN** a confirmation appears, and after confirming one Undo restores the previous text

#### Scenario: Generation fails
- **WHEN** the model call fails on every route
- **THEN** the preview shows the error with "Try again" and the editor text is unchanged

### Requirement: Import of script formats
"Import" SHALL accept plain text (`.txt`, `.md`), Fountain (`.fountain`) and Word (`.docx`, text only) files of up to 20 MiB and 600,000 characters, by file picker or drag-and-drop on desktop and web and by the system document picker on mobile. Decoding, format detection, Fountain parsing and `.docx` text extraction are performed by the parsers of `script-studio.Import` (the same code, run on the host for films), with that requirement's encoding, rejection and untrusted-input rules; `.docx` images, table formatting, comments and tracked changes are ignored and legacy `.doc` is rejected with "Save the file as .docx and import again". A file with screenplay structure (at least one scene heading) is imported as the episode's script (`screenplayOrigin: "imported"`): each scene becomes one clip whose `sceneIds` holds that scene, the scene's text span becomes the clip's source range, and screenplay conversion is skipped for those clips. A file without scene headings is imported as story prose. After reading, the import wizard continues with episode splitting; because an episode holds at most 60,000 characters, the wizard's option "Keep as one episode" is disabled with "Too long for one episode" for a text above that length. [NEW]

#### Scenario: Fountain import
- **WHEN** the user imports a Fountain file with 12 scenes and no section markers
- **THEN** one episode with 12 clips is proposed, the episode script holds the 12 scenes with their headings, action and dialogue, and the script stage skips conversion for them

#### Scenario: Oversized file
- **WHEN** the file contains 700,000 characters
- **THEN** the import is rejected with "The file has 700,000 characters; the limit is 600,000"

#### Scenario: Word file with images
- **WHEN** a `.docx` contains text and pictures
- **THEN** only the text is imported and a notice states "Images were ignored"

### Requirement: Episode splitting by marker detection
The import wizard SHALL first try a model-free marker detection that recognises, at line starts: "Episode N", "Chapter N", "Part N", "Act N" and their Vietnamese ("Tập N", "Chương N", "Phần N", "Hồi N") and Japanese ("第N話", "第N章", "第N幕") forms with Arabic, Roman or native numerals; Markdown headings `#` and `##`; Fountain sections `#`; and lines consisting only of a number. Detection needs at least 2 markers of the same family, picks the family yielding the most balanced lengths, and shows a preview listing each proposed episode with title, first 120 characters and character count. Text before the first marker becomes episode 1 only when it has more than 200 characters, otherwise it is prepended to the first episode. No model call or cost is incurred. [NEW]

#### Scenario: Markers found
- **WHEN** the text contains "Chapter 1" … "Chapter 8" at line starts
- **THEN** the preview proposes 8 episodes titled by their chapter lines

#### Scenario: No markers
- **WHEN** fewer than 2 markers of any family are found
- **THEN** the wizard states "No episode markers found" and offers "Split with AI" and "Keep as one episode"

### Requirement: Model-based episode splitting
"Split with AI" SHALL use the `screenwriter` role to divide the text into episodes at natural story breaks. The user sets a target episode count (1–100) or "Automatic" (target 3,000 characters per episode). The model returns, per episode, a title, a one-sentence summary and a short verbatim anchor quote for the start; the system resolves anchors to character offsets (exact match first, then whitespace- and punctuation-insensitive match) and MUST guarantee that the resulting episodes cover the whole text with no gap and no overlap. Unresolvable anchors cause one further attempt (2 attempts in total, the single policy quoted in "Structured step output") and then a deterministic split at the paragraph boundary nearest to each target offset, flagged "Approximate boundary". Texts above 100,000 characters are processed in windows of 60,000 characters with 2,000 characters of overlap. The estimated cost is shown before starting, and the split runs as one `film.step` job. [NEW]

#### Scenario: Full coverage
- **WHEN** the split completes
- **THEN** concatenating the episodes' texts in order reproduces the imported text exactly

#### Scenario: Unresolvable anchor
- **WHEN** an anchor cannot be located in either of the 2 attempts
- **THEN** that boundary is placed at the nearest paragraph break and the episode row shows "Approximate boundary"

### Requirement: Manual editing of the episode split
Before confirming, and afterwards from the episode selector, the user SHALL be able to edit the split: rename an episode, edit its summary and text, move a boundary by dragging the divider or by "Move first/last paragraph to previous/next episode", split an episode at the caret, merge an episode with the next, add an empty episode, delete an episode (its text is offered to the neighbouring episode), reorder episodes (numbers are renumbered contiguously), and "Analyse again" (replaces the proposal after confirmation). Confirming creates the episodes; the checkbox "Analyse characters, locations and props across all episodes" (default on when more than one episode) starts the global asset analysis. Merging or splitting an episode that already has clips marks its script stale and asks for confirmation. [NEW]

#### Scenario: Merge
- **WHEN** the user merges episode 2 with episode 3 in the wizard
- **THEN** one episode holds both texts in order and subsequent episodes are renumbered

#### Scenario: Split an episode that has clips
- **WHEN** the user splits an episode that already has 6 clips
- **THEN** a confirmation states that the script of both resulting episodes will be outdated, and on confirm their Script stage shows "Outdated"

### Requirement: Global asset analysis
The global asset analysis SHALL scan the text of all episodes in chunks of 12,000 characters with 600 characters of overlap using the `director` role, running the character, location and prop extraction of the following requirements per chunk, and merge results into the film's asset lists: an extracted entity whose name or alias matches an existing asset (case-insensitive, after trimming honorifics configured for the film language) updates that asset's aliases and introduction instead of creating a duplicate; new characters are created with `profileConfirmed = false`. The run reports progress as chunks done / total, is cancellable, tolerates failed chunks (reported as "n of m parts failed" with "Retry failed parts"), and never deletes or overwrites user-edited fields. It runs as `film.step` jobs (one per chunk), and can be started from the import wizard and from the Assets toolbar ("Analyse whole film"). [NEW]

#### Scenario: Alias merge
- **WHEN** chunk 3 mentions "Dr. Lan" and a character "Lan" with alias "Dr. Lan" exists
- **THEN** no new character is created

#### Scenario: Partial failure
- **WHEN** 1 of 9 chunks fails on every route
- **THEN** results of the 8 successful chunks are merged and "1 of 9 parts failed" is shown with "Retry failed parts"

### Requirement: Story-to-script run
"Create script" SHALL run the `script` stage of "Film pipeline template" for the current episode: `characters`, `locations` and `props` concurrently, then `clips`, then the `screenplay` fan-out (one `screenplay_clip` per clip, concurrency 4), each followed by its `_apply` node, then `script_approve`; every one of them reads the snapshot of `script_load`, so a changed story is never answered from an earlier run's cache. The three analyses use the `director` role and `clips` and `screenplay` the `screenwriter` role, unless the stage is assigned otherwise. Retries, route fallback, timeouts, cache reuse of unchanged steps and restart recovery are those of `agent-workflows.Retry and fallback`, `agent-workflows.Determinism and cache reuse` and `agent-workflows.Checkpoints and resume after Gateway restart`; this capability states no retry count or delay. Because each node's output is a stored artifact, re-running one node reuses the outputs of the others. While the stage runs, the Story stage shows a collapsible console with one section per node that streams the node's model text (`agent-workflows.Live run events`, `stream.text`); on open, reload, reconnect or a `seq` gap the console restores earlier output from `jagentchill.workflow.node.logs` and the node's session, so a reload mid-run never shows an empty console. When the episode already has panels, starting the stage shows the confirmation "Storyboard and media of this episode will be marked outdated"; nothing downstream is deleted. A failed `screenplay` item does not fail the stage: the fan-out succeeds when at least one clip converted and the failed clips show "Conversion failed" with "Retry" (a re-run of that item). On success the workspace switches to the Script stage. The run is cancellable and appears in the episode diagram. [NEW]

#### Scenario: Parallel analysis
- **WHEN** the stage starts
- **THEN** `characters`, `locations` and `props` are `running` at the same time and `clips` becomes `ready` only after all three and their apply nodes succeeded

#### Scenario: Partial screenplay failure
- **WHEN** 2 of 9 clip conversions fail on every route
- **THEN** the fan-out's counts read 7 succeeded and 2 failed, the Script stage opens with the notice "7 of 9 clips converted", and the 2 clips show "Conversion failed" with "Retry"

#### Scenario: Re-run with existing storyboard
- **WHEN** the episode has 40 panels and the user starts the stage again
- **THEN** a confirmation is shown, and on confirm panels are kept and marked outdated

#### Scenario: Console after reload
- **WHEN** the user reloads the app while `clips` is streaming
- **THEN** the console shows the text produced so far within 2 s of the run snapshot loading and continues streaming

### Requirement: Character analysis and profiles
The `characters` step SHALL identify characters who need a visual identity (those who speak, act or drive events), ignore unnamed background people, resolve aliases and first-person narration to one canonical name, reuse existing film characters by name or alias, and produce for each character the profile fields of "Character, appearance, location and prop entities" plus the list of expected appearances (each with a label and a reason for the change, at most 8). Existing characters receive only additions to aliases and introduction; fields the user edited are not overwritten. New characters are stored with `profileConfirmed = false`. A step result with zero characters is valid. [NEW]

#### Scenario: First-person narrator
- **WHEN** the story is narrated as "I" by a person others call "Minh"
- **THEN** one character "Minh" is produced with the introduction noting that "I" refers to Minh

#### Scenario: User edits preserved
- **WHEN** the user had edited a character's `signatureFeature` and the analysis runs again
- **THEN** that field keeps the user's value

### Requirement: Location analysis with placement slots
The `locations` step SHALL extract places where on-screen action happens, merge alternative names, prefer existing location names, and produce for each: a summary, whether a crowd is present (with a crowd description), three alternative wide-view environment descriptions (the Variants), and for each variant 2–6 placement slots — short phrases that position a person relative to a visible, fixed object of that place (for example "standing behind the counter, left of the register"). Slots let panels place characters consistently in the same set. Places that are only mentioned and never shown are not extracted. [NEW]

#### Scenario: Slots produced
- **WHEN** a café is extracted
- **THEN** each of its 3 variants has between 2 and 6 slots, each referring to an object named in that variant's description

#### Scenario: Mentioned-only place
- **WHEN** a character says they once lived in Paris but no scene takes place there
- **THEN** no "Paris" location is created

### Requirement: Prop analysis
The `props` step SHALL extract only objects that need a consistent look across panels. The model returns candidate props, each with `name`, `aliases`, a human-readable `summary`, a purely visual `description` (shape, material, colour, size, wear; no usage, hands or background), `centralEvent` (boolean) and, when `centralEvent` is true, a `quote` of 1–200 characters copied from the text. The host keeps a candidate only when its name or an alias occurs (case-insensitive) in the text of at least 2 clips' source ranges, or `centralEvent` is true and `quote` is a normalised substring of the episode text; every other candidate is dropped and listed in the node log. A result with zero props is valid. Existing props are matched by name or alias and receive only alias additions; fields the user edited are not overwritten. [NEW]

#### Scenario: Conservative extraction
- **WHEN** the model proposes "coffee cup", which occurs in one clip and has `centralEvent: false`
- **THEN** no prop is created for it and the node log lists it as dropped

#### Scenario: Key object
- **WHEN** a carved wooden box is named in the source ranges of 3 clips
- **THEN** one prop is created with its visual description

#### Scenario: Central object with a false quote
- **WHEN** a candidate has `centralEvent: true` and a `quote` that does not occur in the episode text
- **THEN** the candidate is dropped

### Requirement: Clip splitting
The `clips` step SHALL segment the episode text into ordered, contiguous clips at natural scene boundaries (change of place, time, or group of participants), targeting 400–1,200 characters per clip and at most 60 clips. The model returns for each clip a summary, a location name, character names (with appearance labels) and prop names from the film's lists, and verbatim start and end anchors; the system resolves anchors to offsets with exact then normalised matching and assigns a confidence. If any boundary cannot be resolved the step is attempted again (at most 2 attempts in total) and then falls back to paragraph-boundary splitting at the target size, flagged on the clip as "Approximate boundary". Existing clips are updated in place by index; surplus clips are removed after their panels are detached into an "Unassigned panels" group, never silently deleted. [NEW]

#### Scenario: Contiguous clips
- **WHEN** the step succeeds
- **THEN** the clips satisfy the coverage invariant of "Episode and clip entities"

#### Scenario: Fewer clips on re-run
- **WHEN** a re-run yields 5 clips where 7 existed and clips 6–7 had panels
- **THEN** those panels appear under "Unassigned panels" and can be moved to another clip or deleted by the user

### Requirement: Screenplay conversion
The `screenplay` step SHALL convert each clip's prose into a structured screenplay stored in the episode's script (`script-studio.Script document`; one scene group per clip): an ordered list of scenes, each with a heading (`setting`: interior or exterior; `locationId`; `timeOfDay`), a one-paragraph scene description, the characters present, and ordered elements of kind `action` (text), `dialogue` (speaker, optional delivery note, text) or `narration` (speaker, text) — the **screenplay** projection named by `script-studio.Feeding workflows and the film pipeline`. Names are resolved to the film's characters and locations and linked through `filmAssetId`. The host checks every `dialogue` text against the clip's source range: a text that is not a substring after normalising whitespace, quotation marks and case is kept and flagged "Not in source" on that line; source order of matched lines MUST be preserved, otherwise the result is `invalid_output`. Each conversion writes a new version of the script authored by the agent, without a proposal, as `agent-workflows.Script node` defines for run-owned versions. A failure of one clip does not fail the others. Clips with `screenplayOrigin: "imported"` are not converted. [NEW]

#### Scenario: Dialogue attribution
- **WHEN** the prose contains a quoted sentence said by "the doctor", an alias of character "Lan"
- **THEN** the screenplay has a dialogue element whose speaker is the film character "Lan"

#### Scenario: Invented line is flagged
- **WHEN** the model returns a dialogue line whose text does not occur in the clip's source range
- **THEN** the line is stored with the flag "Not in source" and the Script stage shows the flag on it

#### Scenario: Imported screenplay untouched
- **WHEN** the clip came from a Fountain import
- **THEN** no conversion call is made and the stored scenes equal the imported ones

### Requirement: Script stage review and per-clip asset binding
The Script stage SHALL show the clip list (count header "n clips") and, for the selected clip, two tabs — "Screenplay" and "Source text" — plus an "In this clip" panel listing its characters (with chosen appearance), location and props. The "Screenplay" tab embeds the editor of `script-studio.Structured editor` scoped to the clip's scenes: element editing, add / delete / reorder, comments, versions and undo are that capability's; "Open in Script studio" opens the whole episode script. In the panel the user can edit the clip summary, add or remove characters (choosing the appearance), change the location and add or remove props, split a clip at a scene or element boundary, merge a clip with the next, and "Convert again" for one clip (asks confirmation when `screenplayEdited` is true). The header shows the script's approval state and its effective policy as `script-studio.Approval policy and precedence` presents them, with "Submit for approval"; the storyboard stage consumes only the script's `approvedVersionId`, and when a newer version is approved afterwards the stage shows "Newer approved script available" with "Use new version", which marks the episode's storyboard outdated. A banner counts assets used by the episode that have no selected image ("5 assets need images") with "Generate missing"; "Create storyboard" is disabled with "Approve the script first" until an approved version exists and, when assets are missing, first asks "Continue without 5 asset images?" with "Generate first" as the default action. [NEW]

#### Scenario: Edit dialogue
- **WHEN** the user edits a dialogue line and leaves the field
- **THEN** the change is saved within 800 ms as an edit of the script, `screenplayEdited` becomes true, and Undo restores the previous text

#### Scenario: Script not approved
- **WHEN** the episode script has no approved version and the user points at "Create storyboard"
- **THEN** the button is disabled with "Approve the script first" and "Submit for approval" is offered

#### Scenario: Missing asset gate
- **WHEN** 5 assets lack images and the user presses "Create storyboard"
- **THEN** a dialog offers "Generate first" (default) and "Continue anyway"

#### Scenario: No clips
- **WHEN** the episode has no clips
- **THEN** the stage shows "No script yet" with "Go to Story"

### Requirement: Assets stage layout
The Assets stage SHALL show the film's assets in a card grid with tabs Characters / Locations / Props, each with a count, the filters Episode (All | Current episode) and Status (All | Needs review | No image | Outdated | Ready), search by name and alias, and the toolbar actions "Analyse whole film", "Import from hub", "New character", "New location", "New prop", "Generate missing (n)" and "Regenerate outdated (n)". A character card shows the selected sheet (variant `thumb`), name, importance, appearance chips, the voice indicator of "Character voice assignment" and status chips; "Add appearance" (label 1–40 characters and a change note) on a confirmed character creates a non-primary appearance with three description options by one `director` call, up to 8 appearances. Location cards show the selected variant's plate and slot count; prop cards the sheet. Each asset's detail panel edits its fields, including `artStyleOverride`. The empty state shows "No assets yet" with "Create script" when the episode has no script, else "Analyse whole film". The unconfirmed-profile banner of "Character profile confirmation" sits above the grid. [NEW]

#### Scenario: Filter by status
- **WHEN** the user selects Status "No image" on the Characters tab
- **THEN** only characters without a selected sheet for at least one appearance are listed and the tab count shows the filtered number

#### Scenario: Add appearance after confirmation
- **WHEN** the user adds the appearance "Rain coat" to a confirmed character with 2 appearances
- **THEN** a third appearance is created with 3 description options that state only what differs from the primary

#### Scenario: Appearance limit
- **WHEN** a character has 8 appearances
- **THEN** "Add appearance" is disabled with "A character can have at most 8 appearances"

### Requirement: Character profile confirmation
The Assets stage SHALL show unconfirmed characters under a banner "n characters to review" with, per character, a profile card (editable: importance, gender presentation, age range, era, occupation, traits, signature feature, palette, wardrobe notes, expected appearances) and the actions "Confirm", "Use existing…" (maps the name to another film or hub character and merges aliases), "Delete" and "Confirm all". Confirming calls the `director` role to write, for each expected appearance, three alternative appearance descriptions for image generation, each limited to stable physical identity and wardrobe (face, hair, build, outfit, accessories and the character's `signatureFeature`) and free of anything that varies per panel (expression, pose, action, background); the primary appearance is self-contained and every other appearance states only its differences from the primary. Confirming in this banner and approving the `check_profiles` checkpoint of "Stage checkpoints and approval policies" are the same action. On success `profileConfirmed` becomes true. Asset image generation for a character is disabled until its profile is confirmed. [NEW]

#### Scenario: Confirm one character
- **WHEN** the user confirms a character with 2 expected appearances
- **THEN** 2 appearances are created, each with 3 description options, and `profileConfirmed` is true

#### Scenario: Confirm all with one failure
- **WHEN** "Confirm all" runs for 6 characters and 1 fails
- **THEN** 5 are confirmed and the failed one stays unconfirmed with "Retry"

#### Scenario: Use existing
- **WHEN** the user maps unconfirmed "Old Tam" to existing character "Tam"
- **THEN** "Old Tam" is added to Tam's aliases and all clip references point to Tam

### Requirement: Asset image generation with candidates
The user SHALL be able to generate reference images for an appearance, a location variant or a prop with a candidate count of 1–6 (default 3; the last used count is remembered per asset type). Formats, defined by this project: character reference sheet 16:9 in four equal columns left to right — head-and-shoulders portrait, full-body front, full-body side, full-body back — on the neutral background stated in the style bible's `assetSheets`, with no other person or object; location plate 16:9 wide establishing view without people unless `hasCrowd`; prop sheet 1:1 with the single object centred on the same neutral background. The prompt context is composed from the selected description, the format instruction and the "Style" block of "Creative direction and style bible" (or the asset's `artStyleOverride`), using the routes `image.character`, `image.location` and `image.prop`. Generating a non-primary appearance MUST pass the primary appearance's selected sheet as a reference image. Images are stored without any burnt-in text. Each candidate is an AssetVersion (`state: "candidate"`) produced by its own `generation.image` job, so partial success is shown per tile; an asset's first successful candidate becomes its selected image when it has none, exactly as for panels, so a request for a single candidate needs no choice. Asset image generation for a character is disabled until its profile is confirmed. [NEW]

#### Scenario: Three candidates
- **WHEN** the user generates a character sheet with the default count
- **THEN** 3 jobs are queued and 3 candidate tiles show progress independently

#### Scenario: Non-primary appearance uses the primary as reference
- **WHEN** the user generates the "Wedding dress" appearance of a character whose primary sheet is selected
- **THEN** the request includes the primary sheet as a reference image

#### Scenario: Primary sheet missing
- **WHEN** the user generates a non-primary appearance and the primary has no selected sheet
- **THEN** the action is blocked with "Generate and select the primary appearance first"

#### Scenario: Prop route
- **WHEN** a prop sheet is generated
- **THEN** the job resolves route `image.prop` and requests a 1:1 image

### Requirement: Asset candidate selection, regeneration and editing
For each asset the user SHALL be able to: select one candidate (it becomes the asset's current image; other candidates remain in the version history until removed by "Discard others" or by retention); regenerate one candidate slot or the whole group (the current selection stays in use until a new one is selected); edit a selected image by instruction (1–500 characters, with 0–4 uploaded or pasted reference images and optional film assets as references) on route `image.edit` — the result is a new version and, on success, the asset's description is rewritten by the `director` role to match the edit (for locations including the slot list), which the user can revert; rewrite a description by instruction without touching the image; create a new character, location or prop from a one-line request (the `director` role writes the description and slots); create one manually; upload an image as the asset's image (PNG, JPEG, WebP up to 25 MiB); and turn an uploaded photo into a character sheet (the `image` role redraws it as a sheet in the film's art style and the `vision` role writes the appearance description). Every such action is listed in the asset's version history and restorable. [NEW]

#### Scenario: Select a candidate
- **WHEN** the user selects candidate 2 of 3
- **THEN** candidate 2 becomes the asset's current image and candidates 1 and 3 stay in the version history

#### Scenario: Edit by instruction
- **WHEN** the user edits a character sheet with "add round glasses"
- **THEN** a new version becomes current, the description gains the glasses, and "Revert description" restores the previous text

#### Scenario: Photo to sheet
- **WHEN** the user uploads a portrait photo for a new character
- **THEN** a 16:9 reference sheet in the film's art style is generated and a description is written from the photo

#### Scenario: Upload too large
- **WHEN** the uploaded image is 30 MiB
- **THEN** it is rejected with "Images can be up to 25 MiB"

### Requirement: Consistency through reference images including props
Panel image generation SHALL attach reference images so that people, places and objects stay consistent, in this order: the panel's sketch when present; the selected sheet of each cast member's chosen appearance; the selected plate of the panel's location variant; the selected sheet of every prop in `propIds`; and — when the panel's `continuity` toggle is on — the previous panel's current image. When the number of references exceeds the limit the model declares in `generation-providers.Capability metadata`, references are dropped in this order until they fit: continuity image, props (last listed first), cast members of importance `minor`, then `supporting`; the sketch is never dropped. The prompt identifies each reference by position ("reference 2 is the character Lan"; "reference 5 is the prop wooden box"). The panel detail lists which references were sent and which were dropped, and each AssetVersion records them in `referenceVersionIds`. Assets without a selected image contribute their text description only, and the panel shows the notice "n references missing". The same reference set, drop order and labelling are used by video mode `reference` ("Panel video generation") and by "Shot variants from a panel". [NEW]

#### Scenario: Props are sent as references
- **WHEN** a panel lists the prop "wooden box" with a selected sheet
- **THEN** the generation request includes that sheet among the reference images, the prompt names its position, and the AssetVersion's `referenceVersionIds` contains it

#### Scenario: Reference limit
- **WHEN** a panel has 5 cast members, 1 location and 4 props and the model accepts 8 references
- **THEN** 2 references are dropped following the stated order and the panel detail names the dropped ones

#### Scenario: Prop without an image
- **WHEN** a panel lists a prop that has no selected sheet
- **THEN** the prop's visual description is included as text and the panel shows "1 reference missing"

#### Scenario: Sketch survives the limit
- **WHEN** a panel with a sketch has more references than the model accepts
- **THEN** the sketch is sent as reference 1 and other references are dropped first

### Requirement: Character voice assignment
Each character card SHALL have a Voice section showing the linked speaker's voice with a play button for its preview, and the actions "Choose from library", "Design a voice", "Clone from audio" and "Remove voice" as defined in "Speakers and voice sources". A character without a speaker gets one created on first assignment with the character's name. The asset list shows a microphone icon on characters that have dialogue lines and no voice. [NEW]

#### Scenario: Assign from the character card
- **WHEN** the user chooses a library voice on a character with no speaker
- **THEN** a speaker named after the character is created with that voice and linked to the character

#### Scenario: Missing voice indicator
- **WHEN** a character has 6 lines and no voice
- **THEN** its card shows the microphone icon with the tooltip "6 lines need a voice"

### Requirement: Storyboard run in three passes
"Create storyboard" SHALL run the `storyboard` stage of "Film pipeline template" for the current episode: a fan-out over the episode's clips (concurrency 4) whose body executes three passes with the `storyboard` role — pass 1 `plan`; pass 2 with two concurrent nodes `cinematography` and `acting`, both after pass 1; pass 3 `detail` after both — each followed by its `_apply` node; after the fan-out, `voice_lines` runs "Voice-line analysis", then `check_storyboard`. The context given to every pass is: the clip's scenes from the approved script version (or its source text when the clip has no scenes), the "Style" block of the style bible, and for the clip's characters, location and props their names, introductions, appearance labels, selected descriptions and slot phrases. The Storyboard stage shows per-clip progress labelled "Planning panels", "Cinematography", "Acting", "Adding detail" from the fan-out's per-item node states. A clip whose pass fails does not fail the stage; its group shows "Storyboard failed" with "Retry" and the outputs of its succeeded passes are kept as artifacts. On success the workspace switches to the Storyboard stage. [NEW]

#### Scenario: Pass ordering
- **WHEN** a clip's `plan` and `plan_apply` succeed
- **THEN** its `cinematography` and `acting` nodes run concurrently and its `detail` node becomes `ready` only after both succeeded

#### Scenario: Clip concurrency
- **WHEN** an episode has 10 clips
- **THEN** at most 4 clips are being processed at any time

#### Scenario: One clip fails
- **WHEN** one clip's `detail` node fails on every route
- **THEN** the other clips complete, the failed clip's group shows "Storyboard failed" with "Retry", and its pass 1–2 outputs are kept

### Requirement: Pass 1 — panel plan
Pass 1 SHALL cover the entire clip with a chronological sequence of 1–40 panels. For each panel it produces: `action`, `sourceExcerpt`, `shotSize`, `cameraMotion`, `duration_ticks`, `dramaticMode`, `locationId`, `cast` (each character with the appearance label valid for this clip and, when the character stays in one place, a `slotId` of the location's selected variant), `propIds` and a first `videoPrompt`. Names MUST resolve to film assets; an unknown name is recorded as a warning on the panel ("Unknown character: …") instead of failing the pass. The sum of planned durations is reported per clip. [NEW]

#### Scenario: Slot reuse
- **WHEN** a character sits at the same table through 4 panels
- **THEN** all 4 panels carry the same `slotId` for that character

#### Scenario: Unknown name
- **WHEN** the model names a character that is not in the film
- **THEN** the panel is stored without that cast entry and shows the warning "Unknown character: <name>"

### Requirement: Pass 2 — cinematography and acting
The `cinematography` node SHALL return exactly one entry per panel with `composition`, `lighting`, `palette`, `atmosphere` and `lensNotes`, written as directly usable instructions consistent with the style bible and kept continuous between neighbouring panels of the same scene; slots are treated as preferred anchors, not constraints. The `acting` node SHALL return, for every cast member of every panel, one observable performance instruction (facial expression, posture, gaze, small action) stored in `cast[].performance`. Invariants checked by `jc_film_apply`: the entry count equals the panel count and every entry names an existing panel id; every cast member of every panel has a non-empty `performance` of at most 300 characters. A violating result is `invalid_output` per "Structured step output". [NEW]

#### Scenario: Count mismatch
- **WHEN** the cinematography result has 7 entries for 8 panels
- **THEN** the result is discarded as `invalid_output` and no panel field is changed by it

#### Scenario: Acting stored per cast member
- **WHEN** a panel has 2 cast members
- **THEN** both `cast` entries have a non-empty `performance` after the pass

### Requirement: Pass 3 — detail and video prompt
The `detail` node SHALL refine each panel's `action` into a precise visual description, write the `imagePrompt`, and write a motion-oriented `videoPrompt` that refers to people by visible traits (age, gender presentation, clothing), states one main camera move, and contains no subtitle, caption or watermark instruction. Invariants checked by `jc_film_apply`: panel count and order equal pass 1; cast, location and slots are unchanged; no `videoPrompt` contains the name or an alias of any film character as a whole word (case-insensitive) or the words "subtitle", "caption" or "watermark" in the film language or English. A violating result is `invalid_output` per "Structured step output". Fields listed in a panel's `fieldsEdited` are never overwritten by any pass; the pass output for those fields is offered as a suggestion ("AI suggestion available") that the user can accept or dismiss. [NEW]

#### Scenario: Names rejected in the video prompt
- **WHEN** the model returns a `videoPrompt` containing "Lan" for a panel featuring the character Lan
- **THEN** the result is discarded as `invalid_output`, and the accepted result of a following attempt describes her by visible traits

#### Scenario: Edited field preserved
- **WHEN** the user had edited a panel's `videoPrompt` and the storyboard text is regenerated for that clip
- **THEN** the user's text is kept and "AI suggestion available" is shown on that field

### Requirement: Storyboard step retry and invalidation
Automatic retries and route fallback of the storyboard nodes SHALL be those of `agent-workflows.Retry and fallback`; a user "Retry" on a failed node and "Regenerate" on a succeeded one are the node re-run of `agent-workflows.Re-run with downstream invalidation`, whose data-edge rule yields exactly this invalidation: re-running a clip's `plan` marks that clip's `cinematography`, `acting` and `detail` and the episode's `voice_lines` stale; re-running `cinematography` or `acting` marks that clip's `detail` and `voice_lines`; re-running `detail` marks only `voice_lines`. Because every node output is a stored artifact, re-running one node reuses the others. "Regenerate storyboard text" on a clip that already has panels stores the current panel set as a storyboard version (at most 5 kept per clip, restorable from "Storyboard history"), then replaces panels by index while preserving `fieldsEdited` values and keeping media of panels whose `action` is unchanged; media of changed panels are marked outdated and kept. [NEW]

#### Scenario: Retry plan
- **WHEN** the user re-runs `plan` of clip 3
- **THEN** clip 3's `cinematography`, `acting` and `detail` and the `voice_lines` node become `stale` and other clips are untouched

#### Scenario: Restore storyboard version
- **WHEN** the user restores the previous storyboard version of a clip
- **THEN** its panels, their fields and their media links return to that version's state as one undoable action

#### Scenario: Sixth storyboard version
- **WHEN** a clip has 5 stored storyboard versions and its text is regenerated again
- **THEN** the oldest version is removed and 5 remain

### Requirement: Storyboard stage layout
The Storyboard stage SHALL show one collapsible group per clip (header: clip index, summary, panel count, planned duration, status, and the actions Regenerate text, Generate missing images, Add panel, Storyboard history) containing its panels in card view (default; image area in the film ratio, index, shot size, camera motion, duration, first 2 lines of `action`, cast avatars, status chips) or table view (one row per panel with inline-editable columns: index, shot size, camera motion, duration, action, location, cast, video prompt). A header shows totals (panels, with image, without image, outdated), "Generate all images", "Generate missing (n)", "Download images" and "Continue to Video". The clip's screenplay is viewable in a side panel next to its panels. Lists are virtualised: with 600 panels the stage keeps at most 60 card subtrees mounted and scrolls within the dropped-frame budget of `diagnostics-quality.Performance budgets` on its reference devices. [NEW]

#### Scenario: Switch to table view
- **WHEN** the user selects table view
- **THEN** the same panels appear as rows and the choice persists for that film on that device

#### Scenario: Empty clip group
- **WHEN** a clip has no panels
- **THEN** its group shows "No panels" with "Regenerate text" and "Add panel"

#### Scenario: Virtualised list
- **WHEN** an episode with 600 panels is scrolled from top to bottom in card view
- **THEN** no more than 60 panel cards are mounted at any time

### Requirement: Manual editing of panels
The user SHALL be able to edit every panel field of "Panel entity" in a panel editor (side panel on desktop and web, full-height sheet on the compact form factor): shot size, camera motion, duration, action, source excerpt, location and variant (picker), cast (add / remove, appearance picker, slot picker, performance text), props (picker), dramatic mode, all five cinematography fields, image prompt, video prompt, first/last prompt, the `continuity` toggle and a "Sketch" slot. The Sketch slot accepts one uploaded or pasted PNG, JPEG or WebP image of at most 25 MiB, stored as an AssetVersion of kind `sketch` with `origin: "uploaded"`, replaceable and removable; adding, replacing or removing it marks the panel image outdated. An "Advanced" tab shows the exact structured context that will be sent to the image model, read-only, with "Copy". Edits save 800 ms after the last change with a per-field saving / saved / failed indicator; a failed save is attempted again after 1 s, 3 s and 9 s and then shows "Not saved — Retry" while keeping the local value. Each edited field is added to `fieldsEdited`; "Reset to AI value" removes it and restores the last pass output. [NEW]

#### Scenario: Edit cast slot
- **WHEN** the user changes a cast member's slot
- **THEN** the panel is saved, `cast` is added to `fieldsEdited`, and the panel image is marked outdated

#### Scenario: Add a sketch
- **WHEN** the user pastes a 2 MiB PNG into the Sketch slot of a panel that has an image
- **THEN** the sketch is stored as an AssetVersion of kind `sketch` and the panel image shows "Outdated"

#### Scenario: Sketch too large
- **WHEN** the user uploads a 30 MiB sketch
- **THEN** it is rejected with "Images can be up to 25 MiB"

#### Scenario: Save failure
- **WHEN** saving a field fails 4 times in a row
- **THEN** the field shows "Not saved — Retry" and the typed value remains in the field

### Requirement: Reorder, insert and delete panels
The user SHALL be able to reorder panels within a clip and across clips of the same episode by drag-and-drop (desktop and web), by long-press drag (touch), by "Move up" / "Move down" / "Move to clip…" menu items and by the actions `film.panel.move-up` and `film.panel.move-down` (bindings in `keyboard-shortcuts`); insert a blank panel before or after any panel; duplicate a panel (copies fields and current image, not video); and delete one or several selected panels after confirmation ("Delete 3 panels? Their images and videos stay in the trash for 30 days" — Trash kind `film-panel-asset`). Indices are renumbered contiguously after every change. Voice lines bound to a moved panel stay bound to it; lines bound to a deleted panel become unbound. Clip groups can be reordered, added (empty clip) and deleted (confirmation when they contain panels). All of these are undoable. [NEW]

#### Scenario: Move across clips
- **WHEN** the user drags panel 5 of clip 1 into clip 2 at position 0
- **THEN** it becomes panel 0 of clip 2, both clips are renumbered, and its bound voice lines remain bound

#### Scenario: Delete and undo
- **WHEN** the user deletes 3 panels and presses Undo
- **THEN** the 3 panels return at their previous positions with their media and line bindings

### Requirement: Split and merge panels
"Split panel" SHALL divide one panel into two adjacent panels: the user picks a split point in the `action` text (or "Split evenly"); both panels inherit location, cast, props, cinematography and dramatic mode; durations are divided in proportion to the text lengths with a minimum of 1 s each; the first keeps the image, video and lip-sync media, the second starts without media; bound voice lines stay on the first panel unless the user moves them in the split dialog. "Merge with next" SHALL combine two adjacent panels of the same clip: `action`, `sourceExcerpt` and prompts are concatenated in order, cast and props are unioned, the first panel's shot size, camera motion, cinematography and media are kept (the second's media remain in version history of the merged panel as non-current versions), durations are summed and capped at 15 s, and voice lines of both are bound to the merged panel in order. Split is refused for a panel of 1 s; both actions are undoable. [NEW]

#### Scenario: Split
- **WHEN** the user splits a 6 s panel evenly
- **THEN** two 3 s panels result, the first with the original image and video, the second without media

#### Scenario: Merge exceeding the cap
- **WHEN** panels of 9 s and 8 s are merged
- **THEN** the merged panel lasts 15 s and a notice states "Duration capped at 15 s"

#### Scenario: Split too short
- **WHEN** the panel lasts 1 s
- **THEN** "Split panel" is disabled with the tooltip "Panel is too short to split"

### Requirement: AI bridging panel and prompt rewrite
"Insert AI panel" between two panels SHALL call the `storyboard` role with the previous and next panels and an optional note (0–300 characters) and create exactly one panel that connects them with continuous action, staging, location and cast. "Rewrite prompts" on a panel SHALL take an instruction of 1–500 characters, which can mention film assets with `@name` (autocomplete over characters, appearances, locations and props), and rewrite the panel's image prompt and video prompt accordingly, showing a before/after diff with "Apply" and "Discard". "Suggest shots" SHALL propose 3–6 alternative shots for a panel (title, description, shot size, camera motion, video prompt, and a novelty rating 1–5) that keep the story moment, cast and location. [NEW]

#### Scenario: Bridging panel
- **WHEN** the user inserts an AI panel between panels 3 and 4
- **THEN** one new panel appears at index 4 with the cast and location of its neighbours and a non-empty action

#### Scenario: Mention an asset
- **WHEN** the instruction contains "@wooden box"
- **THEN** the prop "wooden box" is added to the panel's `propIds` when the rewrite is applied

### Requirement: Voice-line analysis
The `voice_lines` node SHALL use the `screenwriter` role to extract from the approved script of the episode the lines to be voiced: `dialogue` (spoken lines), `inner` (voiced thoughts) and, when the film setting `voiceNarration` is on, `narration`. For each line the model returns the canonical speaker, the text, a suggested emotion and intensity, the script line id it comes from, a proposed `panelId` and a `matchConfidence` (0–1). `jc_film_apply` creates a speaker when none exists (narration uses a speaker named "Narrator"), and binds a line to its proposed panel only when `matchConfidence` ≥ 0.6, the panel belongs to the clip of the line's scene, and — for `dialogue` — the speaker's character is in the panel's `cast`; otherwise the line is left unbound. Lines are upserted by script line id: existing lines whose text is unchanged keep their takes; removed lines are deleted only when they have no takes, otherwise they are kept with `orphaned: true` and shown as "No longer in script". The analysis runs at the end of the storyboard stage and on demand ("Analyse lines" / "Analyse again") as a re-run of the node. [NEW]

#### Scenario: Line matched to a panel
- **WHEN** a dialogue line by "Lan" is returned with panel 7 at `matchConfidence` 0.82 and Lan is in panel 7's cast
- **THEN** the line's `panelId` is panel 7

#### Scenario: Low confidence stays unbound
- **WHEN** a line is returned with `matchConfidence` 0.4
- **THEN** the line is created without a `panelId` and listed under "Unbound lines"

#### Scenario: Re-analysis keeps takes
- **WHEN** a line with 2 takes is unchanged in the new analysis
- **THEN** the line keeps both takes and its active take

#### Scenario: Narration off
- **WHEN** `voiceNarration` is off
- **THEN** no `narration` line is created

### Requirement: Panel image generation
The user SHALL be able to generate a panel's image on route `image.panel` at the film's aspect ratio and image resolution. The request contains the panel's image prompt, a structured context (the "Style" block of the style bible, shot size, camera motion, action, cast with appearance descriptions, slots and performance, location description and slots, prop descriptions, cinematography, source excerpt) and the reference images of "Consistency through reference images including props", and instructs the model to render exactly one clean frame without text, borders or collage. When the story text and the panel fields conflict, the panel fields edited by the user win; otherwise the source excerpt wins. Generation is available per panel, per clip ("Generate missing"), per episode, and as the `panel_images` stage of the pipeline. A panel whose generation fails shows the error with "Retry" and "Edit prompt"; a content refusal is not retried on that route, as `generation-providers.Error and content-safety mapping` defines. [NEW]

#### Scenario: Generate one panel
- **WHEN** the user presses Generate on a panel with no image
- **THEN** one `generation.image` job is queued, the card shows progress, and on success the first candidate becomes the panel's image

#### Scenario: Provider refuses the prompt
- **WHEN** the provider rejects the request on content grounds
- **THEN** the panel shows the provider's message with "Edit prompt" and no automatic retry is made on that route

### Requirement: Panel image candidates
Panel image generation SHALL accept a candidate count of 1–4 (default 1). On a panel without an image the first successful candidate becomes current and the others are offered in a candidate strip. On a panel that already has an image, regeneration keeps the current image in use and places all new candidates in the strip; the user chooses "Use" on one (it becomes current, the previous image stays in history) or "Dismiss all" (the current image stays; dismissed candidates remain in history for the retention period). The candidate strip shows each candidate at ≥ 120 px height with click-to-enlarge and arrow-key navigation. [NEW]

#### Scenario: Regenerate keeps the current image
- **WHEN** the user regenerates with 3 candidates
- **THEN** the panel keeps showing its current image and the strip shows 3 candidates with "Use" buttons

#### Scenario: Dismiss
- **WHEN** the user presses "Dismiss all"
- **THEN** the strip closes and the current image is unchanged

### Requirement: Shot variants from a panel
From "Suggest shots" or a free-text request the user SHALL be able to generate a variant image that changes framing or angle while keeping identity, location and story moment. The variant request sends the source panel's current image as a reference, with toggles "Include character references" and "Include location reference" (both default on). The user chooses where the result goes: "As a new panel after this one" (default; copies the source panel's fields with the variant's shot size, camera motion and prompts) or "As a candidate of this panel". [NEW]

#### Scenario: Variant as a new panel
- **WHEN** the user generates a suggested close-up as a new panel
- **THEN** a panel is inserted directly after the source with shot size close-up and the generated image

#### Scenario: Source has no image
- **WHEN** the source panel has no image
- **THEN** variant generation is disabled with "Generate the panel image first"

### Requirement: Panel image edit by instruction
The user SHALL be able to edit a panel's current image with an instruction of 1–500 characters, 0–4 uploaded or pasted reference images and 0–4 selected film assets, on route `image.edit` at the same aspect ratio. The result is a new AssetVersion with `origin = edited` that becomes current; the previous image stays in history. The edit dialog shows the current image, the instruction field, reference thumbnails with remove buttons, the estimated cost, and after completion a before/after comparison slider. [NEW]

#### Scenario: Edit succeeds
- **WHEN** the user submits "make it night, add street lamps"
- **THEN** a new version becomes the panel image and the before/after slider compares it with the previous one

#### Scenario: Too many references
- **WHEN** the user adds a fifth uploaded reference
- **THEN** it is not added and "Up to 4 reference images" is shown

### Requirement: Working undo history for panel images
Every change of a panel's current image (generation, candidate selection, variant as candidate, edit, upload, restore) SHALL push an entry on that panel's image history, stored on the host with the panel as `{entries[] (AssetVersion ids, at most the 20 retained versions), position}`, and the panel SHALL offer working "Undo" and "Redo" buttons that move `position` backwards and forwards and make that version current, plus a "History" popover with thumbnails for direct selection. Because the history is host data it works after a reload, on another paired device and after a host restart. Undo never deletes a version; Redo is available until a new version is created after an Undo; each step marks the panel's video outdated exactly as any other change of the current image. Undo and Redo of the panel image also participate in the stage-level stack of "Undo and redo of studio edits". Agents use the same history through `jc_film_select_version {step: "undo" | "redo"}`. [NEW]

#### Scenario: Undo after edit
- **WHEN** the user edits a panel image and then presses Undo on the panel
- **THEN** the pre-edit image is current again, Redo is enabled, and the panel's video shows "Outdated" when it was made from the edited image

#### Scenario: Redo cleared by a new version
- **WHEN** the user undoes and then generates a new image
- **THEN** Redo is disabled and the undone version remains selectable in History

#### Scenario: Nothing to undo
- **WHEN** a panel has a single image version
- **THEN** its Undo button is disabled

#### Scenario: Undo on another device
- **WHEN** an image was edited on the desktop and the user opens the same panel on a phone
- **THEN** the phone's Undo button is enabled and pressing it restores the pre-edit image on both devices

### Requirement: Panel video generation
The Video stage SHALL list panels as cards (image or video player, index, duration, mode, model, status) with filters All / With video / Without video / Failed / Outdated and counts, and let the user generate a video per panel with the `video` role in one of four modes, each resolved on route `video.<mode>`: `text` (from the video prompt; no image); `image` (the panel image as first frame); `first_last_frame` (see "First and last frame mode"); and `reference` (text-to-video guided by the reference set of "Consistency through reference images including props" — same order, drop rule and labelling, limited by the model's declared reference count — plus, when native audio is on and the model declares audio references, the voice preview of the first bound line's speaker). A mode is offered only when the selected model declares it; `image`, `first_last_frame` and `reference` are mutually exclusive. The default mode is `image` when the panel has an image, else `reference` when the model declares it, else `text`. The prompt used is, in priority order: the first/last prompt (in that mode), the panel's video prompt, the panel's action; every request also carries the "Style" block of the style bible. The video prompt is editable in place with the hint "Describe people by appearance; video models do not know character names". Generation is available per panel, in batch, and as the `panel_videos` stage of the pipeline. A panel in `image` mode without an image shows "Generate the image first" with a shortcut to do so. [NEW]

#### Scenario: Image-to-video
- **WHEN** the user generates a video for a panel with an image in `image` mode
- **THEN** the request carries the panel image as first frame and the film aspect ratio, on route `video.image`

#### Scenario: Reference mode keeps identity
- **WHEN** a panel without an image is generated in `reference` mode with 2 cast members and 1 prop that have selected sheets
- **THEN** the request carries those 3 sheets as references, labelled by position in the prompt

#### Scenario: Mode not declared
- **WHEN** the selected video model does not declare `reference`
- **THEN** the `reference` option is disabled with "The selected model does not accept reference images"

#### Scenario: Filter failed
- **WHEN** the user selects the "Failed" filter
- **THEN** only panels whose last video job failed are listed, each with "Retry"

### Requirement: First and last frame mode
The user SHALL be able to link a panel to the next panel of the same clip (`linkToNext`); generating the linked panel's video in `first_last_frame` mode sends the panel's image as first frame and the next panel's image as last frame, with the first/last prompt. The mode is offered only for models whose catalogue entry declares it; with another model selected the option is disabled with "The selected model does not support first and last frames" and a model picker limited to supporting models. The last panel of a clip cannot be linked. When the next panel's image changes, the linked panel's video is marked outdated. [NEW]

#### Scenario: Linked generation
- **WHEN** panel 3 is linked to panel 4 and both have images
- **THEN** the request for panel 3 includes panel 3's image as first frame and panel 4's image as last frame

#### Scenario: Unsupported model
- **WHEN** the selected video model does not declare `first_last_frame`
- **THEN** the option is disabled with the stated message

#### Scenario: Next image missing
- **WHEN** panel 4 has no image
- **THEN** generating panel 3 in `first_last_frame` mode is blocked with "Panel 4 needs an image"

### Requirement: Video parameters by model capability
For each video generation the user SHALL be able to choose model profile, duration, resolution, frames per second and native audio, where each control offers only the values declared for the selected model in `generation-providers.Capability metadata`. The default duration is the smallest declared option ≥ the panel's `duration_ticks` (the largest option when none is ≥); the default resolution is the film's video resolution when declared, otherwise the nearest lower declared value. An invalid combination is rejected before queuing with `FILM_VIDEO_OPTION_UNSUPPORTED` naming the option and the nearest declared value. The native-audio toggle appears only for models that declare it, defaults to off when the panel has voice lines and on otherwise. A model whose metadata declares deferred delivery shows "Deferred — up to <n> h" next to its name and is never preselected. The estimated cost shown next to Generate updates within 300 ms of any option change. [NEW]

#### Scenario: Duration options
- **WHEN** the panel lasts 7 s and the model declares 5 s and 10 s
- **THEN** 10 s is preselected and only 5 s and 10 s are offered

#### Scenario: Native audio default
- **WHEN** the panel has 2 voice lines and the model supports native audio
- **THEN** the toggle is shown and off by default

#### Scenario: Unsupported option through a tool
- **WHEN** `jc_film_generate` requests 1080p from a model that declares 480p and 720p
- **THEN** the call fails with `FILM_VIDEO_OPTION_UNSUPPORTED` and `details {option: "resolution", nearest: "720p"}`, and no job is queued

### Requirement: Video candidates and versions
Panel video generation SHALL accept a candidate count of 1–4 (default 1) and store every result as an AssetVersion. On a panel that already has a video, regeneration keeps the current video in use until the user presses "Use" on a new one. The card provides a player with play/pause, scrub, loop and mute, a version switcher, "Download", and a toggle "Original | Lip-synced" when a lip-sync video exists. Restoring a previous video marks the panel's lip-sync video outdated. [NEW]

#### Scenario: Keep current during regeneration
- **WHEN** the user regenerates a panel video
- **THEN** the card keeps playing the current video until a new candidate is chosen with "Use"

#### Scenario: Restore marks lip-sync outdated
- **WHEN** the user restores video version 1 on a panel with a lip-sync video made from version 2
- **THEN** the lip-sync video shows "Outdated"

### Requirement: Speakers and voice sources
The Voice stage SHALL list the film's speakers with voice status (voice name and source, or "No voice") and line count, and allow assigning a voice in three ways: (1) "Choose from library" — pick a provider voice from `generation-providers.Voice catalogue` or a voice from the Asset hub, filterable by language and gender, with preview playback; (2) "Design a voice" — see "Voice design"; (3) "Clone from audio" — upload reference audio (MP3, WAV, OGG, M4A or AAC; up to 50 MiB; 3–60 s; sent through the blob route of `server-api` and attached with `jagentchill.film.voice.clone`) after ticking "I have the right to use this voice"; available only when the resolved `voice-tts` model declares cloning support in `generation-providers.Capability metadata`, otherwise the option is disabled with an explanation. Replacing a voice asks "Replace the voice of <speaker>? Existing takes are kept and marked outdated". Speakers can be added, renamed, merged (lines of one move to the other) and deleted (only when they have no lines). [NEW]

#### Scenario: Clone without consent
- **WHEN** the consent checkbox is not ticked
- **THEN** the upload button is disabled

#### Scenario: Cloning unsupported
- **WHEN** the resolved TTS model does not declare cloning
- **THEN** "Clone from audio" is disabled with "The current voice model cannot clone voices — choose or design a voice"

#### Scenario: Reference audio too short
- **WHEN** the uploaded audio lasts 2 s
- **THEN** it is rejected with "Reference audio must be 3 to 60 seconds"

### Requirement: Voice design
"Design a voice" SHALL use the `voice-design` role with: a description of 10–1,000 characters, a preview sentence in the film language of at most 300 characters and at least the minimum length the resolved design model declares in `generation-providers.Capability metadata` (when it declares none: 7 words, or 14 characters for languages written without word spaces), a name, and a count of 1–3 proposals (default 3). The description field offers exactly these six project-authored starting points, each inserting its text for editing:

| Starting point | Description text |
|---|---|
| Warm narrator | A warm, steady adult voice in a medium-low register, unhurried pace, clear articulation, gentle smile in the tone, suited to long narration. |
| Calm young woman | A soft, clear young adult female voice, medium pitch, even and relaxed delivery, light breathiness, natural conversational rhythm. |
| Energetic young man | A bright young adult male voice, medium-high pitch, quick lively pace, crisp consonants, upward enthusiastic inflection. |
| Authoritative man | A mature male voice in a low register, measured pace, firm emphasis on key words, little pitch variation, calm confidence. |
| Elderly storyteller | An older voice with slight roughness, slow pace with deliberate pauses, falling phrase endings, kindly and reflective tone. |
| Bright child-like voice | A light, high-pitched voice, bouncy rhythm, wide pitch movement, short phrases, playful curiosity. |

The starting-point labels and texts are locale resources (en, vi, ja). Each proposal is playable; "Use this voice" stores the provider voice id on the speaker and saves the preview as an asset; "Save to hub" also stores it in the Asset hub. Proposals are host records listed with the speaker; "Use this voice", "Save to hub" and discarding are `jagentchill.film.voice.proposal`; unused proposals are deleted provider-side when the dialog closes, and those of a dialog that was never closed after 24 h. With no `voice-design` route the action is disabled with "No voice design model configured" and a link to model routing. The estimated cost is shown before generating. [NEW]

#### Scenario: Three proposals
- **WHEN** the user generates with the default count
- **THEN** 3 playable proposals appear, each with "Use this voice"

#### Scenario: Starting point inserts its text
- **WHEN** the user picks "Elderly storyteller"
- **THEN** the description field holds that row's text and stays editable

#### Scenario: Preview sentence too short
- **WHEN** the preview sentence has 4 words
- **THEN** Generate is disabled with "Use at least 7 words so the voice can be judged"

### Requirement: Text-to-speech per line with takes
The Voice stage SHALL list the episode's lines in order (speaker, kind, text, bound panel thumbnail, emotion, intensity, rate, takes) and let the user generate speech per line with the speaker's voice on route `voice-tts.narration` for `narration` lines and `voice-tts.dialogue` for `dialogue` and `inner` lines. The line text is the only text sent as speech content; emotion, intensity and rate are passed through the model's declared style parameters and omitted when it declares none. Each generation adds a Take (48 kHz mono) with its measured `duration_ticks`. When a take is stored, the same job chain computes its word timings with one `generation.transcription` job on role `transcription` (its cost is part of the take's estimate, and the aligned words are matched to the line text, which stays the authority for wording): success stores `wordTimings` with `timing: "aligned"`; a missing `transcription` route or a failed alignment stores no word timings and `timing: "proportional"`, shown on the take as "Approximate subtitle timing" with "Align again". A line keeps at most 10 takes (the oldest non-active take is removed when an 11th is created); the newest take becomes active unless "Keep current take" is checked; the user can play, select, download and delete takes. Editing the text or changing the speaker's voice marks takes outdated (`Take.stale`). "Generate all" creates takes for lines without a take or with only outdated takes. Lines can be added, edited (speaker, kind, text), deleted, reordered and bound or rebound to a panel through a panel picker; "Locate" scrolls to the bound panel in the Storyboard or Video stage. With no `voice-tts` route the Generate controls are disabled with "No voice model configured" and a link to model routing. [NEW]

#### Scenario: Re-take
- **WHEN** the user generates a line that already has one take
- **THEN** a second take is added and becomes active, and the first remains selectable

#### Scenario: Take limit
- **WHEN** a line has 10 takes and a new one is generated
- **THEN** the oldest non-active take is removed

#### Scenario: Generate all
- **WHEN** 12 lines exist of which 5 have current takes
- **THEN** "Generate all" queues 7 jobs

#### Scenario: Narration route
- **WHEN** a `narration` line is generated
- **THEN** the job resolves route `voice-tts.narration`

#### Scenario: Word timings stored with the take
- **WHEN** a take of 2.5 s is generated and the `transcription` role has a route
- **THEN** the take is stored with `wordTimings` covering 0–2.5 s and `timing: "aligned"`, and the estimate shown before generating included the alignment

#### Scenario: No transcription model
- **WHEN** the `transcription` role has no route
- **THEN** the take is stored with `timing: "proportional"` and shows "Approximate subtitle timing"

### Requirement: Lip-sync
The user SHALL be able to lip-sync a panel's video to its voice lines with the `lipsync` role. The submitted audio is built by the same placement rule that "Assembly of an episode into a timeline project" uses for the Dialogue track, so that mouth movement and the audible voice coincide: 24,000 ticks (0.2 s) of leading silence, then the active takes of the lines bound to the panel, in order, separated by 24,000 ticks of silence; the user can deselect lines for that panel, and a deselected line is also left out of that panel's dialogue placement. Pre-processing, measured on that total: audio shorter than the model's declared minimum is padded with trailing silence to the minimum; when the audio is longer than the video by at most 240,000 ticks (2 s) the video is extended by holding its last frame; when it is longer by more, the task is not queued and the panel shows "Audio is 3.4 s longer than the video" with the actions "Regenerate video longer" and "Trim audio to video". The result is stored as the panel's lip-sync AssetVersion (`media.lipSync`) together with the list of take ids and offsets it was made from; the original video is kept and `useLipSync` selects which one is used in assembly. A subsequent change of a bound line's active take, of the set of bound lines or of the video marks the lip-sync outdated, and an outdated lip-sync version is not used by assembly. Lip-sync is disabled with a hint when the panel has no video or no take, and with "No lip-sync model configured" and a link to model routing when role `lipsync` has no route. [NEW]

#### Scenario: Mouth and voice start together
- **WHEN** a panel with one bound line of 2.0 s is lip-synced and assembled
- **THEN** the submitted audio is 0.2 s of silence followed by the take, mouth movement in the clip starts at 0.2 s, and the Dialogue element starts 0.2 s after the panel clip's start

#### Scenario: Short audio padded
- **WHEN** the take lasts 1.2 s and the model's minimum is 2 s
- **THEN** the submitted audio is 0.2 s of silence, the take and 0.6 s of trailing silence, and the card notes "Audio padded to 2 s"

#### Scenario: Audio much longer than video
- **WHEN** the audio including its lead-in lasts 8.4 s and the video 5 s
- **THEN** no task is queued and the two actions are offered

#### Scenario: Take replaced after lip-sync
- **WHEN** the user selects another take for a line of a lip-synced panel
- **THEN** `media.lipSync.stale` becomes true and the next assembly uses the panel's original video until the lip-sync is regenerated

#### Scenario: Prerequisites missing
- **WHEN** the panel has no video
- **THEN** the lip-sync button is disabled with "Generate the video first"

### Requirement: Music cues
The Sound stage SHALL manage MusicCue items per episode. A cue is anchored to the storyboard, not to clock time: `id`, `episodeId`, `order`, `from {panelId, fraction (0–1)}` and `to {panelId, fraction (0–1)}` (where in the panel sequence the music begins and ends; `to` lies after `from`), `brief` (what the music does here, 1–600 characters), `mood` (one of the eight moods of `audio-editing.Bundled sound pack`, or free text of 1–40 characters), `level_db` (the element volume it is placed with, in the range of `audio-editing.Clip volume in decibels`; default −18), `fades {in_ticks, out_ticks}` (each within what `audio-editing.Audio fades` allows for the placed length; defaults 0 and 180,000), `takes` (0–10 audio AssetVersions, `origin` `generated` or `library`), `activeTakeId` and `status` (`proposed`, `accepted`). The planned length of a cue is the planned duration of the panels it spans and is at least 240,000 ticks (2 s); a generated take requests the smallest duration the music model declares that covers it, or the largest declared one. "Suggest music" (the `score` node of the pipeline's `sound` stage) uses the `director` role to propose 2–3 ranked directions, each a set of cues that need not be contiguous, and the explicit choice "No music"; choosing — by a person, or by `sound_default` before the `check_sound` checkpoint — creates the chosen direction's cues and records the episode's `musicChoice` (`music` or `none`), and "No music" is never inferred from the absence of an answer. Cue audio is generated with the `music` role (instrumental by default; requests naming real artists or songs are rejected before the call with an explanation) or chosen from the music library of `audio-editing.Sounds library panel`; on a host without a generative music model the `music` role resolves to the bundled pack and the cue's take has `origin: "library"` ("Pipeline roles and missing routes"). Cues are shown on a ruler aligned to the episode's panel sequence and are draggable and resizable with snapping to panel boundaries. An episode has at most 1,000 cues, music and sound effects together. [NEW]

#### Scenario: No music chosen
- **WHEN** the user chooses "No music"
- **THEN** no cue is created and the episode records `musicChoice: "none"`, so the suggestion is not shown again automatically

#### Scenario: Cue snapped to a panel
- **WHEN** the user drags a cue start to within 8 px of a panel boundary
- **THEN** `from` becomes that panel with `fraction` 0

#### Scenario: Cue length limit
- **WHEN** the user resizes a cue below 2 s of planned length
- **THEN** the resize stops at 2 s

#### Scenario: Cue follows its panels
- **WHEN** a panel inside a cue's span is lengthened by 1 s
- **THEN** the cue's planned length grows by 1 s without any edit to the cue

### Requirement: Sound-effect cues
The Sound stage SHALL manage SfxCue items: `id`, `episodeId`, `panelId`, `offset_ticks` from the panel start, `description` (1–300 characters), `level_db` (range of `audio-editing.Clip volume in decibels`; default −12), `takes` (0–10 audio AssetVersions), `activeTakeId` and `status` (`proposed`, `accepted`). The length of an effect is the length of its audio: a generated take requests a length inside the range the resolved `sfx` model declares in `generation-providers.Capability metadata`, and a library sound keeps its own length. "Suggest sound effects" — the action in the stage, the kind `sfx_suggest` of `jc_film_generate`, and the `sfx_suggest` node of the pipeline's `sound` stage, which runs concurrently with `score` — uses the `director` role to propose at most 2 cues per panel from its action, never for sounds a bound line already describes; proposals are stored with `status: "proposed"` and each is accepted or dismissed by a person, or accepted together by `sound_default` before `check_sound`. Only accepted cues get audio. Audio is generated with the `sfx` role or chosen from the sound-effect library of `audio-editing.Sounds library panel`; without a generative model the role resolves to the bundled pack by keyword search ("Pipeline roles and missing routes"). A panel has at most 8 sound-effect cues and an episode at most 1,000 cues, music and sound effects together. [NEW]

#### Scenario: Accept a suggestion
- **WHEN** the user accepts "door slam" for panel 12
- **THEN** the cue's status becomes `accepted` and its audio task is queued

#### Scenario: Pipeline proposes effects
- **WHEN** the `sound` stage of a pipeline run executes for an episode with 20 panels and no cues
- **THEN** `sfx_suggest_apply` stores at most 40 proposed cues, `check_sound` shows them with the music directions, and `sound_audio` lists only cues that are `accepted` when it starts

#### Scenario: Cue limit per panel
- **WHEN** a panel has 8 cues and the user adds another
- **THEN** the add is refused with "Up to 8 sound effects per panel"

### Requirement: Subtitles
The system SHALL create subtitles for an episode from its voice lines when the episode is assembled. Assembly makes no model call for them: it reads only what is stored. One or more cues per placed line: the text is the line text, split with the line-length limits of `prompt-to-video-workflow.Captions step contract` for the film's aspect ratio; the timing comes from the active take's stored `wordTimings`, offset by the take's position in the assembled timeline; a take with `timing: "proportional"` has its cues distributed across the take in proportion to character count; and a bound line without a take — an episode made without a voice model — has its cues distributed across its panel's clip, after a lead-in of 24,000 ticks, in proportion to the character counts of that panel's lines. Translation is a costed step of its own, never part of assembly: with the episode setting `subtitles: "film-language-and-translation"` the `subtitle_translation` node of the `voice` stage — or "Translate subtitles" in the Voice stage, kind `subtitle_translation` of `jc_film_generate` — sends the episode's line texts to the `translation` role in batches of at most 100 lines, shows its estimate first, and stores the result per line in `translations[<translationLanguage>]`; assembly then writes the translated text as the second language of each cue with identical timing, and a line without a stored translation gets no second-language text and is listed in the assembly report under `warnings`. Subtitles are created as items on the caption track of the episode timeline (`captions-subtitles.Caption track and caption elements`; fields of `project-document.Caption track fields`), styled and edited there, and exportable as SRT and VTT through `captions-subtitles.Export captions`. The episode setting `subtitles` has the values Off, Film language (default), and Film language + translation (with a target language select). [NEW]

#### Scenario: Subtitles follow the takes
- **WHEN** a line's active take occupies 12.0–14.5 s in the timeline and has aligned word timings
- **THEN** its subtitle cues start at or after 12.0 s and end at or before 14.5 s, at word boundaries

#### Scenario: Assembly makes no model call
- **WHEN** an episode with 300 lines is assembled with subtitles on
- **THEN** no `generation.transcription` or `generation.translation` job is created by the assembly

#### Scenario: Bilingual
- **WHEN** the setting is "Film language + translation" with target English and every line has a stored English translation
- **THEN** each cue has a translated counterpart with the same start and end

#### Scenario: Translation not made yet
- **WHEN** the setting asks for a translation and 4 lines have none stored
- **THEN** those 4 cues have film-language text only and the assembly report warns "4 lines have no translation" with the action "Translate subtitles"

#### Scenario: Episode without takes
- **WHEN** a panel clip of 4 s has two bound lines of 20 and 60 characters and no takes
- **THEN** their cues occupy 0.2–1.15 s and 1.15–4.0 s of that clip

#### Scenario: Subtitles off
- **WHEN** the setting is Off
- **THEN** assembly creates no caption track

### Requirement: Assembly of an episode into a timeline project
"Assemble timeline" in the Timeline stage, the `assembly` stage of the pipeline and `jc_film_assemble` SHALL create (or update, see "Round-trip between studio and timeline") one real editor project for the episode, built only through editor commands and applied as a single undo step labelled "Film: Assemble episode <n>". The operation is one `film.step` job that reads the media variant `original`, calls no model and needs scope `jagentchill.generation.run`. Stored fields are those of capability `project-document` (`project-document.Canonical field list`); this requirement names fields and never restates their shape.

**Project.** Name "<film title> — Episode <number>"; one scene; canvas with the film's aspect ratio whose short edge is the film's `videoResolution` and whose long edge is derived from the ratio and rounded to an even number (16:9 at 720p = 1280 × 720; 9:16 at 1080p = 1080 × 1920; 21:9 at 1080p = 2520 × 1080); the film's frame rate (`project-document.Project settings`); project field `filmLink {filmId, episodeId}` (`project-document.Project provenance links`); all times integer ticks aligned to a frame. The project is created on the host replica, is a synced project of `cross-device-sync`, and its id is stored in the episode's `timelineProjectId`.

**Main track.** Panels in clip order then panel order, contiguous from tick 0, one element per panel that has media: the lip-sync video when `useLipSync` is true and a lip-sync version exists that is not outdated, else the panel video, else the panel image. A `video` element uses the media's full length (`trimStart` and `trimEnd` 0); an `image` element lasts the panel's `duration_ticks` rounded up to a whole frame and carries two keyframes, at its first and last frame, in the `animations` store (`project-document.Animation store`, `project-document.Animatable property paths`) for the panel's `cameraMotion`: `push-in` — `transform.scale.x` and `transform.scale.y` 1.00 → 1.08; `pull-out` — 1.08 → 1.00; `pan-left` / `pan-right` — scale 1.08 with `transform.position.x` travelling 4 % of the canvas width; `tilt-up` / `tilt-down` — scale 1.08 with `transform.position.y` travelling 4 % of the canvas height; every other value — none. Transitions between panels are cuts. A marker named "Clip <index + 1> — <first 40 characters of the summary>" is placed at the start of each film clip (`project-document.Markers`, `timeline-editing.Markers`).

**Dialogue.** An audio track "Dialogue" holds each bound line's active take as an `audio` element with `isVoice: true`, the first at its panel's start plus 24,000 ticks, several lines of a panel in order separated by 24,000 ticks — the same offsets the lip-sync audio of that panel was built with ("Lip-sync"), so a lip-synced mouth and its voice coincide. Each element's `volume` is set once at placement so that the take plays at the speech preset of `audio-editing.Loudness normalisation` (measured integrated loudness of the take against that preset, limited as that requirement states), so lines generated at different levels sit evenly; the value is an ordinary element volume and stays editable. When a panel's lines end after its clip, the clip is extended by a freeze element of its last frame (`project-document.Freeze field`, `speed-retime.Freeze frame`) to the end of the last line plus 24,000 ticks, rounded up to a whole frame. Lines without an active take and unbound lines are not placed. The source audio of a panel's video element is muted (`isSourceAudioEnabled: false`) when the panel has placed lines and set to `volume` −6 dB otherwise.

**Subtitles.** Per "Subtitles", from stored timings only, on a caption track named "Subtitles".

**Sound.** An audio track "Music" holds each accepted music cue's active take with its `fades` written to `fadeIn.duration` and `fadeOut.duration` and its `level_db` to the element `volume`, and the track's `ducking {enabled: true, amount: 12}` lowers it under elements flagged `isVoice` (`audio-editing.Equaliser, compressor and ducking`); an audio track "SFX" holds each accepted sound-effect cue at its panel's clip start plus `offset_ticks` with its `level_db`. A music cue's `from` and `to` are mapped onto the assembled timeline by the panel each names: the same fractional position inside that panel's element (including its freeze extension); a take shorter than the mapped span is not repeated and ends with its fade-out; a cue whose panels were all omitted, or without an active take, is not placed and is reported.

**Missing media.** Panels with neither image nor video are listed before assembly ("4 panels have no media") with "Generate missing" and "Assemble without them"; assembly never inserts dummy media. Called by a tool or by a pipeline run, the operation proceeds without them and reports them, and "Episode review" turns each into a blocker.

**Links and result.** Every created element carries `filmLink` with `filmId`, `episodeId`, the `panelId`, `lineId` or `cueId` it came from and `assetVersionId` (`project-document.Project provenance links`, `timeline-editing.Element provenance link`). The result is an assembly report `{projectId, revision, clips, stillPanels[], dialogueElements, captionCues, musicElements, sfxElements, omittedPanels[], unplacedLines[] {lineId, reason: "unbound" | "no_take" | "panel_omitted" | "deselected"}, unplacedCues[] {cueId, reason}, extendedPanels[], warnings[]}` shown in the Timeline stage and returned by the tool. The Timeline stage embeds the editor's preview of the project and offers "Open in editor". Writing obeys the edit lease: when a device holds the project's lease the batch is handed to that device and applied by it, otherwise the host applies it as a host principal of `cross-device-sync.Host principal lease` — `film:<filmId>` when a person started the action outside a run, `run:<runId>` when a workflow run's `assembly` stage started it, `agent:<sessionId>` when an agent session did (`agent-editing-tools.Edit lease coordination`, `cross-device-sync.Single-writer edit lease`). Assembling an episode of 600 panels and 1,000 lines completes within 30 s on the reference host of `diagnostics-quality.Performance budgets`, excluding media variant creation; because subtitles and loudness use stored measurements, no part of that budget waits for a provider. [NEW]

#### Scenario: Tracks created
- **WHEN** an episode with 20 panels (all with video), 14 bound lines with takes, 1 music cue and 3 sound-effect cues is assembled
- **THEN** the project has 20 contiguous main-track elements, 14 elements on "Dialogue", cues on "Subtitles", 1 element on "Music" and 3 on "SFX", each with a `filmLink`
- **AND** the report lists 20 clips and no omitted panel

#### Scenario: Canvas from film settings
- **WHEN** a film with ratio 9:16, 720p and 24 fps is assembled
- **THEN** the project canvas is 720 × 1280 at 24 fps

#### Scenario: Dialogue longer than its panel
- **WHEN** a 4 s panel clip at 24 fps has two lines of 2.5 s and 2.5 s
- **THEN** the lines occupy 0.2–2.7 s and 2.9–5.4 s of the panel and its clip is extended by a last-frame freeze to 5.625 s (5.6 s rounded up to a whole frame)

#### Scenario: Still image with camera motion
- **WHEN** a panel without video has `cameraMotion: "push-in"` and lasts 4 s
- **THEN** its element is a 4 s `image` element with keyframes on `transform.scale.x` and `transform.scale.y` of 1.00 at its first frame and 1.08 at its last

#### Scenario: Lines at different levels
- **WHEN** two takes measure 8 LU apart
- **THEN** their Dialogue elements carry different `volume` values and play at the same integrated loudness within 1 LU

#### Scenario: Panels without media
- **WHEN** 4 panels have neither image nor video
- **THEN** a dialog lists them with "Generate missing" and "Assemble without them", and choosing the second omits those panels and names them in the report

#### Scenario: Unbound line reported
- **WHEN** one line has a take and no panel
- **THEN** it is not placed and the report lists it with reason `unbound`

#### Scenario: One undo step
- **WHEN** the user opens the freshly assembled project in the editor and presses Undo once
- **THEN** every element created by the assembly is removed in that single step

### Requirement: Round-trip between studio and timeline
After assembly the link SHALL work in both directions through `filmLink`.

**Studio → timeline.** When a panel's current video, lip-sync video or image changes (including Undo and Redo of the panel image), or a line's active take or a cue's audio changes, the host builds one batch of `ReplaceElementSource` commands (`timeline-editing.Element provenance link`) for every element of the episode's own timeline project (`timelineProjectId`) whose `filmLink` names that panel, line or cue, with the new `assetVersionId` — an element that was pasted into another project keeps its link and is never updated from the studio: start time, track, transform, crop, effects, masks, adjustments, animations, keyframes and transitions are kept; the element's `trimStart` and `trimEnd` are preserved, clamped to the new source duration, so that every part of a split clip keeps its own in-point after a regeneration; the element keeps its duration when the remaining media is at least as long and is otherwise shortened to it, the main-track elements after it ripple, and it shows the "Trim adjusted" badge that command defines. An element that was split shares its `filmLink`; every part is updated. The batch is applied as one undoable editor command titled "Update from studio", through the lease path stated in "Assembly of an episode into a timeline project": handed to the device holding the lease (state "Waiting for <device name>" while that device answers busy), else applied by the host under the same host principal rule (`film:<filmId>` for a change a person made in the studio outside a run). The film setting `timelineUpdates` has the values Automatic (default) and Ask (changes accumulate under "n studio changes" in the Timeline stage with "Apply" and "Discard"; the list, applying and discarding are `jagentchill.film.timeline.pending` and `.timeline.apply`). The host keeps the inverse of every applied batch for 30 days: "Revert" on the batch's row in the Timeline stage (`jagentchill.film.timeline.revert`) applies the inverse as a new command and is refused, listing the elements, when edits made since touch the same elements.

**Re-assemble.** "Re-assemble" merges structural changes into the existing project: clips of new panels are inserted at their order position; clips of deleted panels are removed after confirmation; reordered panels are moved only when "Also reorder" is ticked; dialogue, subtitles and cues are re-placed for changed panels only; elements without a `filmLink` are never altered, and elements whose `filmLink` was removed by "Unlink" are treated as manual.

**Timeline → studio.** Selecting a linked element in the editor shows the provenance chip of `timeline-editing.Element provenance link` ("From film · Panel 12") with "Open panel", "Regenerate image", "Regenerate video" and "Unlink". Replacing a linked element's media by hand clears its `filmLink`. Edits in the editor never change studio data. When the project is in the Trash the Timeline stage offers "Restore project" and, after its retention, "Assemble timeline" again. [NEW]

#### Scenario: Regenerated panel updates its clip
- **WHEN** the user selects a new video for panel 7 after assembly with updates Automatic
- **THEN** the element linked to panel 7 plays the new video at the same timeline position with its effects and keyframes intact, and one Undo in the editor restores the previous source

#### Scenario: New media shorter than the clip
- **WHEN** the clip lasts 6 s and the new video lasts 5 s
- **THEN** the clip becomes 5 s, the main-track clips after it move 1 s earlier, and the clip shows "Trim adjusted"

#### Scenario: Split clip
- **WHEN** the user had split panel 7's clip into two parts and panel 7's video is regenerated
- **THEN** both parts are updated to the new video, each keeping its own position and effects

#### Scenario: Manual edits preserved on re-assemble
- **WHEN** the user added a title element in the editor and then runs "Re-assemble" after adding 2 panels
- **THEN** 2 clips are inserted at their order positions and the title element is unchanged

#### Scenario: Lease held by another device
- **WHEN** a phone holds the project's edit lease and a panel video changes
- **THEN** the batch is handed to the phone and applied there, and the Timeline stage shows "Waiting for <device name>" until it reports applied

#### Scenario: Revert refused after newer edits
- **WHEN** the user trimmed the updated clip in the editor and then presses "Revert" on that update
- **THEN** the revert is refused and the dialog names the clip that was edited since

#### Scenario: Unlinked clip
- **WHEN** the user unlinks a clip
- **THEN** subsequent changes to its panel no longer affect the clip, and "Re-assemble" leaves it untouched

#### Scenario: Regenerated video under a split clip
- **WHEN** the user split a panel's 6 s clip at 2 s, and the panel's video is regenerated with a new 6 s video
- **THEN** the first part still shows source 0–2 s and the second part source 2–6 s of the new video, and neither part restarts at the media start

### Requirement: Final film export
The user SHALL be able to export one episode, or the whole film, as a single video file; rendering, encoding, joining, progress, retention and download are owned by `export-share`. An episode export is a job of `export-share.Host-initiated export` (`createdBy.kind: "film"`) for the episode's timeline project, also reachable as the `export` stage of the pipeline. A whole-film export is one job of `export-share.Multi-project sequence export` (`sequence {projectIds, gapTicks}`; job kinds `export.sequence` and `media.concat`) over the timeline projects of the selected episodes in episode-number order — at most the 200 episodes a film can have; a film with a single selected episode is exported as an episode export. The export dialog (scope `jagentchill.export.run`) lists every episode with a checkbox, its timeline duration and state — "Ready"; "Not assembled" with "Assemble"; "Has studio changes not applied" with "Apply"; "Canvas or frame rate differs from the film" with "Reset to film settings" (the state `export-share` reports as `export/sequence-mismatch`) — and Export is enabled only when every ticked episode is "Ready". Options: the gap between episodes, "Cut" (default) or black of 0.5–3 s (60,000–360,000 ticks); an export preset of `export-share.Built-in export presets` (default `match-project` at the film's resolution and frame rate); captions burnt in or as sidecar files (`captions-subtitles.Burn-in and sidecar captions at export`); and the film's "Visible AI label on exports".

**Codec.** What the host can encode is read from `server-api.Host encoder policy and codec table` and shown in the dialog before anything is queued: H.264 with AAC in MP4 when the host has a hardware H.264 encoder or OpenH264 was accepted at host setup; otherwise the dialog preselects VP9 with Opus in WebM with the note "This host has no H.264 encoder — exporting WebM. An admin can enable H.264 in host settings", and AV1 is offered where listed. The host's software path is always present, so a film export is never blocked for lack of an encoder and never prompts during the export. Every segment of a whole-film export uses the one codec and container chosen for the job. A request for a codec that is not available — from a tool or an automation — fails at once with `export/codec-unavailable` listing the alternatives, unless the request carries `codecPreference`, whose first available entry is used; the pipeline's `export` node declares `codecPreference` H.264, then VP9.

**Where it runs.** Film exports run only on the host: when it does not advertise `remote-export` the dialog shows "This host cannot export — open an episode in the editor to export on this device" and Export is disabled; inside a pipeline run the `export` node then ends `skipped` with reason `no_renderer`. Every export carries `export-share.Provenance metadata` and, per "Content provenance labels", the visible label option. The job appears in the film's Tasks panel and in the export queue of `export-share.Export queue`; a finished file is recorded as a FilmExport ("Versioning of generated assets") and listed under Film settings ▸ "Exports" with episode range, container and codec, duration, size and "Download", downloadable from any paired device — on iOS and Android through the system share sheet or "Save to Files" / the downloads folder, on desktop and web as a file download. [NEW]

#### Scenario: Whole-film export
- **WHEN** the user exports a film with 3 ready episodes of 60 s, 75 s and 45 s with gap "Cut"
- **THEN** one file is produced whose duration is 180 s within one frame per join, and one FilmExport record with `kind: "film"` and the 3 episode ids exists

#### Scenario: Black gap
- **WHEN** the same film is exported with a black gap of 1 s
- **THEN** the file lasts 182 s within one frame per join and frames inside each gap are black and silent

#### Scenario: Episode not assembled
- **WHEN** episode 2 of 3 has no timeline
- **THEN** the dialog lists episode 2 as "Not assembled" with "Assemble", and Export is disabled until it is assembled or unticked

#### Scenario: Canvas changed by hand
- **WHEN** the user changed episode 2's project canvas to 1:1 in the editor of a 16:9 film
- **THEN** the dialog lists it as "Canvas or frame rate differs from the film" with "Reset to film settings"

#### Scenario: Host without H.264
- **WHEN** the host's codec table has no H.264 encoder
- **THEN** the dialog preselects WebM with VP9 and Opus with the stated note, and the export completes in that format for every episode of the sequence

#### Scenario: Unavailable codec from a tool
- **WHEN** `jc_film_export` asks for H.264 without `codecPreference` on that host
- **THEN** the call fails with `export/codec-unavailable` listing VP9 and AV1, and no job is created

#### Scenario: Host cannot export
- **WHEN** the host does not advertise `remote-export`
- **THEN** Export is disabled with the stated message and no job is created

### Requirement: ZIP export of per-panel assets
The user SHALL be able to download a ZIP archive for an episode or the whole film (scope `jagentchill.export.run`), choosing what to include: panel images, panel videos (option "Prefer lip-synced", default on), voice takes (active only or all), music and sound-effect audio, character / location / prop sheets, the style bible (Markdown), subtitles (SRT) and data (JSON). The archive is built on the host as a streamed ZIP64 by one `film.step` job, recorded as a FilmExport of kind `archive`, stored and retained like a host export (`export-share.Remote export contract`), and downloaded through `server-api.Authenticated media delivery`, resumable by `Range` after interruption. Layout: `<film>/episode-<NN>/panels/<clip>-<panel>_image.<ext>`, `…_video.mp4`, `…_lipsync.mp4`; `episode-<NN>/voice/<order>_<speaker>.wav`; `episode-<NN>/sound/`; `assets/characters|locations|props/<name>/`; `episode-<NN>/subtitles.<lang>.srt`; `style-bible.md`; `film.json` (film, episodes, clips, panels, lines, cues); `provenance.json`. Numbers are zero-padded to 3 digits; names are sanitised to `[A-Za-z0-9_-]` plus Unicode letters, at most 60 characters. Items without media are skipped and counted in the summary ("212 files, 6 panels without video"). The dialog shows the estimated size before starting. [NEW]

#### Scenario: Prefer lip-synced
- **WHEN** a panel has both original and lip-sync videos and "Prefer lip-synced" is on
- **THEN** the archive contains that panel's lip-sync video under `_video.mp4` and no duplicate

#### Scenario: Nothing to export
- **WHEN** the selected content types have no files
- **THEN** the dialog shows "Nothing to download" and no archive is created

#### Scenario: Interrupted download
- **WHEN** the connection drops at 60 % of the download
- **THEN** the download resumes from the received byte offset when the connection returns

### Requirement: Asset hub shared across films
The app SHALL provide an Asset hub (route `…/film/hub`, opened from the Film Studio list and from a film's top bar) holding characters (with appearances), locations (with variants and slots), props and voices that are independent of any film, stored on the host like film data, with tabs All / Characters / Locations / Props / Voices, search by name, and the same generate / candidate / select / edit / history actions as film assets (using the globally resolved ORC routes; the film methods and tools accept `hub: true` in place of `filmId` for them). Hub records: a HubFolder is `{id, parentId?, name (1–60 characters, unique among siblings), order}`, nested at most 3 levels, at most 500 folders; a hub character, location or prop is the film entity of "Character, appearance, location and prop entities" without `filmId`, plus `folderId?` and `revision` (an integer that increases with every change of its fields or selected images); a HubVoice is `{id, folderId?, name, voice (the Speaker `voice` object), language, genderTag?, revision}`. From a film the user can "Import from hub" (asset picker, multi-select; `jagentchill.film.hub.import`); importing copies the asset and its selected images into the film with `hubSourceId` and `hubSourceRevision` set, so that changes afterwards in either place do not affect the other, and "Save to hub" (`jagentchill.film.hub.save`) copies a film asset into the hub. An imported asset whose hub source has a higher `revision` than its `hubSourceRevision` shows "Newer version in hub" with "Update from hub", which replaces the film asset's description fields and selected images by the hub's (kept in version history, user-edited fields listed for confirmation first) and sets `hubSourceRevision`. Deleting a hub asset does not affect films; deleting a folder moves its content to the parent. "Download all" exports the hub or a folder as ZIP (`jagentchill.film.archive {hub: true, folderId?}`). Hub assets are the ones `script-studio.Character, location and prop references` links through `hubAssetId`. [NEW]

#### Scenario: Import a character
- **WHEN** the user imports a hub character with 2 appearances into a film
- **THEN** the film gains a confirmed character with both appearances and their selected sheets, `hubSourceId` and `hubSourceRevision` set

#### Scenario: Name clash on import
- **WHEN** the film already has a character with the same name
- **THEN** the dialog offers "Replace", "Keep both" (suffix " 2") and "Skip"

#### Scenario: Newer version in hub
- **WHEN** a hub character at revision 4 was imported and its hub sheet is then replaced, making it revision 5
- **THEN** the film's copy shows "Newer version in hub", and "Update from hub" selects the new sheet, keeps the previous one in history and sets `hubSourceRevision` to 5

#### Scenario: Fourth folder level
- **WHEN** the user creates a folder inside a folder at level 3
- **THEN** the action is refused with "Folders can be nested 3 levels deep"

#### Scenario: Empty hub
- **WHEN** the hub has no assets
- **THEN** it shows "No shared assets yet" with "New character", "New location", "New prop" and "New voice"

### Requirement: Batch operations
Each stage SHALL offer batch actions over a selection (range, toggle and select-all through the selection actions of `keyboard-shortcuts`; on touch a "Select" mode with checkboxes) or over the stage's whole scope: confirm profiles; generate / regenerate asset images; generate panel images (all, missing, outdated, failed); generate videos (all, missing, outdated, failed) with a configuration dialog (model profile, mode, duration rule, resolution, native audio, candidate count); generate takes; lip-sync; delete; move panels. Before queuing, the confirmation shows the item count, the items that will be skipped with reasons, the estimated total cost in USD and time (`generation-providers.Cost estimate`), the remaining film budget, and every provider on the resolved routes that would receive project-derived content without consent under `generation-providers.Data leaving the machine`, each with "Allow for <provider>"; the confirm button stays disabled until each is allowed. Whether a user-started batch needs this confirmation is rule 6 of `generation-providers.Approval thresholds and spending caps` ("Ask before spending more than", host default 0 USD = always; the per-device tick "Do not ask again below <amount>" never exceeds the host value), and a batch that lists a provider without consent always shows it; this capability defines no amount of its own; agent-started batches are governed by `agent-editing-tools.Cost guard` instead. A batch creates one job per item (at most 500 items per batch) grouped under a `batchId`; when a hard-stop budget is reached the remaining items are not queued and are counted as "skipped (budget)". On completion it reports "n succeeded, m failed, k skipped" with "Retry failed". [NEW]

#### Scenario: Generate missing videos
- **WHEN** 30 panels lack a video and 4 of them lack an image in `image` mode
- **THEN** the confirmation states 26 to generate, 4 skipped ("no image"), with total cost and time estimates

#### Scenario: Batch size limit
- **WHEN** the selection contains 620 panels
- **THEN** the dialog states that the batch is limited to 500 items and offers to queue the first 500

#### Scenario: Consent missing
- **WHEN** the resolved `video` provider has no consent and the batch sends panel images
- **THEN** the confirmation lists "Allow for <provider>" and its confirm button is disabled until it is pressed

#### Scenario: Budget reached mid-batch
- **WHEN** the film budget's hard stop is reached after 18 of 26 jobs were queued
- **THEN** 8 items are not queued and the summary reads "… 8 skipped (budget)" with "Raise budget" visible to devices with scope `jagentchill.config.write`

#### Scenario: Partial failure summary
- **WHEN** a batch of 26 ends with 24 succeeded and 2 failed
- **THEN** a summary "24 succeeded, 2 failed" is shown with "Retry failed"

### Requirement: Task execution, limits and recovery
Every generation and analysis action of the studio SHALL be a job of the single queue of `server-api.Background job queue` — kind `generation.<image|video|tts|voice-design|music|sfx|lipsync|transcription|translation>` for media and `film.step` for model analysis, assembly and archives — with the queue's states (`queued → running → succeeded | failed | cancelled`), event (`jagentchill.job.updated`) and job record; the studio defines no task record, heartbeat, state or event of its own and calls these jobs "tasks" only in the UI. Each job carries `targetType`, `targetId` and `batchId` so that the studio can show it on its target. The following are referenced, not restated: retries, retry delays and route fallback — the single policy `generation-providers.Retry policy` with the route order of `orc-model-routing.Route resolution and fallback`; provider concurrency and priority — `generation-providers.Concurrency and rate limits`; stall detection, cancellation and recovery after a host restart (a stored provider task id resumes polling and is never resubmitted) — `server-api.Job cancellation and restart recovery` and `generation-providers.Generation job lifecycle`; provider result caching — `generation-providers.Result caching by input hash`, to which the studio passes `reuse: true` for pipeline re-runs of unchanged items and `cache: "bypass"` for every explicit Generate, Regenerate and additional-candidate request. The studio adds only these rules: a second request for the same target and kind while one is `queued` or `running` returns that job instead of creating a duplicate; per film at most 4 `film.step` model jobs, 4 image, 2 video, 4 speech and 2 lip-sync jobs are `running` at once (each a film setting, 1–8), always inside the provider limits, which are shared with every other capability; a job that fails for missing consent ends `failed` with `PERMISSION_DENIED` and its target offers "Allow and retry". Notifications use only kinds of `notifications.Notification event catalogue`, one per outcome: a batch (one `batchId`) raises `generation.batch_finished` with its succeeded and failed counts and no per-item notification; a stage-level action — a pipeline run restricted to a stage range, or a `film.step` job for preparation, assembly or an archive — raises `film.step_finished` or `film.step_failed` once when it reaches a terminal state; a checkpoint of "Stage checkpoints and approval policies" that waits for a person raises `film.step_review_required` — the more specific kind, set on the approval node as `notificationKind` by the template's instantiation hook (`agent-workflows.Approval node`), so `workflow.approval_required` is not raised for it — except the script approval, which raises `script.review_required`; a run paused on a budget, a missing route of a required role or a provider account problem raises `workflow.paused`. Jobs and runs started by a device that is revoked are cancelled with reason `device_revoked`; those started by other devices are unaffected. Inside a pipeline run the same jobs are created by the stage nodes, and node retry, status and recovery are the engine's. **Gateway outage.** While the supervised OpenClaw Gateway is not linked (`server-api.Gateway supervision and lifecycle`) the studio applies the rule of `server-api.Job cancellation and restart recovery` and adds none of its own: a pipeline node that needs the Gateway is parked by the engine as `ready` with `blockedBy: "waiting_gateway"` (`agent-workflows.Storage, RPC surface and Gateway dependency`); a `film.step` job whose model call runs through an agent turn of the Gateway (an LLM role served by a runtime or by an OpenClaw provider) is parked with the wait reason `waiting_gateway`, shown on its target as "Waiting for the agent engine", and starts again with the same input within 5 s of the link being ready; either fails with `GATEWAY_UNAVAILABLE` after 600 000 ms parked and then offers "Retry" on its target. Jobs that do not need the Gateway — media generation served by the server's own providers, assembly, archives, export — and every manual edit of the studio keep running. [NEW]

#### Scenario: Duplicate request
- **WHEN** the user presses Generate twice on the same panel image within 1 s
- **THEN** one job exists and both presses show its progress

#### Scenario: Restart during a video job
- **WHEN** the host restarts while a video job with a stored provider task id is running
- **THEN** the job resumes polling that provider task after restart and no second provider request is made

#### Scenario: Film video limit
- **WHEN** the film's video limit is 2 and a batch of 10 videos is queued
- **THEN** at most 2 of the film's video jobs are `running` at any time and the others stay `queued`

#### Scenario: Regenerate bypasses the cache
- **WHEN** the user presses Regenerate on a panel image whose inputs are unchanged
- **THEN** the request carries `cache: "bypass"`, a provider call is made and a new candidate is produced

#### Scenario: One notification for a stage checkpoint
- **WHEN** the `check_storyboard` checkpoint of a pipeline run waits for a person
- **THEN** exactly one `film.step_review_required` notification is raised and no `workflow.approval_required` notification is raised for the same item

#### Scenario: Storyboard run during a Gateway restart
- **WHEN** an episode's storyboard pass is running one `film.step` model job and four panel image jobs on a server-side provider, and the supervised Gateway restarts and is linked again after 40 s
- **THEN** the model job is parked with wait reason `waiting_gateway` and starts again within 5 s of the link being ready, and the four image jobs finish without interruption

#### Scenario: Gateway down for ten minutes in the studio
- **WHEN** a `film.step` model job has been parked with `waiting_gateway` for 600 000 ms
- **THEN** the job is `failed` with `GATEWAY_UNAVAILABLE` and its target shows "Retry"

### Requirement: Task queue UI
The Tasks button SHALL open a panel (right side panel 400 px wide on desktop and web; full-height sheet on the compact form factor) listing the film's jobs newest first with kind icon, target name (click navigates to it), status, progress bar, elapsed time, cost in USD, provider and model, grouped by batch with a batch progress row; pipeline runs of the film's episodes appear as rows that open the run. Controls: filter by status (Active, Failed, Done) and kind; per job Cancel (active), Retry (failed), Dismiss (failed; hides it and clears the error badge on the target), "View error" (code, message, provider diagnostic, Copy); per batch "Cancel all" and "Retry failed"; "Clear finished". The badge on the Tasks button shows the number of active jobs and turns to the danger colour when any job failed and is not dismissed. Progress updates appear within 500 ms of the event. Each target (panel card, asset card, line row) also shows its own inline status (spinner with percentage, or error chip with Retry). Finished jobs are listed for 30 days. [NEW]

#### Scenario: Cancel a running job
- **WHEN** the user cancels a running panel-video job
- **THEN** the job becomes `cancelled`, the panel shows no spinner, and its previous video remains current

#### Scenario: Dismiss a failure
- **WHEN** the user dismisses a failed job
- **THEN** it leaves the Failed filter and the error chip disappears from its target

#### Scenario: No tasks
- **WHEN** the film has no jobs
- **THEN** the panel shows "No tasks"

### Requirement: Cost estimates and budgets
The studio SHALL show an estimated cost in USD next to every billable action (single generate buttons show it on hover on pointer devices and in the action's confirmation sheet on touch; dialogs and batches show it inline), computed by `generation-providers.Cost estimate` for the resolved model and chosen options; models without a price show "Price unknown". Budgets are owned by `generation-providers.Budgets with hard stop`: the film budget is a budget of scope `film` (`limitUsd`, `warnAt` 0.8, `hardStop`) referenced by `budgetId`, and global, provider, session, run and automation budgets apply as that requirement defines; the studio keeps no ledger. The film header shows spend to date and, when a film budget is set, a meter "spent / budget"; at 80 % a warning banner is shown. An action that a hard-stop budget would not admit is not queued: it returns `BUDGET_EXCEEDED`, and the studio shows a dialog with "Raise budget" (devices with scope `jagentchill.config.write`; others see "Ask an admin device to raise the budget") and "Cancel" — there is no bypass action; running jobs are never interrupted by a budget. Models without a price follow the budget's "Allow unknown-cost models" setting of that requirement. Film settings ▸ "Costs" shows spend by role, model, stage and episode for a selectable date range and "Export CSV", both rendered from the unified usage query of `usage-tracking.Unified usage query` filtered by `filmId`. [NEW]

#### Scenario: Budget block
- **WHEN** spend is 18.50 USD, the film budget 20.00 USD with hard stop, and a batch is estimated at 3.20 USD
- **THEN** the batch is not queued and the dialog offers "Raise budget" and "Cancel" only

#### Scenario: Unknown price under a hard stop
- **WHEN** the resolved model has no price and the film budget does not allow unknown-cost models
- **THEN** the action shows "Price unknown" and is refused with `BUDGET_EXCEEDED` and the hint "Allow unknown-cost models in the budget or choose a priced model"

#### Scenario: Cost report
- **WHEN** the user opens "Costs" for the last 30 days
- **THEN** totals per role, model, stage and episode are listed and "Export CSV" downloads the same rows

### Requirement: Content provenance labels
Every AssetVersion SHALL keep a provenance record: `origin`, `provider`, `model`, ORC role and route, prompt hash, `styleBibleVersion`, reference asset ids, `createdAt_ms` and, for uploads and cloned voices, the uploader device and the consent flag; generated assets enter the media library with `media-library.AI-generated asset provenance`. In the UI, generated and edited media show an "AI-generated" label in their details and a small corner badge in grids (film setting `showAiBadges`). Episode and film exports carry the metadata of `export-share.Provenance metadata`, which computes the digital source type from the timeline's elements (an element whose `filmLink` names an AssetVersion with `origin` `generated` or `edited` counts as AI-generated; one with `origin` `uploaded` does not), and when the film setting `visibleAiLabel` is on the studio creates the export with `aiLabel: true` (`export-share.AI label burn-in`, which owns the label's text, size, position and opacity). Single-file downloads and ZIP contents are written by the host with the same per-format encoding and values as that requirement: the trained-algorithm source type for `generated` and `edited` versions, no source type for `uploaded` ones. ZIP exports include `provenance.json` listing every file with its record. Provenance metadata is never removed by any export option of the studio. Voice cloning requires the consent tick of "Speakers and voice sources", and the consent flag, device and time are part of the cloned voice's record, which is the record the consent rules of `security-privacy.Provider data disclosure and consent` rely on. [NEW]

#### Scenario: Metadata on a final film
- **WHEN** a film whose timeline holds only generated panels is exported
- **THEN** the exported file's metadata declares the trained-algorithm digital source type

#### Scenario: Manual footage added in the editor
- **WHEN** the user added their own video clip to an episode timeline and the film is exported
- **THEN** the exported file's metadata declares the composite digital source type

#### Scenario: Visible label
- **WHEN** `visibleAiLabel` is on
- **THEN** the export job is created with `aiLabel: true` and every exported frame shows the label defined by `export-share.AI label burn-in`

#### Scenario: Uploaded image
- **WHEN** the user uploads their own image as a panel image
- **THEN** its record has `origin = uploaded` and it shows no AI badge

### Requirement: Undo and redo of studio edits
Every user edit in the studio (text and field edits, panel reorder / insert / delete / split / merge, cast and binding changes, selection of candidates and versions, cue edits, speaker changes, style bible edits) SHALL be an undoable command on a per-film stack of 100 entries per device, triggered by the actions `edit.undo` and `edit.redo` of `keyboard-shortcuts` on desktop and web and by Undo / Redo buttons in the stage toolbar on all platforms. Generation jobs are not undone by Undo (spent cost is not reversible); undoing the selection that followed a generation restores the previous current version. The stack is cleared when the film is closed. Undo of an edit that conflicts with a newer change from another device or an agent is skipped with the toast "Unable to undo — changed elsewhere". Changes made on the host without a device — agent tool calls, pipeline `_apply` nodes and checkpoint decisions by policy — are recorded as mutation batches `{batchId, filmId, actor {sessionKey?, runId?, nodeId?}, label, inverse[], created_ms}` kept for 30 days: each batch is pushed as one entry onto the stack of every device that has the film open, is listed in Film settings ▸ "Activity" with "Revert", and is revertible with `jagentchill.film.batch.revert {batchId}` (scope `jagentchill.projects.write`), which applies the inverse as a new change and is refused with `CONFLICT` and the list of fields when a newer edit touched them. [NEW]

#### Scenario: Undo a merge
- **WHEN** the user merges two panels and triggers `edit.undo`
- **THEN** both original panels return with their media and line bindings

#### Scenario: Undo does not cancel a job
- **WHEN** a generation is running and the user presses Undo
- **THEN** the previous edit is undone and the job keeps running

#### Scenario: Revert an agent change after reopening
- **WHEN** an agent changed 6 panels' camera motion yesterday and the user opens "Activity" today and presses "Revert" on that batch
- **THEN** the 6 panels return to their previous camera motion as one new change

#### Scenario: Revert conflict
- **WHEN** the user edited one of those panels' camera motion after the agent's batch and then presses "Revert"
- **THEN** the revert is refused and the dialog names that panel's field

### Requirement: Film tools for agents
The server SHALL offer the tool family `jc_film_*` on its agent tool endpoint (`server-api.Agent tool endpoint and session binding`; MCP, named here by base name — the runtime's prefix is stated only in `agent-editing-tools.Tool naming and families`), defined here and listed in the index of `agent-editing-tools.Tool naming and families`; every tool takes no caller-identity parameter (a call the server cannot bind to a session fails `SESSION_UNBOUND`, `agent-editing-tools.Common parameter conventions`), returns the envelope of `agent-editing-tools.Result envelope`, accepts `idempotencyKey` and `dryRun` on writes, resolves the device and scopes from the server's record of the session the call is bound to (an MCP tool call carries no device or session identity of its own) and runs through the same validation, commands, budgets and jobs as the UI. `filmId` is optional exactly where a tool states `hub?`: with `hub: true` the target is the Asset hub. Together the 17 tools cover every action a person can take in the studio except those that need a person by rule (the consent tick of voice cloning, a `human` checkpoint):
- `jc_film_list {query?, limit (1–50)}` and `jc_film_get {filmId?, hub?, episodeId?, include?: ("episodes" | "direction" | "characters" | "locations" | "props" | "clips" | "panels" | "voice_lines" | "cues" | "speakers" | "jobs" | "readiness" | "review" | "exports" | "activity" | "pendingTimeline" | "storyboard_versions" | "hub_folders" | "stage_input")[], stage?, targets?, ids?[]}` — read; `stage_input` returns the loader snapshot of "Film pipeline template" for `stage` with content hashes and the item list for `targets`; results follow `agent-editing-tools.Result size limits and pagination`. The manifest marks `jc_film_get` `readOnly` with `readsAmbientState: true`, so it is never served from cache.
- `jc_film_create {title, story?, aspectRatio?, artStyle?, language?}`.
- `jc_film_update {filmId?, hub?, changes[] {entity: "film" | "episode" | "clip" | "panel" | "character" | "appearance" | "location" | "location_variant" | "prop" | "speaker" | "line" | "music_cue" | "sfx_cue" | "hub_folder" | "hub_voice", id?, op: "set" | "add" | "remove" | "move" | "split" | "merge" | "bind" | "restore_version" | "import_from_hub" | "save_to_hub" | "update_from_hub", fields?, position?, target?}}` — 1–100 changes applied as one mutation batch; `bind` binds or unbinds a line and a panel, a clip and its assets, or a speaker and a character; `restore_version` restores a StoryboardVersion of a clip; the three hub ops are those of "Asset hub shared across films". The alternative form `jc_film_update {filmId, revertBatchId}` reverts a mutation batch.
- `jc_film_import_text {filmId, text | assetId, format?: "auto" | "text" | "fountain" | "docx"}` and `jc_film_split_episodes {filmId, method: "markers" | "model", targetCount?, apply?: boolean}`.
- `jc_film_direction {filmId, action: "get" | "draft" | "update" | "regenerate_section" | "set_current", patch?, section?, instruction?, version?}`.
- `jc_film_run_script {filmId, episodeId, targets?, confirmOverwrite?}` and `jc_film_run_storyboard {filmId, episodeId, clipIds?[], targets?, confirmOverwrite?}` — start the `script` or `storyboard` stage of the episode's pipeline run and return `{runId}`; any other stage range is started with `jc_workflow_start {templateId: "tpl.film-episode", params, confirmOverwrite?}`.
- `jc_film_generate {filmId?, hub?, episodeId?, kind, targets: "missing" | "outdated" | "failed" | "all" | ids[], options? {candidates, videoMode, duration, resolution, nativeAudio, profileId, instruction, note, placement, includeCharacterRefs, includeLocationRef, targetLength, tone, language, lineIds[]}, wait?: boolean}` with `kind` one of: media — `asset_image`, `panel_image`, `panel_video`, `shot_variant`, `take`, `lipsync`, `music`, `sfx`, `voice_design`, `photo_to_sheet`; text and analysis — `story_expansion`, `global_analysis`, `appearance_descriptions`, `asset_from_text`, `description_rewrite`, `bridge_panel`, `prompt_rewrite`, `shot_suggestions`, `voice_lines`, `score`, `sfx_suggest`, `subtitle_translation`, `take_alignment`. It queues one job per item and returns `{batchId, jobIds[], skipped[] {id, reason}, estimateUsd}`. With `wait: true` (used by pipeline nodes) it returns `{status: "pending", jobIds[]}` and the calling node attaches to the jobs (`agent-workflows.Tool node`); called again with the same `idempotencyKey` it returns the same jobs and never a second provider request; a job that fails is reported as a non-retryable tool error with the provider error class in `details.class`. Results that are text are returned for the caller to apply (`prompt_rewrite`, `shot_suggestions`, `description_rewrite`, `story_expansion`) or are stored as proposals (`sfx_suggest`, `score`, `voice_design`).
- `jc_film_select_version {filmId?, hub?, targetType, targetId, kind, versionId? | step?: "undo" | "redo", action?: "use" | "dismiss_group" | "pin" | "unpin" | "delete" | "keep_stale" | "use_proposal" | "discard_proposal"}` — candidates, versions, takes, cue takes, voice-design proposals and the panel image history.
- `jc_film_edit_image {filmId?, hub?, targetType: "panel" | "appearance" | "location_variant" | "prop", targetId, instruction (1–500), referenceAssetIds?[] (0–4)}`.
- `jc_film_assemble {filmId, episodeId, action?: "assemble" | "reassemble" | "pending" | "apply" | "discard" | "revert", alsoReorder?: boolean, changeIds?[], batchId?}` — `assemble` and `reassemble` return the assembly report; the other actions are the "n studio changes" queue and the timeline-batch revert of "Round-trip between studio and timeline".
- `jc_film_checks {filmId, episodeId}` — the deterministic findings of "Episode review"; `readOnly` with `readsAmbientState: true`.
- `jc_film_export {filmId?, hub?, scope: "episode" | "film" | "archive", episodeIds?[], gapTicks?, presetId?, codecPreference?[], captions?, include?[], folderId?}`.
- `jc_film_task_control {filmId, action: "list" | "cancel" | "retry" | "dismiss", jobIds?[] | batchId?}`.
- `jc_film_apply {filmId, episodeId?, stage, nodeId, result?}` — validates and merges a stage result, or performs a `_default` or `_commit` step of "Film pipeline template" (then without `result`); callable only by `tool` nodes of a pipeline run (`WORKFLOW_NODE_NOT_ACTIVE` otherwise).
Voice cloning is not available to agents: it needs the person's consent tick and the uploading device, so a request to clone returns `PERMISSION_DENIED` with the hint "Ask the user to clone the voice in the Voice stage". Questions to the user use `jc_session_ask` (`chat-agent.Agent questions`); this family has no question tool. Unknown ids return `NOT_FOUND`; invalid arguments return `INVALID_PARAMS` naming the field with the allowed values; a call the session's device scopes do not allow returns `SCOPE_DENIED`. [NEW]

#### Scenario: Generate missing panel images
- **WHEN** an agent calls `jc_film_generate {kind: "panel_image", targets: "missing"}` for an episode with 18 panels without images
- **THEN** the result lists 18 job ids under one `batchId` with `estimateUsd`, after the Cost guard admitted the call

#### Scenario: Dry run
- **WHEN** the same call is made with `dryRun: true`
- **THEN** no job is queued and the result holds the 18 target ids, the skipped items and the estimate

#### Scenario: Agent inserts a bridging panel
- **WHEN** an agent calls `jc_film_generate {kind: "bridge_panel", targets: [<panel 3 id>], options: {note: "she turns to the door"}}`
- **THEN** one panel is created after panel 3 as a mutation batch and its id is returned

#### Scenario: Agent works in the hub
- **WHEN** an agent calls `jc_film_generate {hub: true, kind: "asset_image", targets: [<hub character id>]}`
- **THEN** jobs are queued for that hub asset on the globally resolved route and no `filmId` is required

#### Scenario: Re-attach instead of a second request
- **WHEN** a pipeline node calls `jc_film_generate {wait: true}` twice with the same `idempotencyKey` because the host restarted in between
- **THEN** the second call returns the same `jobIds` and the provider received one request

#### Scenario: Apply outside a run
- **WHEN** an agent in a chat session calls `jc_film_apply`
- **THEN** the call fails with `WORKFLOW_NODE_NOT_ACTIVE`

#### Scenario: Listed in the tool index
- **WHEN** the contract test lists the tools of the server's agent tool endpoint with MCP `tools/list`
- **THEN** exactly the 17 `jc_film_*` names above appear in the list, in the tool manifest of `packages/protocol` and in the index of `agent-editing-tools`, and no tool named `film_*` exists

#### Scenario: Film tool call the Gateway did not report
- **WHEN** a call to `jc_film_generate` reaches the agent tool endpoint and the Gateway reported no matching tool call of any session within 3 000 ms
- **THEN** the call fails with `SESSION_UNBOUND` and `details.reason` `no_session`, and no job is created

### Requirement: Assistant-driven operation through chat-agent tools
The film's chat pane SHALL host a `chat-agent` session bound to the film, whose agent (default persona `jagentchill-producer`, with the bundled film skills of `skills.Bundled JAgentChill skills`) operates the studio only through "Film tools for agents" and the workflow run tools of `agent-workflows.Workflow run tools`; the current film, episode, stage and selection are passed to the agent as context on every turn. The session mode of `chat-agent.Composer modes` governs writes: in `ask` and `plan` every film write tool fails with `MODE_READ_ONLY` or `PLAN_NOT_APPROVED`; in `edit` non-billable, non-destructive film edits apply immediately as a mutation batch whose tool-call row shows "Undo" (the revert of "Undo and redo of studio edits") — film data is host data, so no timeline proposal is staged — while billable calls go through `agent-editing-tools.Cost guard` (per-call threshold and approval card) and destructive calls (deleting panels, assets, episodes or takes) always show a confirmation card listing the items; in `auto` billable calls are admitted within the session budget of the Cost guard and destructive calls still need confirmation. The agent asks through `jc_session_ask` at the points that are human checkpoints of "Stage checkpoints and approval policies" when it works outside a pipeline run — the look approval (including the choice among alternative directions), character review, asset image selection before the storyboard, and the music choice — unless the user said to proceed without questions, in which case it records its choices as assumptions in its reply. The film session is private to the device that owns it until its owner shares it with the host; its traffic is relayed by the server over its gateway link (`server-api.Agent session relay`), and while the supervised Gateway is unavailable the film session answers `GATEWAY_UNAVAILABLE` while the studio's non-agent actions keep working. When a batch the agent queued without `wait` reaches its end, the session receives one system message with the `generation.batch_finished` summary (succeeded, failed, skipped) and the agent continues its work from there without the user prompting it. Agents are creative agents with JAgentChill's `jc_*` tools only (design decision D25); a workspace agent in the film session follows `agent-workflows.Roles, permissions and agent classes`. [NEW]

#### Scenario: Agent generates missing panel images
- **WHEN** the user writes "generate the missing panel images for this episode" in `edit` mode and the estimate is 0.72 USD
- **THEN** the agent calls `jc_film_generate`, the Cost guard shows an approval card "18 images · estimated 0.72 USD", and jobs are queued only after approval

#### Scenario: Agent edit is undoable
- **WHEN** the agent changes a panel's camera motion through `jc_film_update`
- **THEN** the change appears in the panel within 1 s, the tool-call row shows "Undo", and pressing it restores the previous value

#### Scenario: Destructive call
- **WHEN** the agent calls `jc_film_update` removing 5 panels
- **THEN** a confirmation card lists the 5 panels and nothing is deleted until the user confirms

#### Scenario: Ask mode
- **WHEN** the session is in `ask` mode and the agent calls `jc_film_update`
- **THEN** the call fails with `MODE_READ_ONLY` and `jc_film_get` still works

### Requirement: Film pipeline diagram view
The Diagram button SHALL open the canvas defined by `workflow-diagram.Film pipeline diagrams` — the same free-form canvas as every workflow, with no layout rule or node list of this capability's own — in `run` mode on the episode's latest pipeline run, or on the definition (the film's instantiated copy of `tpl.film-episode`) when no run exists. Nodes are those of "Film pipeline template"; fan-out stages appear as one node with a counter, never one node per panel. Node status, counters, cost and duration come from the run (`agent-workflows.Live run events`); in addition each stage node shows a studio badge "<items done>/<items in the episode>" computed from the studio's data, so that work done by hand outside the run is visible. The node detail panel and context menu offer, besides the engine's actions, "Open stage" (opens the stage tab for that episode), "Generate missing" and "Retry failed" (batch actions of that stage). "Customise pipeline" duplicates the definition into a user workflow that opens in the canvas in `edit` mode (`agent-workflows.Graph operations`), where stages can be reordered, removed, reassigned to agents or teams and extended with other node types; a film uses a customised pipeline when it is selected in Film settings ▸ "Pipeline", provided it keeps the parameters `filmId` and `episodeId`. The same canvas appears in the film session's workspace Diagram tab (`workflow-diagram.Session workspace Diagram tab`) and as the inline widget when the agent starts a pipeline run (`workflow-diagram.Inline widget in chat`). [NEW]

#### Scenario: Counts from the run and from the studio
- **WHEN** a `panel_videos` fan-out of 14 items has 4 succeeded and the episode has 24 panels of which 14 now have a current video
- **THEN** the node shows the run counter "4/14" and the studio badge "14/24"

#### Scenario: Node action
- **WHEN** the user chooses "Retry failed" on the `panel_images` node
- **THEN** every failed panel-image job of the episode is retried as one batch

#### Scenario: Open stage
- **WHEN** the user chooses "Open stage" on the `voice_takes` node
- **THEN** the Voice stage of that episode opens

#### Scenario: Customised pipeline
- **WHEN** the user duplicates the pipeline, removes the `lipsync` stage, saves, and selects it for the film
- **THEN** the next pipeline run of that film has no `lipsync` node and the built-in template is unchanged

### Requirement: Mobile studio presentation
On the compact form factor of `design-system.Breakpoints and layout constants`, on iOS and on Android alike, the studio SHALL offer every action the desktop studio offers — nothing is desktop-only — presented as: the stage tabs as a horizontally scrollable strip under the top bar; the top-bar actions (Direction, Asset hub, Tasks, Diagram, Run pipeline, Film settings) in an overflow menu with Tasks and its badge kept visible; the episode selector as a bottom sheet; lists as single-column cards; the panel editor, candidate strip, version history, voice design, Direction screen, export dialog, "Run pipeline" dialog with its "To run this you need" and "Will run without" lists, and task queue as full-height sheets; pickers as bottom sheets; the chat pane as a separate "Chat" segment of a "Studio | Chat" control; drag reordering by long-press (400 ms) with haptic feedback; multi-select through a "Select" mode; cost estimates in confirmation sheets; the music-cue ruler as a horizontally scrollable strip with drag handles of touch size; and all touch targets at least 44 × 44 pt on iOS and 44 × 44 dp on Android (the one target size of `i18n-accessibility.Touch target size and gesture alternatives`). The Timeline stage shows the embedded preview player full-width with "Open in editor" below it, followed by the assembly report, the "Skipped" lines and the "n studio changes" list; the Asset hub is a full-screen route with folders as a drill-down list; the Diagram button opens the canvas of `workflow-diagram` in its compact presentation. A "Needs you" banner of a checkpoint is pinned above the stage content. Video cards play inline with native controls; only one video plays at a time. File import uses the system document picker, image upload the photo library or camera, and reference audio for cloning the document picker or a new recording; finished exports and archives are saved through the system share sheet. All generation runs on the host — a phone or tablet is never the host — and continues when the app is backgrounded or closed; push notifications (`notifications.Mobile push delivery`), which carry the notification kind and an opaque id only, report batch completion, failures, checkpoints that need a person and agent questions, and open the stage or run concerned. On the medium and wide form factors (tablets and foldables included) the desktop layout is used, with the chat pane collapsed by default at medium. [NEW]

#### Scenario: Reorder by long-press
- **WHEN** the user long-presses a panel card for 400 ms and drags it, on iOS or on Android
- **THEN** the card lifts with haptic feedback and can be dropped at a new position

#### Scenario: Batch finishes in the background
- **WHEN** a batch of 20 videos completes while the app is backgrounded and push is enabled
- **THEN** a push notification of kind `generation.batch_finished` is delivered and tapping it opens the Video stage of that episode

#### Scenario: Timeline stage on a phone
- **WHEN** the user opens the Timeline stage of an assembled episode on a phone
- **THEN** the preview player fills the width, "Open in editor" is below it, and the skipped-role lines are listed under the report

#### Scenario: Checkpoint on a phone
- **WHEN** `check_voices` waits for a person and the user opens the Voice stage on a phone
- **THEN** the "Needs you" banner shows the defaulted speakers with a preview and "Change" for each, and "Approve" resolves the checkpoint

#### Scenario: Medium width
- **WHEN** the window is 800 px wide
- **THEN** the desktop layout is shown with the chat pane collapsed

### Requirement: Keyboard and accessibility in the studio
On desktop and web the studio SHALL be fully operable by keyboard: Tab order follows visual order; arrow keys move between cards in a grid; the studio registers the actions `film.stage.1` … `film.stage.8`, `film.item.open`, `film.item.play`, `film.item.generate`, `film.item.regenerate`, `film.item.delete`, `film.panel.move-up`, `film.panel.move-down` and `film.panel.undo-image` / `film.panel.redo-image` in the context `film` of `keyboard-shortcuts.Action registry`; their default bindings are stated only in `keyboard-shortcuts`, are remappable there, and the studio shows the active binding in tooltips through `keyboard-shortcuts.Active binding lookup`. Escape closes the topmost panel or dialog. Every card exposes an accessible name with its index, type and status ("Panel 12, medium shot, image ready, video outdated"); progress is exposed as a progress bar with value; status is never conveyed by colour alone (chip text plus icon); live regions announce job completion and failure at most once every 5 s per stage; contrast and focus indicators follow `i18n-accessibility`. All studio strings are provided in en, vi and ja. [NEW]

#### Scenario: Generate by keyboard
- **WHEN** a panel card without an image has focus and the user triggers `film.item.generate`
- **THEN** a panel-image job is queued for that panel

#### Scenario: Screen-reader status
- **WHEN** a screen reader focuses a panel whose video failed
- **THEN** it reads the panel index, shot size and "video failed"

#### Scenario: Tooltip shows the active binding
- **WHEN** the user remapped `film.item.generate` and hovers a Generate button
- **THEN** the tooltip shows the remapped binding

### Requirement: Film error codes
The `film` domain SHALL define exactly these domain error codes, registered by name in `server-api.RPC error envelope` and returned alongside the general codes (`INVALID_PARAMS`, `NOT_FOUND`, `CONFLICT`, `SCOPE_DENIED`, `PERMISSION_DENIED`, `RATE_LIMITED`, `QUOTA_EXCEEDED`, `PAYLOAD_TOO_LARGE`, `BUDGET_EXCEEDED`, `NO_ROUTE`, `RENDERER_UNAVAILABLE`, `TIMEOUT`, `CANCELLED`, `UNAVAILABLE`): `FILM_MODEL_OUTPUT_INVALID` (a model result failed its schema or invariants after all attempts; `details.issues`), `FILM_VIDEO_OPTION_UNSUPPORTED` (`details {option, nearest}`), `FILM_LIMIT_EXCEEDED` (an entity limit of the data model; `details {limit, max, actual}` with `limit` one of `episodesPerFilm` 200, `clipsPerEpisode` 60, `panelsPerClip` 40, `panelsPerEpisode` 600, `linesPerEpisode` 1,000, `cuesPerEpisode` 1,000, `sfxPerPanel` 8, `takesPerLine` 10, `appearancesPerCharacter` 8, `assetsPerType` 200, `hubFolders` 500), `FILM_PREREQUISITE_MISSING` (an action needs something absent: an unconfirmed profile, a missing primary sheet, a missing image for `image` mode, a missing voice, an unapproved script; `details.requires`), `FILM_VERSIONS_PINNED` (a 21st version cannot be stored because all are pinned or current), `FILM_IMPORT_UNSUPPORTED` (file type, size or encoding; `details.reason`) and `FILM_EXPORT_NOT_READY` (a selected episode is not assembled, has unapplied studio changes or differs in canvas or frame rate; `details.episodes[]`). Export failures of the render and encode steps carry the `export/<kebab>` codes of `export-share`; pipeline failures carry the codes of `agent-workflows.Workflow error codes`. Messages are localised on the client from the code. [NEW]

#### Scenario: Prerequisite named
- **WHEN** `jc_film_generate {kind: "take"}` targets a line whose speaker has no voice
- **THEN** that item is returned in `skipped` with reason `FILM_PREREQUISITE_MISSING` and `details.requires: "voice"`

#### Scenario: Limit named
- **WHEN** a 41st panel is added to a clip through `jc_film_update`
- **THEN** the call fails with `FILM_LIMIT_EXCEEDED` and `details {limit: "panelsPerClip", max: 40, actual: 41}`

#### Scenario: Localised message
- **WHEN** the app locale is Japanese and an export fails with `FILM_EXPORT_NOT_READY`
- **THEN** the dialog text comes from the `ja` locale resource for that code
