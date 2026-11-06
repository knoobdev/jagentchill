## ADDED Requirements

### Requirement: Single normative definition
Capability `project-document` SHALL be the single, complete and normative definition of the project document at `schemaVersion: 32` (design D5, decision A3 of `.refs/review/round2-decisions.md`): every field of the project, its scenes, tracks, elements of every type, the animation store, effects, masks, transitions, audio processing, retime, captions, template mode, multi-camera, provenance links, markers and media asset records, together with the mapping from OpenCut classic v31. The field tables live in `specs/project-document/catalog.md`, which is normative. Every other capability defines BEHAVIOUR and references field names as `project-document.<Requirement name>` or by catalogue section; a field name, type, range, default or shape stated in another capability that differs from this capability is superseded by this capability. The schema is implemented once, as Zod schemas in `packages/protocol` (module `project-document`), and the invariants and the validator in `packages/editor-core`; no other package declares a type for any part of the document. A CI test SHALL generate the field list from the Zod schemas and fail when it differs from the tables of `catalog.md` §2–§12 and §16 in name, type, range or default. [NEW] [PORT T-001, T-002, T-003, ST-001]

#### Scenario: Catalogue and schema agree
- **WHEN** the CI field-list test runs on a commit where the Zod schema and `catalog.md` list the same fields
- **THEN** the test passes and reports the number of fields compared

#### Scenario: A field added only in code fails CI
- **WHEN** a commit adds the element field `glowBoost` to the Zod schema without a row in `catalog.md`
- **THEN** the field-list test fails and names `glowBoost` as "in schema, not in catalogue"

#### Scenario: A second type declaration is rejected
- **WHEN** a package other than `packages/protocol` exports a TypeScript type named for a document structure (for example `TimelineElement`) that is not re-exported from the protocol package
- **THEN** the dependency lint of `render-engine.Package boundaries and dependency direction` fails the build

### Requirement: Canonical field list
The fields of the project document at schema 32 SHALL be exactly the rows of `catalog.md` §2 (project), §3 (settings, background, cover, template mode, export settings), §4 (scene, markers, multi-camera definition), §5 (track, transition records, caption track), §6 (element common), §7 (visual), §8 (time), §9 (audio), §10 (element types), §11 (animation store), §12 (media) and §16 (device-local section), with the type, unit, range, default, animatable flag and owning capability given there. This requirement is the one other capabilities cite for a field name. A key that is not in those tables is an unknown field and is handled by `project-document.Unknown-field preservation`; a writer of schema 32 MUST NOT create one. The number of fields is whatever the CI test of `project-document.Single normative definition` counts from the Zod schemas (a row naming several keys counts once per key); the test prints the count and fails on any difference between schema and catalogue, so no count is stated here. [NEW] [PORT T-001, T-003, A-001, K-010, ST-003]

#### Scenario: Citing a field
- **WHEN** another capability needs the name of the horizontal position field
- **THEN** it cites `project-document.Canonical field list` and uses `transform.position.x`, and states no range or default of its own

#### Scenario: Writer creates only catalogue fields
- **WHEN** any command, tool or migration of schema 32 writes a document
- **THEN** every key in the written document is a row of the catalogue or a preserved unknown field that was already present

### Requirement: Document envelope
The document root SHALL be a JSON object with `format: "jagentchill.project"`, `schemaVersion` (integer, 32 at this schema), `minReaderSchemaVersion` (integer, 32 … `schemaVersion`), `metadata {id, name, duration, created_ms, updated_ms, thumbnail: null, importedFrom?}` (`importedFrom {source: "opencut-classic", id}` records the classic id of a project ingested by `project-storage.Classic bundle ingestion`), `settings`, `cover`, `scenes[]`, `media`, `scriptLinks[]`, `glossaries`, and the optional `filmLink`, `workflowLink`, `template`, `exportSettings`, `publish`, `version` (the classic number, kept and never read) and `local` (`catalog.md` §2). `metadata.id` is the project id; there is no second copy of the id or the name at the root. `metadata.duration` is derived (the end of the last element of the main scene) and is rewritten by the same command that changes it. A document without `format`, or whose `schemaVersion` is below 32, is not a schema-32 document and goes through the migration chain of `project-storage.Migration chain` before it is validated. [NEW] [PORT P-003, ST-001, ST-006]

#### Scenario: New project envelope
- **WHEN** a project is created per `projects.Create project`
- **THEN** its document has `format = "jagentchill.project"`, `schemaVersion = 32`, `minReaderSchemaVersion = 32`, one scene with `isMain = true`, `media = {assets: [], folders: [], luts: []}`, `scriptLinks = []`, `glossaries = {}` and `cover = null`

#### Scenario: Missing format
- **WHEN** a record with `schemaVersion: 32` and no `format` key is validated
- **THEN** validation fails with `document/unknown-format` at path `/format`

#### Scenario: Duration follows content
- **WHEN** the last element of the main scene is trimmed so that it ends at tick 600 000
- **THEN** the same state patch replaces `/metadata/duration` with 600 000

### Requirement: Identifiers
Every `id` SHALL be a string of 1–64 characters from `A–Z a–z 0–9 _ . : -`. Ids created by JAgentChill SHALL be lowercase UUID v4; ids read from OpenCut classic are kept unchanged. The ids of scenes, tracks, elements, effect entries, masks, transition records, markers, assets, library folders, slots, angles and cover texts SHALL be unique across the whole document in one namespace; keyframe ids are unique within their element, freeform path-point ids within their mask, and stroke ids within their element. An id is never reused after its entity is deleted within the same editing session, and redo of a creating command restores the same id. Copies made by split, duplicate, paste and compound creation receive new ids for the copied elements, effect entries, masks and keyframes, and every reference inside the copied set (`linkId`, `groupId`, `tracking.targetElementId`, transition records, animation paths that contain an effect or mask id) is rewritten to the new ids in the same command. [NEW] [PORT T-003, E-003]

#### Scenario: Duplicate rewrites internal references
- **WHEN** an element with one effect entry `e1` and the animation path `effects.e1.params.intensity` is duplicated
- **THEN** the copy has a new element id, a new effect id `e2`, and its animation path is `effects.e2.params.intensity`

#### Scenario: Colliding ids are invalid
- **WHEN** a document holds a marker and an element with the same id
- **THEN** validation fails with `document/duplicate-id` naming both paths

#### Scenario: Classic id kept
- **WHEN** a classic element id `aB3_x` is migrated
- **THEN** the element keeps the id `aB3_x`

### Requirement: Time values and timestamps
Every media time in the document SHALL be an integer number of ticks at 120 000 ticks per second (`catalog.md` §1 `Ticks`); a fractional, negative or non-finite tick value is invalid (`document/not-integer-ticks`). `startTime`, `duration`, marker times, `inPoint`, `outPoint`, keyframe times, fade, transition and animation durations SHALL lie on the project frame grid defined by `render-engine.Frame-rate rationals and frame snapping`; source-domain times (`trimStart`, `trimEnd`, `sourceDuration`, `freeze.sourceTime`, `beats[]`, asset `duration`) are integer ticks but need not be frame-aligned. A frame rate SHALL be a `Rational {numerator, denominator}` with both integers 1…1 000 000 and reduced by their greatest common divisor. Every wall-clock value SHALL be an integer of Unix UTC milliseconds in a key ending `_ms`; no ISO date string exists at schema 32. Durations in seconds, frame numbers and floating-point times MUST NOT be stored anywhere in the document. [NEW] [PORT S-003, ST-006]

#### Scenario: Fractional tick rejected
- **WHEN** a writer submits an element with `startTime = 1200.5`
- **THEN** validation fails with `document/not-integer-ticks` and nothing is written

#### Scenario: Unreduced rational rejected
- **WHEN** `settings.fps` is `{numerator: 60, denominator: 2}`
- **THEN** validation fails with `document/invalid-rational`

#### Scenario: Off-grid start
- **WHEN** a 30/1 project holds an element with `startTime = 4001` (one frame is 4 000 ticks)
- **THEN** validation fails with `document/not-frame-aligned` at that element's `startTime`

### Requirement: Canonical JSON serialisation
The canonical form of a project document — the form used for content hashes, snapshots, state patches and byte comparison — SHALL be UTF-8 JSON of the document WITHOUT its `local` key, with: object keys sorted by UTF-16 code unit order at every level; no insignificant whitespace; strings escaped minimally as by ECMAScript `JSON.stringify` and NFC-normalised; numbers written by the ECMAScript number-to-string algorithm; integers within ±(2^53 − 1); no `NaN`, no infinity and no negative zero; every non-integer number rounded by the writer, before it is stored, to at most 6 fractional digits (half away from zero), except `Db` values (2 digits) and stroke points (2 digits); array order as defined by `project-document.Track and element ordering` and the catalogue (`media.assets` by `id`, `markers` by `time`, keys by `time`), every other array in its stored order; no key whose value is `undefined`. This is the same form as `cross-device-sync.Canonical document form`, which governs transport; this requirement governs what is inside it. Two documents are equal if and only if their canonical forms are byte-identical. The document hash is the SHA-256 of the canonical form, written as 64 lowercase hexadecimal characters. [NEW]

#### Scenario: Key order is canonical
- **WHEN** two writers build the same element, one inserting `name` before `id` and one after
- **THEN** both canonical forms are byte-identical and have the same SHA-256

#### Scenario: Local data does not change the hash
- **WHEN** only `local.timelineViewState.scrollLeft` changes
- **THEN** the canonical form and the document hash are unchanged

#### Scenario: Float rounding
- **WHEN** a canvas gesture produces `transform.scale.x = 1.23456789012`
- **THEN** the stored and canonical value is `1.234568`

#### Scenario: Negative zero rejected
- **WHEN** a writer submits `transform.rotation = -0`
- **THEN** the validator normalises nothing and fails with `document/invalid-number`

### Requirement: Absent, null and default values
A field whose catalogue default is "absent" SHALL be omitted when it has no value and MUST NOT be stored as `null`. Only the fields the catalogue types as "or `null`" (`cover`, `groupId`, `linkId`, `transitionIn`, `transitionOut`, `settings.lastCustomCanvasSize`, `settings.originalCanvasSize`, `metadata.thumbnail`, asset `kind`, asset `contentHash`, asset and folder `folderId` / `parentId`, and the `local` fields so typed) accept `null`. A reader SHALL treat an absent field as its catalogue default; a writer of a NEW entity SHALL write every field whose default is a value (not "absent") explicitly, so that a document never depends on a reader's default table for content created at schema 32. A structure whose every member is at its default and whose catalogue default is "absent" (`retime`, `adjustments`, `clipAnimation`, `textAnimation`, `bubble`, `cutout` with `mode: "none"` and no matte, `chromaKey` with `enabled: false`, `stabilization`, `deflicker`, `eyeContact`, `relight`, `retouch`, `motionBlur` with `enabled: false`, `noiseReduction`, `enhanceVoice`, `voiceEffect`, `pitch`, `normalize`, `eq`, `compressor`) SHALL be removed by the command that returns it to default, except where the owning capability states that a disabled structure keeps its values for re-enabling (`chromaKey`, `cutout`, `stabilization`, `motionBlur`, `relight`, `retouch`, `eq`, `compressor`), in which case it is kept with `enabled: false`. [NEW] [PORT SP-001]

#### Scenario: Retime returns to default
- **WHEN** a clip at rate 2 with no curve, forward, `smooth: "none"` is set back to rate 1
- **THEN** the `retime` key is removed from the element, not stored as `null` or `{rate: 1}`

#### Scenario: Null where absent is required
- **WHEN** a writer submits an element with `freeze: null`
- **THEN** validation fails with `document/wrong-type` at that path

#### Scenario: New element writes its defaults
- **WHEN** a video element is inserted
- **THEN** the stored element contains `transform`, `opacity: 1`, `blendMode: "normal"`, `crop` (four zeros), `flip` (both false), `volume: 0`, `muted: false`, `pan: 0`, `hidden: false`, `groupId: null`, `linkId: null`, `transitionIn: null`, `transitionOut: null`, `effects: []`, `masks: []` and `isSourceAudioEnabled: true`, and no `retime`, `freeze`, `adjustments`, `cutout` or `animations` key

### Requirement: Unknown-field preservation
A reader whose schema is at least the document's `minReaderSchemaVersion` SHALL preserve every key and every union member it does not know, at every level (root, settings, scene, track, element, effect entry, mask, channel, key, asset record), with its value unchanged, through load, edit, save, state patch emission, snapshot, package export and import. An unknown key is carried on the entity that holds it: it moves with the element through move, trim and reorder, is copied by split (both halves), duplicate and paste, and is removed only when its entity is deleted. An element or track whose `type` is unknown, and an effect entry or mask whose `type` is not registered, SHALL be preserved, SHALL NOT be rendered, SHALL be shown locked with the badge "Needs newer app" and SHALL accept only move within its container by commands that move a whole track or scene, and delete. An unknown key MUST NOT be interpreted, renamed, validated or counted against a limit other than the document size limit. While a document contains at least one unknown key or type the editor shows the non-blocking notice "Some content was made with a newer app version and is kept unchanged". A reader below `minReaderSchemaVersion` does not open the document for writing (`project-storage.Schema versioning`). [NEW]

#### Scenario: Unknown element field survives an edit
- **WHEN** a schema-32 app opens a schema-33 document (`minReaderSchemaVersion: 32`) whose video element carries the unknown key `lensCorrection {k1: 0.1}`, moves the element and saves
- **THEN** the saved element still carries `lensCorrection {k1: 0.1}` and `schemaVersion` is still 33

#### Scenario: Unknown element type is kept and locked
- **WHEN** a document holds an element with `type: "particle"`
- **THEN** the element is not rendered, its clip shows "Needs newer app", trimming it is refused, and after save it is byte-for-value identical

#### Scenario: Split copies unknown keys
- **WHEN** an element carrying an unknown key is split
- **THEN** both halves carry the key with the same value

### Requirement: Document size and count limits
A project document SHALL respect the limits of `catalog.md` §15: canonical form at most 67 108 864 bytes; at most 200 scenes; 99 overlay and 99 audio tracks per scene; 5 000 elements per track, 20 000 per scene and 100 000 per project; 1 000 markers per scene; 16 effect entries (at most 1 filter) and 8 masks per element; 256 points per freeform path; 1 000 keys per channel and 256 animated paths per element; 10 000 assets; JSON nesting depth 32. A command whose result would exceed a count limit is rejected as a whole with `document/limit-exceeded` (`details.limit` names the limit and its value) and the user-facing message of the owning capability where one exists (for example "Track limit reached (99)"), with no partial change and no undo step. A document that reaches 80 % of the byte limit shows the notice "This project is close to its size limit" once per session; a command whose result would exceed the byte limit is rejected with `document/too-large`. [NEW] [PORT T-002]

#### Scenario: Seventeenth effect refused
- **WHEN** an element has 16 effect entries and a tool adds one more
- **THEN** the command fails with `document/limit-exceeded`, `details.limit = "effectsPerElement"`, and the element still has 16 entries

#### Scenario: Byte limit
- **WHEN** pasting 3 000 elements would bring the canonical form to 67 200 000 bytes
- **THEN** the paste is rejected with `document/too-large`, nothing is pasted and no undo step is added

#### Scenario: Deep nesting
- **WHEN** an imported document nests objects 40 levels deep inside an unknown key
- **THEN** validation fails with `document/limit-exceeded` and `details.limit = "jsonDepth"`

### Requirement: Project settings
`settings` SHALL hold `fps` (Rational, default 30/1), `canvasSize {width, height}` (even integers 16–7680, width × height ≤ 33 177 600; default 1920 × 1080), `canvasSizeMode` (`preset` or `custom`), `lastCustomCanvasSize`, `originalCanvasSize`, `adoptCanvasFromFirstMedia` and `adoptFrameRateFromFirstMedia` (booleans that record whether `projects.Canvas and frame rate adoption from first media` is still armed for each property), `background` (the project default, `project-document.Canvas background union`), `useProxies` (default true) and `colorPipeline`, which is the constant `"sdr-rec709-8bit"` at schema 32 (8-bit SDR, Rec.709 primaries and transfer; `render-engine.Colour management`). There is no audio sample rate, export or device preference in `settings`. A `colorPipeline` value other than the constant is an unknown union member and makes the document read-only to a schema-32 app with the notice "This project uses a colour pipeline that needs a newer app". Behaviour of every field is owned by `projects`, except `useProxies` (`media-library.Proxy media`) and `colorPipeline` (`render-engine`). [NEW] [PORT S-003, S-005, S-006, S-007, S-015]

#### Scenario: Adoption flag cleared by an explicit choice
- **WHEN** the user picks 9:16 in a new project before inserting media
- **THEN** `settings.adoptCanvasFromFirstMedia` becomes `false` in the same undo step and `settings.adoptFrameRateFromFirstMedia` stays `true`

#### Scenario: Odd canvas size
- **WHEN** a tool writes `canvasSize = {width: 1081, height: 1920}`
- **THEN** the write fails with `document/out-of-range` at the field `canvasSize.width` of `settings`

#### Scenario: Factory defaults
- **WHEN** a desktop project is created with all "New project" preferences at "Match first clip"
- **THEN** `settings` is `fps {30, 1}`, `canvasSize {1920, 1080}`, `canvasSizeMode "preset"`, both adoption flags `true`, `background {kind: "color", color: "#000000"}`, `useProxies true`, `colorPipeline "sdr-rec709-8bit"`

### Requirement: Canvas background union
A canvas background SHALL be exactly one of `{kind: "color", color}` (`#rrggbb`), `{kind: "gradient", css}`, `{kind: "blur", blurIntensity}` (integer 0–1000, default 200), `{kind: "image", mediaId, fit}` (`fit` = `cover` (default), `contain` or `stretch`; `mediaId` resolves to an image asset) or `{kind: "transparent"}` (`catalog.md` §3.2). The discriminator key is `kind`; the classic key `type` does not exist at schema 32. A value carries only the keys of its own kind: a key of another kind is `document/field-not-allowed`. The same union is the type of `settings.background` and of the per-clip `background` of `project-document.Per-clip canvas background field`. The meaning and editing of each kind are owned by `projects.Background colour and gradient`, `projects.Background blur and image` and `projects.Transparent background`; rendering by `render-engine.Background nodes`. A value keeps no memory of another kind: switching the kind discards the previous kind's keys, and a switch to `blur` always starts at `blurIntensity: 200` (`projects.Background blur and image`); returning to an earlier value is done with Undo. [NEW] [PORT S-009, S-012, S-013] [CAPCUT CC-008, CC-009, CC-010]

#### Scenario: Transparent default
- **WHEN** the user picks "None" in the Background editor of the project
- **THEN** `settings.background` is exactly `{kind: "transparent"}`

#### Scenario: Mixed keys rejected
- **WHEN** a writer submits `{kind: "color", color: "#112233", blurIntensity: 200}`
- **THEN** validation fails with `document/field-not-allowed` at `blurIntensity`

#### Scenario: Image background needs an image asset
- **WHEN** `settings.background` is `{kind: "image", mediaId: "a7"}` and asset `a7` has `type: "audio"`
- **THEN** validation fails with `document/asset-type-mismatch`

### Requirement: Project cover
`cover` SHALL be `null` or `{source, sceneId?, time?, mediaId?, crop, texts[], image}` (`catalog.md` §3.3): `source: "frame"` carries `sceneId` and a frame-aligned `time`; `source: "image"` carries `mediaId`; `texts[]` holds at most 5 entries `{id, style, content, position, scale, rotation}` whose `style` is the TextStyle of `project-document.Text style fields` without animation, tracking and bubble; `image {sha256, mime, width, height}` references the rendered cover in the cover store and is never a data URL. A cover whose `sceneId` or `mediaId` no longer resolves stays valid (the rendered `image` is kept) and the reference is reported as a warning, not an error. Behaviour is owned by `projects.Cover editor`. [NEW] [CAPCUT CC-012, CC-013]

#### Scenario: Frame cover
- **WHEN** the user saves a cover from the frame at 2 s of the main scene with one title
- **THEN** `cover` is `{source: "frame", sceneId: <main>, time: 240000, crop: {x: 0.5, y: 0.5, zoom: 1}, texts: [1 entry], image: {sha256, mime: "image/jpeg", width, height}}`

#### Scenario: Reset
- **WHEN** the user presses "Reset" in the cover editor
- **THEN** `cover` is `null`

#### Scenario: Six texts
- **WHEN** a writer submits a cover with 6 text entries
- **THEN** validation fails with `document/out-of-range`

### Requirement: Project provenance links
The project SHALL carry the optional origin links `filmLink {filmId, episodeId}`, `workflowLink {runId}` and `scriptLinks[] {scriptId}` (0–20 entries, unique `scriptId`). The project-level script field is the array `scriptLinks`; a singular project-level `scriptLink` does not exist. Each element SHALL be able to carry `filmLink {filmId, episodeId, panelId?, lineId?, cueId?, assetVersionId}`, `workflowLink {runId, stepId, shotId?, artifactVersionId}` and `scriptLink {scriptId, sceneId, shotId?, lineId?, versionId, syncedHash}`, all three at once. Links are document data: never interpreted by rendering, preserved by split (both halves), duplicate, paste, compound creation and dissolve, package export/import and sync; a link whose target does not exist is valid. `scriptLinks` SHALL contain the `scriptId` of every element `scriptLink` in the document; the command that adds or removes the last element link of a script adds or removes the project entry in the same undo step. Producers and link behaviour are owned by `film-production`, `agent-workflows`, `prompt-to-video-workflow`, `script-studio` and `timeline-editing.Element provenance link`; the transient "Trim adjusted" flag of that requirement is session state and is not a document field. [NEW]

#### Scenario: Element link implies project link
- **WHEN** `script-studio.Draft timeline from a script` creates the first element with `scriptLink.scriptId = "s1"`
- **THEN** the same patch adds `{scriptId: "s1"}` to `scriptLinks`

#### Scenario: Missing project entry is invalid
- **WHEN** a document holds an element with `scriptLink.scriptId = "s2"` and `scriptLinks = []`
- **THEN** validation fails with `document/unknown-reference` at that element's `scriptLink`

#### Scenario: Deleted target stays valid
- **WHEN** the film named by `filmLink.filmId` has been deleted on the host
- **THEN** the document validates and the chip reads "Source no longer available"

### Requirement: Template mode model
A project created by `templates.Use a template` SHALL carry `template {templateId, locked, sceneId, slots[], editableTexts[], audioSlots[], themeColors[]}` (`catalog.md` §3.4). `locked: true` is template mode; `locked: false` or an absent `template` is an ordinary project. A slot is `{slotId, elementId, index, accepts, duration, required, label, filled, framing {zoom, panX, panY}, sourceOffset}`: `elementId` resolves to a video or image element of `template.sceneId`; `index` values are 1…n without gaps; `duration` equals the element's `duration`; an unfilled slot (`filled: false`) is the only place where a video or image element has no `mediaId`, and such an element renders the empty-slot frame of `templates.Template data model`. `editableTexts[] {elementId, label, maxLength}` name text elements; `audioSlots[] {elementId, label, replaceable}` name audio elements; `themeColors[]` holds 0–6 colours, and `colorBindings[] {colorIndex, elementId, field}` records which stored colour field of which element uses which theme colour (`field` is the stored path of a colour field of that element, for example `color`, `stroke.color` or `params.fill`), so that "Apply brand" of `templates.Brand kit` rewrites exactly the bound fields: for each binding it writes the brand colour at position `colorIndex` into `field` and into `themeColors[colorIndex]`; a colour field without a binding is never changed by "Apply brand". A binding whose element or field no longer resolves is removed by the command that deleted the target. An element is named by at most one slot, one editable text or one audio slot. "Edit in full editor" sets `locked: false`, fills every unfilled slot with a slate asset and keeps the `template` object as a record of origin. A project with `template.locked: true` is listed with the badge "Template draft" by `projects.Projects list`. Behaviour is owned by `templates`. [NEW] [CAPCUT CC-227, CC-228, CC-229]

#### Scenario: Unfilled slot element
- **WHEN** a template with 3 slots is used and only slots 1 and 2 are filled
- **THEN** `template.slots[2].filled` is `false`, its element has no `mediaId`, and the document validates

#### Scenario: Element without media outside a slot
- **WHEN** a video element that no slot names has no `mediaId`
- **THEN** validation fails with `document/missing-field` at that element's `mediaId`

#### Scenario: Slot points at a text element
- **WHEN** `template.slots[0].elementId` resolves to a text element
- **THEN** validation fails with `document/template-invalid`

#### Scenario: Leaving template mode
- **WHEN** the user confirms "Edit in full editor"
- **THEN** `template.locked` becomes `false`, every slot has `filled: true` with a `kind: "slate"` asset, and the next structural edit is accepted

#### Scenario: Brand colours follow the bindings
- **WHEN** `themeColors` is `["#ff0000", "#00ff00"]`, `colorBindings` is `[{colorIndex: 0, elementId: "t1", field: "color"}]` and "Apply brand" supplies `#112233` for position 0
- **THEN** element `t1` has `color = "#112233"`, `themeColors[0]` is `#112233`, and no other colour field of the document changes

### Requirement: Template lock enforcement
While `template.locked` is `true`, the validator SHALL accept a change only when every difference between the document before and after is one of: (a) on a slot element — `mediaId`, `sourceDuration`, `trimStart`, `trimEnd` (as recomputed from `sourceOffset`), `volume`, `muted`, `name`, and the slot's `filled`, `framing` and `sourceOffset`; (b) on an editable text element — `content` (length ≤ its `maxLength`) and, through "Apply brand" only, `fontFamily`; (c) on an audio-slot element — `volume`, `muted`, and for a replaceable slot `mediaId`, `sourceType`, `sourceDuration`, `trimStart`, `trimEnd`; (d) `template.themeColors` and the colour fields named by `template.colorBindings`; (e) `media` (assets added or removed), `cover`, `metadata.name`, `metadata.updated_ms`, `exportSettings`, `publish`, `filmLink`, `workflowLink`; (f) `template.locked` changing to `false`. Any other difference — adding, removing, moving, trimming, splitting or reordering an element or track, changing timing, transform, effects, masks, adjustments, animations, transitions, retime, scenes or settings — SHALL be rejected with `document/template-locked` and no change. The rule is evaluated on the before/after documents, so it binds every writer equally: inspector and timeline commands, keyboard shortcuts, agent tools (`agent-editing-tools`), sync patches applied from another device, workflow and film writers, package import and migrations. The UI disables the corresponding controls; the validator is the enforcement. [NEW] [CAPCUT CC-227]

#### Scenario: Agent tool cannot trim a locked template
- **WHEN** an agent calls a trim tool on an element of a project whose `template.locked` is `true`
- **THEN** the tool fails with `document/template-locked` and the document is unchanged

#### Scenario: Replacing slot media is allowed
- **WHEN** the user replaces the media of slot 2 and pans it
- **THEN** the change to that element's `mediaId`, `sourceDuration`, `trimStart`, `trimEnd` and the slot's `filled`, `framing` and `sourceOffset` is accepted as one undo step

#### Scenario: Remote patch from an older layout
- **WHEN** a sync patch that moves an element arrives for a document whose `template.locked` is `true`
- **THEN** the receiving device rejects the patch with `document/template-locked` and reports it through the follow path of `cross-device-sync.Live following by non-writers`

#### Scenario: Text over its limit
- **WHEN** an editable text with `maxLength: 40` is set to 41 characters
- **THEN** the write fails with `document/out-of-range`

### Requirement: Project-level stores
The project SHALL store, outside the timeline: `glossaries` (a map from target language to at most 200 `{source, target}` pairs, used by `captions-subtitles.Translate captions`); `exportSettings {type?, presetId?, values}` (the last export settings of the project per `export-share.Export settings persistence`; the keys of `values` are exactly `resolution`, `frameRate`, `bitrateMode`, `bitrate`, `codec`, `container`, `audio`, `captions`, `embedCover`, `aiLabel`, `creditsFile`, `scope`, `target` and `smoothMotion`, typed in `catalog.md` §3.5; it MUST NOT contain a file-system path, a share-link token or a passcode — a `values` key named `path`, `token` or `passcode`, or a string value that is an absolute path, fails validation with `document/field-not-allowed`); and `publish {title, description}` (at most 100 and 2 200 characters, `export-share.Publishing hand-off`). The credits list of a project is NOT stored: it is derived from the `provenance` of the assets used in the export range (`project-document.Asset provenance`). Brand kits, saved sounds, caption styles, text presets, easing presets and LUT library entries are library items outside the project document; a project carries only the copies it uses (`media.luts`, values written into elements). [NEW]

#### Scenario: Glossary stored per language
- **WHEN** the user adds the pair "Gateway → ゲートウェイ" for Japanese
- **THEN** `glossaries.ja` holds one entry `{source: "Gateway", target: "ゲートウェイ"}` and the change is one undo step

#### Scenario: Path in export settings rejected
- **WHEN** a writer stores `exportSettings.values.path = "/Users/a/out.mp4"`
- **THEN** validation fails with `document/field-not-allowed`

#### Scenario: Credits are derived
- **WHEN** a project uses one stock clip whose asset has `provenance.attributionRequired: true`
- **THEN** the export dialog lists one credit and the document contains no `credits` key

### Requirement: Device-local section
Data that belongs to one device SHALL live only under the root key `local` (`catalog.md` §16): `currentSceneId`, `timelineViewState {zoomLevel, scrollLeft, playheadTime, scenePlayheads, expandedKeyframeElementIds[]}`, `folderId`, `trash`, `media` (per asset: `storage`, `externalPath`, `externalGrantId`, `externalSize`, `externalMtime_ms`, `canDecode`, `needsProbe`, `proxy`, `present`), `exportSavePath` and `uniformScaleLock`. `local` is stored in the same record as the document (`project.json` on desktop), is excluded from the canonical form, from the document hash, from state patches, from sync and from packages, and is never validated as part of the canonical document: a malformed `local` is reset to defaults on load with a diagnostic and never fails a load. The current scene and the timeline view state are per device: two devices editing or viewing one project keep their own scene, zoom, scroll and playhead. Changing anything under `local` creates no undo step, no revision and no `metadata.updated_ms` change. A canonical field MUST NOT reference a `local` value. [NEW] [PORT T-099]

#### Scenario: Scene switch is local
- **WHEN** a viewer device switches to another scene of a synced project
- **THEN** `local.currentSceneId` changes on that device only, no state patch is emitted and the lease holder's view is unaffected

#### Scenario: Corrupt local section
- **WHEN** `local.timelineViewState.zoomLevel` is the string "big"
- **THEN** the project loads, `local` is reset to defaults, and a diagnostic names the path

#### Scenario: Package leaves local out
- **WHEN** a project is exported as a `.jagentchill` package
- **THEN** `project.json` inside the package has no `local` key

### Requirement: Scene fields
A scene SHALL be `{id, name, isMain, kind, compoundBackground, tracks {overlay[], main, audio[]}, markers[], inPoint?, outPoint?, multicam?, created_ms, updated_ms}` (`catalog.md` §4). Scene order is the order of `scenes[]`. Exactly one scene has `isMain: true`, it has `kind: "timeline"`, and it is the root of every render, thumbnail and export. `inPoint` and `outPoint` are optional frame-aligned ticks with `inPoint < outPoint` when both exist. A scene of `kind: "compound"` or `"multicam"` that no compound element references is valid and is listed in the Scenes sheet. Scene behaviour is owned by `timeline-editing.Scenes model and switching`. [NEW] [PORT SC-001, SC-005, SC-010]

#### Scenario: Two main scenes
- **WHEN** a document has two scenes with `isMain: true`
- **THEN** validation fails with `document/no-main-scene`

#### Scenario: Range order
- **WHEN** a scene has `inPoint = 480000` and `outPoint = 240000`
- **THEN** validation fails with `document/out-of-range` at `outPoint`

#### Scenario: Scene order is array order
- **WHEN** the user drags the third scene to the first position
- **THEN** the state patch reorders `scenes[]` and no `order` field exists

### Requirement: Compound background rule
A scene SHALL carry `compoundBackground: "none" | "own"` (default `"none"`), read ONLY when the scene is rendered as the source of a compound element. With `"none"` the scene's render target is cleared to `[0, 0, 0, 0]` and NO background node is emitted — neither the project default nor any per-clip `background` of its main-track elements (those overrides are kept in the data and ignored). With `"own"` the scene emits background nodes exactly as a root scene does, but only at times covered by an element of its own main track; at every other time the target stays transparent. "Create compound clip" and "Create multi-camera clip" and "Insert into timeline" of a template always write `"none"`; `"own"` is set only by the user through "Keep this clip's background" in the compound inspector, which is enabled when the scene's main track holds at least one element. A compound element on the parent's main track gets its canvas background from its own `background` field or the project default, like any main-track clip, and `blur` blurs the compound's texture. The field is ignored for the root scene of a render. This resolves the conflict between `render-engine.Compound clip nodes` and `render-engine.Background nodes` (review finding R2-C3-03): the render behaviour is owned by `render-engine`, the field by this capability. [NEW] [CAPCUT CC-053]

#### Scenario: Compound of overlay elements stays transparent
- **WHEN** a title and a sticker over a main-track video are made into a compound clip
- **THEN** the new scene has `compoundBackground = "none"`, and the frame at any time equals the frame before the compound was created within the tolerance of `render-engine.Golden-frame determinism`

#### Scenario: Own background only under main-track content
- **WHEN** a compound scene with `compoundBackground = "own"` has one main-track clip from 0 s to 2 s with `background {kind: "color", color: "#ff0000"}` and the compound element lasts 4 s
- **THEN** the compound texture shows red behind the clip from 0 s to 2 s and is fully transparent from 2 s to 4 s

#### Scenario: Root scene ignores the field
- **WHEN** the main scene has `compoundBackground = "none"`
- **THEN** it renders the project default background as usual

### Requirement: Markers
Each scene SHALL hold `markers[]`, entries `{id, time, note?, color?, duration?}`: `id` unique in the document; `time` frame-aligned; at most one marker per frame time; the list sorted by `time`; `note` at most 2 000 characters; `color` an integer 1–8 (palette token index, default 1) or a `#rrggbb` string; `duration` > 0 when present; at most 1 000 per scene. The stored key is `markers`; the classic key `bookmarks` does not exist at schema 32 and is renamed by the migration (`project-document.Classic v31 mapping`). Markers are addressed by `id` in commands, tools (`jc_marker_edit`) and state patches, never by index or time. Behaviour is owned by `timeline-editing.Markers`. [NEW] [PORT B-001, B-005, B-006, B-007, SC-010] [CAPCUT CC-055]

#### Scenario: Marker added
- **WHEN** a marker is toggled on at 3 s in a 30/1 project
- **THEN** `markers` gains `{id: <uuid>, time: 360000, color: 1}` at its sorted position

#### Scenario: Two markers on one frame
- **WHEN** a document holds two markers with `time = 360000` in one scene
- **THEN** validation fails with `document/elements-unsorted`

#### Scenario: Colour token or custom
- **WHEN** a marker stores `color: 9`
- **THEN** validation fails with `document/out-of-range`; `color: 3` and `color: "#12ab34"` both validate

### Requirement: Multi-camera definition
A scene of `kind: "multicam"` SHALL carry `multicam {syncMethod, angles[], audioAngleId, audioFollowsVideo}` (`catalog.md` §4.1): 2–8 angles `{id, name, trackId, syncOffset, syncConfidence?}`, each naming a distinct `video` track of that scene that holds the angle's source clip(s); array order is angle order ("Angle 1" is `angles[0]`); `audioAngleId` resolves to one of the angles (default the first); `audioFollowsVideo` defaults to `false`. `syncMethod` is `audio`, `start` or `playhead`, and `syncOffset` records the tick offset the method applied to that angle (±30 s). A multicam scene holds no element on its main track and no overlay track other than the angle tracks; its audio tracks are empty. A scene of another kind MUST NOT carry `multicam`. The definition is shared by every multi-camera clip that references the scene: the audio rule (`audioAngleId`, `audioFollowsVideo`) is one setting for the whole multi-camera source, not per split part. Creation, sync analysis and the switcher are owned by `timeline-editing.Multi-camera clip`; the angle viewer by `preview-canvas`; the render path (only the active angle's track contributes picture, one audio source) by `render-engine.Compound clip nodes`. [NEW] [CAPCUT CC-072]

#### Scenario: Created by audio sync
- **WHEN** three clips are combined with method "Audio" and the second clip's peak is found 1.25 s after angle 1
- **THEN** the new scene has `kind = "multicam"`, three angles on three video tracks, `angles[1].syncOffset = 150000`, `angles[1].syncConfidence ≥ 0.6`, `audioAngleId = angles[0].id` and `audioFollowsVideo = false`

#### Scenario: Angle track missing
- **WHEN** `multicam.angles[2].trackId` does not resolve to a video track of the scene
- **THEN** validation fails with `document/multicam-invalid`

#### Scenario: Nine angles
- **WHEN** a tool submits a multicam scene with 9 angles
- **THEN** validation fails with `document/limit-exceeded`

### Requirement: Track zones and types
A scene's tracks SHALL be stored in three containers: `tracks.overlay` (ordered, 0–99; index 0 is the topmost layer), `tracks.main` (exactly one track of type `video`) and `tracks.audio` (ordered, 0–99). The zone is the container; there is NO stored `zone` field. Track types are `video`, `text`, `audio`, `graphic`, `effect`, `adjustment` and `caption`. Zone/type compatibility: `tracks.audio` holds only `audio` tracks; `tracks.overlay` holds every type except `audio`; `tracks.main` is `video`. Element/track compatibility: `audio` → `audio` track; `text` → `text`; `sticker` and `graphic` → `graphic`; `effect` → `effect`; `adjustment` → `adjustment`; `caption` → `caption`; `video`, `image` and `compound` → `video`. A violation is `document/track-zone-mismatch` or `document/element-track-mismatch`. Behaviour is owned by `timeline-editing.Scene track layout` and `timeline-editing.Track types and element compatibility`. [NEW] [PORT T-001, T-002, T-004, T-009] [CAPCUT CC-027]

#### Scenario: Audio track in the overlay zone
- **WHEN** a patch inserts a track of type `audio` into `tracks.overlay`
- **THEN** validation fails with `document/track-zone-mismatch`

#### Scenario: Image on the main track
- **WHEN** an image element is placed on `tracks.main`
- **THEN** the document validates

#### Scenario: Text on a video track
- **WHEN** a tool places a text element on a `video` track
- **THEN** validation fails with `document/element-track-mismatch`

### Requirement: Track fields
A track SHALL be `{id, name, type, locked, pinned, hidden?, muted?, solo?, volume?, pan?, ducking?, transitions[], elements[], caption?}` (`catalog.md` §5): `name` 1–80 characters; `locked` and `pinned` (default false) on every type; `hidden` on every type except `audio`; `muted`, `solo`, `volume` (dB, −60…+12, default 0) and `pan` (−100…+100, default 0) on `video` and `audio` tracks; `ducking {enabled, amount 0–30 dB (12), attack 10–1000 ms (200), release 50–3000 ms (500)}` on `audio` tracks only; `caption` on `caption` tracks only. A key on a track type that does not carry it is `document/field-not-allowed`. `solo` is stored in the document and synced; toggling it emits a state patch but creates no undo step (`audio-editing.Track volume, pan and solo`). Track volume, pan, mute and ducking are static (not animatable). The main track is always present, cannot be removed, and its `pinned` value is ignored. Flag behaviour is owned by `timeline-editing.Track state flags` and `timeline-editing.Empty track pruning and persistent tracks`; audio behaviour by `audio-editing`. `pinned` records only that the user added or renamed the track; a lock is not a reason to pin and unlocking never changes `pinned` (a locked empty track is kept from pruning by its `locked` flag itself, `timeline-editing.Empty track pruning and persistent tracks`), so no "reason" field exists. [NEW] [PORT T-012, T-013, N-005] [CAPCUT CC-060, CC-062, CC-214, CC-224]

#### Scenario: Video track carries audio controls
- **WHEN** a new overlay video track is created
- **THEN** it stores `muted: false`, `solo: false`, `volume: 0`, `pan: 0`, `hidden: false`, `locked: false`, `pinned: false`, `transitions: []`, `elements: []` and no `ducking`

#### Scenario: Ducking on a text track
- **WHEN** a writer adds `ducking` to a `text` track
- **THEN** validation fails with `document/field-not-allowed`

#### Scenario: Solo is not undoable but is saved
- **WHEN** the user solos an audio track and presses Undo
- **THEN** the track still has `solo: true`, and after reopening the project it is still soloed

### Requirement: Caption track fields
A track of type `caption` SHALL carry `caption {language, translationLanguage?, sourceId?, mode, burnIn, showSpeakerLabels, styleId?, style, layout {anchor, marginY, maxWidth, offset, scale}, highlight {style, color, textColor, scale}, bilingual {visible, order, scale, color?}}` (`catalog.md` §5.2). `style` is a complete TextStyle (`project-document.Text style fields`, without `tracking` and `bubble`) and is the style of every caption on the track unless a caption overrides part of it. Defaults are the catalogue style `classic` of `captions-subtitles.Caption default style and layout`: `fontFamily "Arial"`, `fontWeight 700`, `fontSize 5`, `color "#ffffff"`, `stroke {enabled: true, color: "#000000", width: 6, position: "outside"}`, `textAlign "center"`, `background.enabled false`, `layout {anchor: "bottom", marginY: 5, maxWidth: 80, offset: {0, 0}, scale: 1}`, `highlight.style "none"`, `burnIn true`, `mode "speech"`. Caption tracks live only in `tracks.overlay`. Behaviour is owned by `captions-subtitles`. [NEW] [PORT CP-006, CP-009] [CAPCUT CC-195, CC-196, CC-204]

#### Scenario: Generated caption track
- **WHEN** auto captions create a track for English speech
- **THEN** the track has `type = "caption"`, `caption.language = "en"`, `caption.mode = "speech"`, `caption.burnIn = true` and the `classic` style values

#### Scenario: Bilingual track
- **WHEN** captions are translated to Vietnamese in "Bilingual" mode
- **THEN** `caption.translationLanguage = "vi"` and every caption element has a `translation` string

#### Scenario: Caption object on a text track
- **WHEN** a `text` track carries a `caption` object
- **THEN** validation fails with `document/field-not-allowed`

### Requirement: Track transition records
Picture transitions and audio crossfades SHALL be stored as records in the `transitions[]` array of the track that holds the two joined elements; there is no `crossfades[]` array. A record is `{id, kind, fromElementId, toElementId, duration, type?, params?, easing?, audioCrossfade?, shape?}` (`catalog.md` §5.1). `kind: "transition"` exists only on `video` tracks and carries `type` (a registered transition id), `params`, `easing` (default `ease-in-out`), `audioCrossfade` (default true) and `shape` (the shape of the paired audio crossfade, default `equal-power`). `kind: "crossfade"` exists only on `audio` tracks and carries `duration` and `shape` only. The outgoing element's `transitionOut` and the incoming element's `transitionIn` SHALL both hold the record's `id`, and the record's `fromElementId` / `toElementId` SHALL name them (mirror rule; a mismatch is `document/transition-ref-mismatch`). The two elements SHALL be exactly adjacent on the record's track (`from.startTime + from.duration = to.startTime`; otherwise `document/transition-not-adjacent`), and a cut holds at most one record. `duration` is frame-aligned and at least 2 frames: 0.1–5.0 s for a transition, 0.05–10 s for a crossfade. A command that breaks adjacency or deletes either element removes the record and clears both references in the same undo step. Behaviour is owned by `transitions` and, for `shape` and crossfades, `audio-editing.Crossfades`. [NEW] [PORT N-001, N-004] [CAPCUT CC-099, CC-101]

#### Scenario: Add a transition
- **WHEN** "Dissolve" is applied to the cut between clips `a` and `b` on the main track
- **THEN** `tracks.main.transitions` gains `{id: t1, kind: "transition", fromElementId: a, toElementId: b, duration: 60000, type: "dissolve", params: {}, easing: "ease-in-out", audioCrossfade: true, shape: "equal-power"}`, `a.transitionOut = t1` and `b.transitionIn = t1`

#### Scenario: Audio crossfade record
- **WHEN** a crossfade is added between two adjacent audio clips
- **THEN** the audio track's `transitions` gains `{id, kind: "crossfade", fromElementId, toElementId, duration: 60000, shape: "equal-power"}` with no `type`, `params`, `easing` or `audioCrossfade`

#### Scenario: Orphan reference
- **WHEN** an element has `transitionOut = "t9"` and the track has no record `t9`
- **THEN** validation fails with `document/transition-ref-mismatch`

#### Scenario: Moving a clip removes its transition
- **WHEN** clip `b` is moved 1 s to the right
- **THEN** record `t1` is removed and `a.transitionOut` and `b.transitionIn` become `null` in the same undo step

### Requirement: Track and element ordering
Array order SHALL be canonical so that equal content has one byte form. `tracks.overlay` and `tracks.audio` are ordered by layer position and are reordered only by track commands. `elements[]` of every track SHALL be sorted by `startTime` ascending, ties broken by `id` in code-unit order; two elements of one track MUST NOT overlap in time (touching is allowed), so a tie exists only transiently and is a validation error at commit. `markers[]` is sorted by `time`; keys of a channel by `time`; `media.assets` by `id`; `beats[]` ascending; `words[]` by `start`; `effects[]`, `masks[]`, `scenes[]`, `multicam.angles[]`, `template.slots[]`, `strokes[]`, curve points and path points keep their meaningful order. A writer that produces an array out of canonical order fails validation with `document/elements-unsorted`. Overlap behaviour is owned by `timeline-editing.Overlap rule`. [NEW] [PORT T-005]

#### Scenario: Insert keeps the sort
- **WHEN** an element starting at 2 s is inserted into a track holding elements at 0 s and 5 s
- **THEN** it is stored at array index 1

#### Scenario: Overlap rejected
- **WHEN** a patch gives two elements of one track the ranges 0–3 s and 2–5 s
- **THEN** validation fails with `document/elements-overlap`

#### Scenario: Touching is valid
- **WHEN** one element ends at tick 360 000 and the next starts at tick 360 000
- **THEN** the document validates

### Requirement: Element common fields
Every element SHALL carry `id`, `type`, `name` (1–200 characters), `startTime`, `duration` (at least 1 frame, at most 6 h), `trimStart`, `trimEnd`, `groupId`, `linkId`, `transitionIn`, `transitionOut`, and optionally `sourceDuration` (video, audio, compound), `hidden` (every type except `audio`), `filmLink`, `workflowLink`, `scriptLink` and `animations` (`catalog.md` §6). For an element with a source, `trimStart + trimEnd ≤ sourceDuration`, and the visible source span is `sourceDuration − trimStart − trimEnd`, related to `duration` by the retime map of `speed-retime.Retime time map`; elements without a source (text, caption, sticker, graphic, effect, adjustment, image, freeze) have `trimStart = trimEnd = 0`. `groupId` is shared by at least 2 elements of one scene; `linkId` by exactly 2 elements of one scene, of which exactly one is an `audio` element and the other is a `video`, `compound` or `text` element (a detached or recorded sound with its picture, or a text with the speech generated from it; `timeline-editing.Video and audio linking`); any other pairing is `document/link-invalid`. `muted` exists on audio-capable elements only (`project-document.Element audio level fields`). There is no `params` map on an element except the `params` of a graphic element (`project-document.Graphic element`); there is no stored `zone`, `trackId`, `sceneId` (other than a compound's reference) or `order` on an element — position is the containing track and `startTime`. Behaviour is owned by `timeline-editing`. [NEW] [PORT T-003, T-073, T-083, T-084] [CAPCUT CC-051, CC-052, CC-054]

#### Scenario: Group of one
- **WHEN** a document holds exactly one element with `groupId = "g1"`
- **THEN** validation fails with `document/group-invalid`

#### Scenario: Link of three
- **WHEN** three elements share one `linkId`
- **THEN** validation fails with `document/link-invalid`

#### Scenario: Trim beyond the source
- **WHEN** a video element has `sourceDuration = 600000`, `trimStart = 400000`, `trimEnd = 300000`
- **THEN** validation fails with `document/time-out-of-bounds`

#### Scenario: Params map on a video element
- **WHEN** a schema-32 writer submits a video element with a `params` key
- **THEN** validation fails with `document/field-not-allowed`

### Requirement: Element types and field applicability
The element types at schema 32 SHALL be exactly `video`, `image`, `audio`, `text`, `caption`, `sticker`, `graphic`, `effect`, `adjustment` and `compound`. There is no `filter`, `slate`, `multicam`, `freeze` or `drawing` element type: a standalone filter is an `effect` element whose entry has `kind: "filter"`; a slate clip is an `image` element whose asset has `kind: "slate"`; a multi-camera clip is a `compound` element with `multicam`; a freeze frame is a `video` or `compound` element with `freeze`; a drawing is a `graphic` element with `definitionId: "drawing"`. Which field groups exist on which type is the matrix of `catalog.md` §10.1, summarised as: maskable = video, image, sticker, graphic, compound, adjustment; adjustable (`adjustments`) = the same six; effect stack = video, image, text, sticker, graphic, compound (≤ 16), effect (exactly 1), adjustment (≤ 1, filter only); `chromaKey` and `cutout` = video, image; `crop` and per-clip `background` = video, image, compound; retimable = video, audio, compound (constant rate and reverse only); audio fields = audio, video, compound; `clipAnimation` = video, image, sticker, graphic, compound; `textAnimation` = text and caption styles; `tracking` binding = text, sticker, graphic; caption elements carry no `effects[]`, `masks[]`, `opacity` or `blendMode`. A schema-32 key present on a type that does not carry it fails validation with `document/field-not-allowed`. [NEW] [PORT T-003, K-022] [CAPCUT CC-027]

#### Scenario: Mask on a text element
- **WHEN** a tool writes `masks: [..]` on a text element
- **THEN** validation fails with `document/field-not-allowed`

#### Scenario: Standalone filter
- **WHEN** a filter tile is clicked with no selection
- **THEN** the new element has `type = "effect"` and `effects = [{id, type: <filter id>, kind: "filter", enabled: true, params: {intensity: 100}}]`

#### Scenario: Chroma key on a sticker
- **WHEN** a writer adds `chromaKey` to a sticker element
- **THEN** validation fails with `document/field-not-allowed`

### Requirement: Video element
A `video` element SHALL carry `mediaId` (a `video` asset), `sourceDuration`, the visual fields (`transform`, `opacity`, `blendMode`, `crop`, `flip`, `effects[]`, `masks[]`, optional `adjustments`, `chromaKey`, `cutout`, `stabilization`, `deflicker`, `retouch`, `relight`, `eyeContact`, `motionBlur`, `clipAnimation`, `aiMotion`, `processedSource`, per-clip `background`), the time fields (`retime`, `freeze`), and the audio fields of `catalog.md` §9 including `isSourceAudioEnabled` (default true). `processedSource {originalMediaId, tool, sourceStart?, sourceEnd?}` records that a replacing tool (`upscale`, `lipsync`, `object-removal`, `restyle`, `expand`) switched `mediaId`, so that "Revert to original" of `ai-editing-tools.Upscale and enhance` restores `originalMediaId` and removes the field. A freeze element is a `video` element with `freeze {mediaId, sourceTime}`: it has no `retime`, no audio contribution, `trimStart = trimEnd = 0`, no `sourceDuration`, and its `mediaId` equals `freeze.mediaId`. [NEW] [PORT T-003, AU-004] [CAPCUT CC-040]

#### Scenario: Freeze element shape
- **WHEN** "Freeze frame" is applied at source time 2.5 s of asset `a1`
- **THEN** the inserted element has `type = "video"`, `mediaId = "a1"`, `freeze = {mediaId: "a1", sourceTime: 300000}`, `duration = 360000`, and no `retime` or `sourceDuration`

#### Scenario: Freeze with retime
- **WHEN** a writer adds `retime` to an element that has `freeze`
- **THEN** validation fails with `document/field-not-allowed`

#### Scenario: Upscale and revert
- **WHEN** a clip using asset `a1` is upscaled to asset `a9` and then reverted
- **THEN** after upscale `mediaId = "a9"` and `processedSource = {originalMediaId: "a1", tool: "upscale", …}`; after revert `mediaId = "a1"` and `processedSource` is absent

### Requirement: Image element and slate clips
An `image` element SHALL carry `mediaId` (an `image` asset) and the visual fields of a video element except `stabilization`, `deflicker`, `retime`, `freeze` and the audio fields; it has no `sourceDuration` and `trimStart = trimEnd = 0`. A slate clip is an `image` element whose asset has `kind: "slate"` and normally carries a `scriptLink`; nothing else in the element marks it. Replacing a slate clip with real footage changes the element's `type` to `video` when the new asset is a video, keeping `id`, timing, transform, effects, masks, adjustments, animations and `scriptLink`; fields that do not exist on the new type are removed and fields that the new type requires are written at their defaults, in the same command. Slate behaviour is owned by `media-library.Slate media` and `script-studio.Draft timeline from a script`. [NEW] [PORT T-003]

#### Scenario: Slate clip
- **WHEN** a draft timeline is created from a script shot
- **THEN** the element is `type: "image"` with a `mediaId` whose asset has `kind: "slate"`, and it carries `scriptLink`

#### Scenario: Slate replaced by video
- **WHEN** a slate clip is replaced with a 4 s video asset
- **THEN** the element keeps its `id` and `scriptLink`, has `type = "video"`, gains `sourceDuration`, `volume: 0`, `muted: false`, `pan: 0` and `isSourceAudioEnabled: true`

#### Scenario: Audio asset on an image element
- **WHEN** an image element's `mediaId` resolves to an audio asset
- **THEN** validation fails with `document/asset-type-mismatch`

### Requirement: Audio element
An `audio` element SHALL carry `sourceType` (`upload`, `library` or `bundled`), `mediaId` and the audio fields of `catalog.md` §9, plus `retime`. Every audio element references a project media asset by `mediaId` regardless of `sourceType`: `upload` for imported, recorded, extracted and generated audio (extracted audio references the `video` asset it came from); `library` for an online sound stored in the project; `bundled` for a sound of the bundled pack stored in the project. `sourceUrl` is a legacy classic key kept on migrated `library` elements and is never used for playback. An audio element has no `hidden`, no transform and no visual field. `sourceType` behaviour and the sounds library are owned by `audio-editing.Audio tracks and audio elements` and `audio-editing.Add a library sound to the timeline`. [NEW] [PORT T-003, AU-001, AU-014] [CAPCUT CC-207]

#### Scenario: Library sound
- **WHEN** an online sound is added to the timeline
- **THEN** the element is `{type: "audio", sourceType: "library", mediaId: <asset>, …}` and the asset's `provenance` carries `author`, `licence` and `sourceUrl`

#### Scenario: Extracted audio
- **WHEN** audio is extracted from a video clip using asset `v1`
- **THEN** the new audio element has `sourceType = "upload"`, `mediaId = "v1"`, and shares a `linkId` with the video element

#### Scenario: Audio element without a media id
- **WHEN** an audio element has `sourceType: "bundled"` and no `mediaId`
- **THEN** validation fails with `document/missing-field`

### Requirement: Text element
A `text` element SHALL store its content and style as typed top-level fields (`catalog.md` §10.4): `content` (0–10 000 characters), `fontFamily`, `fontSize` (1–500, step 0.1, default 15), `fontWeight` (a number 100…900 in hundreds, default 400), `fontStyle`, `underline`, `strikethrough`, `textCase`, `color`, `fill {type, gradientColor, gradientAngle}`, `textAlign` (`left`, `center`, `right`, `justify`), `letterSpacing`, `lineHeight`, `box {mode, width}`, `curve`, `background {…}`, `stroke {…}`, `shadow {…}`, `glow {…}`, optional `bubble {…}`, optional `textAnimation {in?, out?, loop?}`, optional `tracking` and optional `stylePresetId`; plus `transform`, `opacity`, `blendMode`, `flip`, `effects[]` and `motionBlur`. The classic key `textDecoration` and string weights do not exist at schema 32. On a text element the key `background` is the TEXT background object; the canvas-background union never appears on a text element. `bubble` and `background.enabled: true` are mutually exclusive. A text element has no `mediaId`, `crop`, `masks[]`, `adjustments`, `clipAnimation` or audio field. Behaviour is owned by `text-and-titles`. [NEW] [PORT TX-001, TX-002, TX-003, TX-004, TX-005] [CAPCUT CC-171, CC-175]

#### Scenario: New text element
- **WHEN** a default text element is added
- **THEN** it stores `content: "Default text"`, `fontFamily: "Arial"`, `fontSize: 15`, `fontWeight: 400`, `color: "#ffffff"`, `textAlign: "center"`, `lineHeight: 1.2`, `box: {mode: "auto", width: 80}`, `background.enabled: false`, `stroke.enabled: false`, `shadow.enabled: false`, `glow.enabled: false` and no `bubble`, `textAnimation` or `tracking`

#### Scenario: String weight rejected
- **WHEN** a writer stores `fontWeight: "bold"`
- **THEN** validation fails with `document/wrong-type`

#### Scenario: Bubble and background together
- **WHEN** a text element has a `bubble` and `background.enabled: true`
- **THEN** validation fails with `document/field-not-allowed` at `background.enabled`

### Requirement: Text style fields
TextStyle SHALL be the set of text fields other than `content` (`catalog.md` §10.4) and is reused, with the same names, ranges and defaults, by caption track styles, per-caption overrides and cover texts. Sub-objects: `background {enabled, color, cornerRadius 0–100, paddingX 0–1000 (30), paddingY 0–1000 (42), offsetX, offsetY}`; `stroke {enabled, color, width 0–50 (6), position: "outside" | "center"}`; `shadow {enabled, color, opacity 0–100 (80), blur 0–100 (10), distance 0–100 (5), angle −180…180 (−45)}`; `glow {enabled, color, intensity 0–100 (50), radius 0–100 (20)}`; `bubble {id, color, strokeColor, strokeWidth 0–20, flipHorizontal}`; `fill {type: "solid" | "gradient", gradientColor, gradientAngle 0–360 (90)}`; `textAnimation {in {id, duration, strength}, out {id, duration, strength}, loop {id, period, strength}}` with `strength` 0–100 (100), `in.duration + out.duration ≤ element duration`, and `loop.period` 0.2–5 s. Animation and bubble ids resolve to `text-and-titles/catalog.md`; an unregistered id is `document/unknown-definition` for a writer and is preserved without rendering for a reader. The field `fontSize` has step 0.1 everywhere (text elements, caption styles, text masks use their own range). [NEW] [PORT TX-012, TX-013, TX-014, TX-015, TX-016, N-012] [CAPCUT CC-173, CC-174, CC-176, CC-177, CC-179, CC-180, CC-181]

#### Scenario: Shadow defaults
- **WHEN** the user turns the shadow on for a text element
- **THEN** `shadow` is `{enabled: true, color: "#000000", opacity: 80, blur: 10, distance: 5, angle: -45}`

#### Scenario: In plus out longer than the element
- **WHEN** a 1 s text element stores `textAnimation.in.duration = 96000` and `textAnimation.out.duration = 96000`
- **THEN** validation fails with `document/out-of-range`

#### Scenario: Fractional font size
- **WHEN** an ASS import writes `fontSize = 4.4`
- **THEN** the value is stored as 4.4 and validates

### Requirement: Tracking binding
A text, sticker or graphic element SHALL be able to carry `tracking {targetElementId, trackId, followPosition, followScale, followRotation, offset {x, y}}`: `targetElementId` resolves to a video element of the same scene; `trackId` resolves to an entry of `motionTracks[]` on that element's asset; `followPosition` defaults to true; `followScale` and `followRotation` default to false on text and true on stickers and graphics. A mask carries the same idea as `masks[].tracking {trackId, followPosition, followScale, followRotation, offset}`, where the track belongs to the mask's own element's asset. A binding is resolved live by the engine and writes no keyframes; "Convert to keyframes" removes the binding and writes ordinary channels. Deleting the target element or the motion track removes every binding that references it in the same undo step; a binding whose reference does not resolve is `document/unknown-reference`. Motion-track metadata lives on the asset record (`project-document.Media asset records`); the per-frame data is a content-addressed derived blob outside the document. Behaviour is owned by `text-and-titles.Text tracking`, `stickers-shapes.Sticker and shape animation and tracking`, `masks-blending-keying.Mask tracking attachment` and `ai-editing-tools.Motion tracking`. [NEW] [CAPCUT CC-184, CC-191, CC-240]

#### Scenario: Text follows a subject
- **WHEN** a text element is attached to track `m1` of the video element `v1`
- **THEN** it stores `tracking = {targetElementId: "v1", trackId: "m1", followPosition: true, followScale: false, followRotation: false, offset: {x, y}}` and no position keyframes are created

#### Scenario: Mask binding instead of baked keys
- **WHEN** a rectangle mask is attached to track `m1` of its own clip
- **THEN** the mask stores `tracking {trackId: "m1", …}` and its `centerX` / `centerY` channels are unchanged

#### Scenario: Target deleted
- **WHEN** the tracked video element is deleted
- **THEN** the same undo step removes the `tracking` key from every follower

### Requirement: Caption element
A `caption` element SHALL carry `text` (0–500 characters), optional `words[] {text, start, end}` (at most 200; ticks relative to the element start, ordered, non-overlapping, inside `[0, duration]`), optional `translation` (0–500 characters), optional `speaker` (0–80 characters), optional `style` (a PARTIAL TextStyle whose present keys override the track style, merged per sub-object key) optional `edited` (boolean, default `false`; set to `true` by any user or tool command that changes `text`, `translation` or `words` after generation, and reset only by regenerating the caption) and optional `transform {position, scale, rotation}` (a per-caption placement override; absent means the track layout). It carries `hidden` and no other visual, time or audio field. Caption elements exist only on `caption` tracks and MUST NOT overlap one another on a track. "Burn-in" is the track field `caption.burnIn`, not an element field. Behaviour is owned by `captions-subtitles.Caption track and caption elements`. [NEW] [PORT CP-006] [CAPCUT CC-195, CC-204]

#### Scenario: Generated caption with word timings
- **WHEN** a caption "hello world" is generated for 0.8 s with two words
- **THEN** the element is `{type: "caption", text: "hello world", words: [{text: "hello", start: 0, end: 48000}, {text: "world", start: 48000, end: 96000}], duration: 96000, …}`

#### Scenario: Partial style override
- **WHEN** one caption's colour is changed with "Apply to all" off
- **THEN** that element stores `style: {color: "#ffd400"}` and inherits every other style value from the track

#### Scenario: Word outside the caption
- **WHEN** a caption of duration 96 000 has a word with `end = 120000`
- **THEN** validation fails with `document/caption-overlap`

#### Scenario: Manual edit is recorded
- **WHEN** the user corrects one word of a generated caption
- **THEN** that caption has `edited: true`, so that `captions-subtitles.Caption grouping` knows a Regroup would discard a manual edit and asks for confirmation; with no edited caption on the track Regroup runs without asking

### Requirement: Sticker element
A `sticker` element SHALL carry `stickerId` (`provider:value`, both parts non-empty), `intrinsicWidth` and `intrinsicHeight` (px, default 200), `loop` (default true) and `playbackSpeed` (0.1–4, default 1), plus `transform`, `opacity`, `blendMode`, `flip`, `effects[]`, `masks[]`, optional `adjustments`, `motionBlur`, `clipAnimation` and optional `tracking`. It has no `mediaId`: a user-imported or generated sticker is addressed as `user:<sha256>` or `generated:<sha256>`, and its bytes are a project media asset whose `contentHash` equals that hash. Behaviour is owned by `stickers-shapes`. [NEW] [PORT G-001, G-011] [CAPCUT CC-187, CC-190]

#### Scenario: Flag sticker
- **WHEN** the flag of Japan is added
- **THEN** the element stores `stickerId: "flags:JP"`, its intrinsic size, `loop: true` and `playbackSpeed: 1`

#### Scenario: Malformed id
- **WHEN** a writer stores `stickerId: "flags:"`
- **THEN** validation fails with `document/wrong-type`

#### Scenario: Imported sticker resolves to an asset
- **WHEN** a sticker has `stickerId: "user:<h>"` and no asset has `contentHash = <h>`
- **THEN** validation reports `document/unknown-asset` as a warning and the sticker shows the missing state of `stickers-shapes.Missing sticker state`

### Requirement: Graphic element
A `graphic` element SHALL carry `definitionId` — one of `rectangle`, `ellipse`, `polygon`, `star`, `arrow`, `line`, `drawing` — and `params`, a flat map holding ONLY the keys of that definition (`catalog.md` §10.8: `fill`, `stroke`, `strokeWidth`, `strokeAlign`, `cornerRadius`, `sides`, `points`, `depth`, `lineCap`, `dash`, `headSize`, `shaftWidth`, `doubleHeaded`, `colorOverride`), plus `transform`, `opacity`, `blendMode`, `flip`, `effects[]`, `masks[]`, optional `adjustments`, `motionBlur`, `clipAnimation` and optional `tracking`. The graphic `params` map is the only `params` map on an element; the visual keys (`transform.*`, `opacity`, `blendMode`) never appear in it. A key that the definition does not declare fails validation with `document/field-not-allowed`. Shapes other than `drawing` render from a 512 × 512 vector source. Behaviour is owned by `stickers-shapes.Shape parameter table`. [NEW] [PORT G-004, G-012, G-013, G-014, G-015, G-016, G-017]

#### Scenario: Star
- **WHEN** a star shape is added
- **THEN** it stores `definitionId: "star"` and `params: {fill: "#ffffff", stroke: "#000000", strokeWidth: 0, strokeAlign: "center", points: 5, depth: 45}`

#### Scenario: Foreign key in params
- **WHEN** a rectangle's `params` holds `sides: 6`
- **THEN** validation fails with `document/field-not-allowed`

#### Scenario: Animated shape parameter
- **WHEN** the star's `depth` is keyframed
- **THEN** the channel is stored under the animation path `params.depth`

### Requirement: Freehand drawing geometry
A graphic element with `definitionId: "drawing"` SHALL additionally carry `strokes[]` (1–2 000 entries, at most 200 000 points in total) and `intrinsicWidth` / `intrinsicHeight`. A stroke is `{id, points, width, color, brush}`: `points` is an array of 2–10 000 `[x, y]` pairs in element-local pixels relative to the centre of the drawing's bounding box, rounded to 0.01; `width` is 1–200 px; `brush` is `pen` or `marker`. The intrinsic size is the bounding box of all strokes expanded by half the largest stroke width on every side, and `transform.position` is the canvas position of that box's centre, so a new drawing appears where it was drawn at scale 1. Adding or erasing strokes recomputes the box and adjusts `transform.position` so that existing strokes do not move on the canvas. `params.colorOverride` (`""` = none) recolours every stroke at render time without rewriting `strokes[].color`. A drawing is rasterised at its displayed size capped at 4 096 px on the long side. Behaviour is owned by `stickers-shapes.Freehand drawing`. [NEW] [CAPCUT CC-185]

#### Scenario: One stroke
- **WHEN** the user draws a 300 px horizontal line with a 12 px pen centred at canvas position (100, −50)
- **THEN** the element has `intrinsicWidth = 312`, `intrinsicHeight = 12`, `transform.position = {x: 100, y: -50}`, and one stroke whose points run from `[-150, 0]` to `[150, 0]`

#### Scenario: Empty drawing
- **WHEN** a writer submits a drawing with `strokes: []`
- **THEN** validation fails with `document/out-of-range`

#### Scenario: Adding a stroke keeps the old ones in place
- **WHEN** a second stroke is added 200 px to the right of the first
- **THEN** the bounding box grows, `transform.position.x` shifts by half the growth, and the first stroke renders at the same canvas pixels as before

### Requirement: Effect element
An `effect` element SHALL carry `effects[]` with exactly one entry (`kind: "effect"` or `"filter"`), `target: "beneath"` and `hidden`; it applies its entry to the composite of every layer beneath it for its time range. It has no `transform`, `opacity`, `masks[]`, `adjustments`, `retime`, `clipAnimation`, transition reference or audio field, and no top-level `effectType` or `params` (the classic shape). Its animation paths are `effects.<effectId>.params.<key>`, the same as for a clip effect; the path `params.<key>` does not exist on an effect element. Converting a layer into a clip entry ("Target ▸ Clip…" of `visual-effects-filters.Filter layer and clip filter conversion`) deletes the element and appends the entry to the clip, so `target` has one value at schema 32. Behaviour is owned by `visual-effects-filters.Standalone effect layer`. [NEW] [PORT E-004] [CAPCUT CC-109]

#### Scenario: Blur layer
- **WHEN** the Blur effect is added with no selection
- **THEN** the element is `{type: "effect", target: "beneath", effects: [{id, type: "blur", kind: "effect", enabled: true, params: {intensity: 15}}], …}`

#### Scenario: Two entries
- **WHEN** an effect element holds two entries
- **THEN** validation fails with `document/effects-limit`

#### Scenario: Keyframing a layer parameter
- **WHEN** the layer's intensity is keyframed
- **THEN** the channel key is `effects.<id>.params.intensity`

### Requirement: Adjustment element
An `adjustment` element SHALL carry `adjustments` (`project-document.Colour adjustments`), `effects[]` restricted to at most one entry of `kind: "filter"`, `opacity` stored as a fraction 0–1 (default 1; displayed 0–100 %; it mixes the adjusted result with the unadjusted composite), `masks[]` and `hidden`. It has no `transform`, `blendMode`, `crop`, `retime`, `clipAnimation`, transition reference or audio field. Its animatable paths are `opacity`, `adjustments.*`, `effects.<id>.params.<key>` and `masks.<id>.params.<key>`. Behaviour is owned by `color-adjustment.Adjustment layers`. [NEW] [CAPCUT CC-133]

#### Scenario: Half-strength adjustment layer
- **WHEN** the layer's opacity slider is set to 50 %
- **THEN** the element stores `opacity: 0.5`

#### Scenario: Effect entry on an adjustment layer
- **WHEN** an adjustment element holds an entry with `kind: "effect"`
- **THEN** validation fails with `document/effects-limit`

#### Scenario: Opacity out of range
- **WHEN** a tool writes `opacity: 50` on an adjustment element
- **THEN** validation fails with `document/out-of-range`

### Requirement: Compound element
A `compound` element SHALL carry `sceneId` (a scene of `kind` `compound` or `multicam` of the same project, never the main scene), `sourceDuration` (the referenced scene's duration), the visual fields of a video element except `chromaKey`, `cutout`, `stabilization`, `deflicker`, `retouch`, `relight`, `eyeContact`, `aiMotion` and `processedSource`, `retime` restricted to `{rate, maintainPitch, reverse}` (no `curve`, `smooth: "none"`), optional `freeze {sourceTime}` (without `mediaId`), and the audio fields. The reference graph of compound elements SHALL be acyclic and at most 8 levels deep (`document/compound-cycle`, `document/compound-depth`). Deleting a scene that a compound element references is rejected unless the same command removes the referencing elements. Behaviour is owned by `timeline-editing.Compound clips`; rendering by `render-engine.Compound clip nodes`. [NEW] [CAPCUT CC-053]

#### Scenario: Compound references a compound scene
- **WHEN** a compound clip is created from three clips
- **THEN** the element has `type: "compound"`, `sceneId` of the new scene whose `kind` is `"compound"`, and `sourceDuration` equal to that scene's duration

#### Scenario: Self-reference
- **WHEN** a patch places a compound element referencing scene `c1` inside scene `c1`
- **THEN** validation fails with `document/compound-cycle`

#### Scenario: Curve on a compound
- **WHEN** a tool sets `retime.curve` on a compound element
- **THEN** validation fails with `document/field-not-allowed`

### Requirement: Multi-camera clip
A multi-camera clip SHALL be a `compound` element whose `sceneId` names a scene of `kind: "multicam"` and which carries `multicam {angleId}`, the id of the active angle for the whole time range of that element. Switching angle at the playhead splits the element there and sets `multicam.angleId` of the right-hand part; switching on a part's first frame rewrites that part's `angleId` without a split. Picture comes only from the track of `angleId`. Audio comes from the scene's `multicam.audioAngleId`, or from the element's own `angleId` when the scene's `audioFollowsVideo` is `true`. A compound element referencing a multicam scene without `multicam.angleId`, with an `angleId` that is not one of the scene's angles, or a `multicam` key on a compound referencing a non-multicam scene, is `document/multicam-invalid`. Two adjacent parts with the same `angleId` and continuous source time are merged by the command that produced them. A multi-camera clip is opened on mobile with angle switching available and creation unavailable (`timeline-editing.Timeline actions for mobile toolbars`). [NEW] [CAPCUT CC-072]

#### Scenario: Switch angle at the playhead
- **WHEN** a 10 s multi-camera clip on angle `A` is switched to angle `B` at 4 s
- **THEN** there are two compound elements, 0–4 s with `multicam.angleId = "A"` and 4–10 s with `multicam.angleId = "B"`, created as one undo step

#### Scenario: Audio follows video
- **WHEN** the scene's `multicam.audioFollowsVideo` is set to `true`
- **THEN** each part is heard from its own active angle, and the change is one patch on the scene, not on the parts

#### Scenario: Unknown angle
- **WHEN** a part has `multicam.angleId = "zz"` and the scene has no such angle
- **THEN** validation fails with `document/multicam-invalid`

### Requirement: Transform
Every element type marked for `transform` in `catalog.md` §10.1 SHALL store `transform {position {x, y}, scale {x, y}, rotation}`: `position` in canvas pixels from the canvas centre (x right, y down; −100 000…100 000, step 1, default 0); `scale` as a multiplier of the fitted size (0.01–100, step 0.01, default 1; the static value is always positive); `rotation` in degrees clockwise (−3600…3600, step 0.1, default 0). The stored key is `rotation`; the names `rotate`, `scaleX`, `scaleY`, `positionX` and `positionY` do not exist at schema 32, in fields or in animation paths. Mirroring is expressed only by `flip`. The uniform-scale lock is a device preference (`local.uniformScaleLock`), not a document field. Behaviour is owned by `preview-canvas.Basic tab fields`; geometry by `render-engine.Contain-fit, crop, flip and transform`. [NEW] [PORT PR-004, PR-005, PR-006, A-001] [CAPCUT CC-043, CC-045]

#### Scenario: Stored shape
- **WHEN** an element is moved 120 px right, scaled to 150 % and rotated 30°
- **THEN** it stores `transform = {position: {x: 120, y: 0}, scale: {x: 1.5, y: 1.5}, rotation: 30}`

#### Scenario: Negative static scale
- **WHEN** a writer stores `transform.scale.x = -1`
- **THEN** validation fails with `document/out-of-range`

#### Scenario: Old spelling
- **WHEN** a writer stores `transform.rotate = 30`
- **THEN** validation fails with `document/missing-field` for `rotation` and `document/field-not-allowed` for `rotate`

### Requirement: Opacity, blend mode, crop and flip
Visual elements SHALL store `opacity` as a fraction 0–1 (step 0.01, default 1) on every type that carries it, including adjustment elements; `blendMode` as one of the 17 values `normal`, `darken`, `multiply`, `color-burn`, `lighten`, `screen`, `plus-lighter`, `color-dodge`, `overlay`, `soft-light`, `hard-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity` (default `normal`, not animatable); `crop {left, top, right, bottom}` as fractions of the source, each 0–0.99 with `left + right ≤ 0.99` and `top + bottom ≤ 0.99` (default 0, animatable) on video, image and compound elements; and `flip {horizontal, vertical}` booleans (default false, not animatable). Percent is a display form only: no opacity is stored on a 0–100 scale. Behaviour is owned by `masks-blending-keying.Opacity`, `masks-blending-keying.Blend modes`, `preview-canvas.Crop mode` and `preview-canvas.Flip, mirror and quarter-turn rotation`. [NEW] [PORT E-010, E-011, PR-007, PR-008, N-013] [CAPCUT CC-041, CC-042, CC-149, CC-150]

#### Scenario: Crop sum
- **WHEN** a writer stores `crop = {left: 0.6, right: 0.5, top: 0, bottom: 0}`
- **THEN** validation fails with `document/out-of-range`

#### Scenario: Unknown blend mode from a newer schema
- **WHEN** a reader opens an element with `blendMode: "linear-burn"`
- **THEN** the value is preserved, the element renders with `normal`, and the notice of `project-document.Unknown-field preservation` is shown

#### Scenario: Flip is a flag
- **WHEN** the user presses "Flip horizontal"
- **THEN** `flip.horizontal` toggles and `transform.scale.x` is unchanged

### Requirement: Per-clip canvas background field
A `video`, `image` or `compound` element SHALL be able to carry `background`, a value of `project-document.Canvas background union`; an absent key means "use the project default". The field is stored on the element wherever the element sits, is rendered only while the element is on the main track of the scene being presented (or of a compound scene with `compoundBackground: "own"`), and is kept unchanged while the element is on an overlay track. "Apply to all" writes the value to `settings.background` and removes the key from every main-track element of every scene in one undo step. Behaviour is owned by `timeline-editing.Per-clip canvas background`. [NEW] [CAPCUT CC-008, CC-009, CC-010, CC-011]

#### Scenario: Override stored on the clip
- **WHEN** the second main-track clip is given a white background
- **THEN** that element stores `background: {kind: "color", color: "#ffffff"}` and `settings.background` is unchanged

#### Scenario: Apply to all
- **WHEN** "Apply to all" is pressed with blur 200 shown
- **THEN** `settings.background = {kind: "blur", blurIntensity: 200}` and no main-track element has a `background` key

#### Scenario: Overlay keeps the data
- **WHEN** a clip with a `background` is moved to an overlay track
- **THEN** the key is still stored and is not rendered

### Requirement: Effect entries
An `effects[]` entry SHALL be `{id, type, kind, enabled, params}`: `type` a registered definition id; `kind` `"effect"` or `"filter"`; `enabled` default true; `params` a flat map of the definition's keys (number, boolean or string values) with every key present. Limits: at most 16 entries and at most one of `kind: "filter"` on a clip; exactly one entry on an `effect` element; at most one entry, of `kind: "filter"`, on an `adjustment` element. The array index of the filter entry has no rendering meaning. An entry is addressed by `id` in commands, tools, state patches and animation paths (`effects.<id>.params.<key>`). An entry whose `type` is not registered in the reader is preserved and rendered as pass-through; a writer MUST NOT create one. Removing an entry removes every animation path that starts with `effects.<id>.` in the same command. Definitions, parameters and rendering are owned by `visual-effects-filters` and its `catalog.md`. [NEW] [PORT E-003, E-005, E-007, E-009] [CAPCUT CC-108, CC-112]

#### Scenario: Second filter
- **WHEN** a clip already holds a filter entry and a patch appends another entry with `kind: "filter"`
- **THEN** validation fails with `document/effects-limit`

#### Scenario: Removing an entry removes its channels
- **WHEN** the entry `e1` with the channel `effects.e1.params.intensity` is removed
- **THEN** the same patch removes that animation path

#### Scenario: Missing parameter key
- **WHEN** a writer creates a blur entry with `params: {}`
- **THEN** validation fails with `document/missing-field` at `params.intensity`

### Requirement: Motion blur and clip animation fields
`motionBlur` SHALL be `{enabled, strength, samples}`: `strength` 0–100 (default 50, animatable as `motionBlur.strength`), `samples` one of 4, 8, 16 (default 8). `clipAnimation` SHALL be `{in?, out?, combo?}` where each slot is `{type, duration, strength}` and `combo` additionally has `followsDuration` (default true: the combo duration tracks the element duration until the user changes it); `combo` is mutually exclusive with `in` and `out`; `in.duration + out.duration ≤ element duration`; durations are frame-aligned, 0.1 s to the smaller of 5 s and the element duration for `in`/`out` and up to the element duration for `combo`; `strength` 0–100 (default 100). `type` resolves to `keyframe-animation/catalog.md`. Text elements and caption styles use `textAnimation` and never `clipAnimation`. There are no `fadeIn`/`fadeOut` fields on the picture of any element: a visual fade is a clip animation. Behaviour is owned by `visual-effects-filters.Motion blur` and `keyframe-animation.Clip animation model`. [NEW] [CAPCUT CC-087, CC-088, CC-089, CC-090, CC-098]

#### Scenario: Combo excludes in
- **WHEN** a writer stores `clipAnimation` with both `in` and `combo`
- **THEN** validation fails with `document/field-not-allowed`

#### Scenario: Combo follows the duration
- **WHEN** a clip with `clipAnimation.combo.followsDuration = true` is trimmed from 4 s to 3 s
- **THEN** the same command sets `clipAnimation.combo.duration` to 360 000

#### Scenario: Clip animation on text
- **WHEN** a text element carries `clipAnimation`
- **THEN** validation fails with `document/field-not-allowed`

### Requirement: Mask fields
A `masks[]` entry SHALL be `{id, type, enabled, combine, params, tracking?}` (`catalog.md` §7.5) with `type` one of `split`, `mirror`, `cinematic-bars`, `rectangle`, `ellipse`, `heart`, `diamond`, `star`, `text`, `freeform`; `enabled` (default true); `combine` one of `add`, `subtract`, `intersect`, `exclude` (default `add`); at most 8 per element. All shape values live in `params`, under the classic names: base keys `feather` (0–1000), `inverted`, `opacity` (0–100, default 100), `strokeWidth` (0–100), `strokeColor`, `strokeAlign`; position keys `centerX`, `centerY` (fractions of the element size from its centre, −1…1) and `rotation` (0–360) on every type; `width`, `height` (≥ 0.01) on box-like types and cinematic bars; `scale` (0.01–5) on every type except `split` and `mirror`; `cornerRadius` on rectangle; `points` (3–12) and `innerRatio` (0.1–0.95) on star; `size` (0.01–5) on mirror; the eight text keys on text masks; `path` and `closed` on freeform. A `params` key that the mask type does not declare is `document/field-not-allowed`. Animation paths are `masks.<maskId>.params.<key>`, matching the stored location. A freeform `path` is a list of at most 256 points `{id, x, y, inX, inY, outX, outY}` — anchor plus incoming and outgoing tangent handles relative to the anchor, in the mask's local space — and an open path (`closed: false`) does not affect rendering. A path channel (`masks.<maskId>.params.path`) holds whole-path keys whose point ids equal the mask's point ids. Behaviour is owned by `masks-blending-keying`; compositing by `render-engine.Multi-mask compositing with feather`. [NEW] [PORT K-001, K-002, K-003, K-004, K-005, K-006, K-007, K-008, K-009, K-010, K-011, K-012, K-013, K-021, N-016] [CAPCUT CC-136, CC-141, CC-142, CC-144, CC-145, CC-147]

#### Scenario: New rectangle mask
- **WHEN** a rectangle mask is added
- **THEN** it stores `{id, type: "rectangle", enabled: true, combine: "add", params: {feather: 0, inverted: false, opacity: 100, strokeWidth: 0, strokeColor: "#ffffff", strokeAlign: "center", centerX: 0, centerY: 0, width: 0.6, height: 0.6, rotation: 0, scale: 1, cornerRadius: 0}}`

#### Scenario: Path key with a foreign point
- **WHEN** a path keyframe lists a point id that the mask's `params.path` does not contain
- **THEN** validation fails with `document/animation-channel-invalid`

#### Scenario: Ninth mask
- **WHEN** an element with 8 masks receives a ninth
- **THEN** the command fails with `document/masks-limit`

#### Scenario: Star key on a rectangle
- **WHEN** a rectangle mask's `params` holds `innerRatio`
- **THEN** validation fails with `document/field-not-allowed`

### Requirement: Chroma key and cutout fields
Video and image elements SHALL be able to carry `chromaKey {enabled, color, strength (40), edge (10), shadow (0), spill (50)}` (numbers 0–100, animatable; `color` `#rrggbb`, default `#00ff00`) and `cutout {mode, matteAssetId?, inverted, feather, shift, stroke, background}`: `mode` `none`, `auto` or `custom`; `matteAssetId` a derived asset of role `matte`; `inverted` (default false); `feather` 0–100 reference-canvas px (default 2); `shift` −50…+50 px (default 0); `stroke {style: "none" | "solid" | "dashed" | "glow" | "offset-shadow", width 0–100 (8), color, offset 0–100 (0), opacity 0–100 (100)}` with `width`, `color`, `offset`, `opacity` animatable; `background {kind: "none" | "color" | "blur" | "media", color?, blurIntensity? 0–100 (50), mediaId?}`. The discriminator of the cutout background is `kind`, like every union introduced at schema 32. `matteAssetId` is written by a non-history update when the matte job completes (it produces a state patch and no undo step); a `cutout` with `mode` other than `none` and no `matteAssetId` is valid and renders uncut. Behaviour is owned by `masks-blending-keying.Chroma key`, `masks-blending-keying.Cutout model and auto cutout`, `masks-blending-keying.Cutout stroke` and `masks-blending-keying.Replace background after cutout`; matte generation by `ai-editing-tools`. Turning the cutout off sets `mode: "none"`, keeps `matteAssetId` and writes `disabled_ms` (the time it was turned off); turning it on again within 30 days removes `disabled_ms` and reuses the matte. On project load and once per day while the project is open, a cutout whose `disabled_ms` is more than 30 days old loses `matteAssetId` and `disabled_ms` by a non-history update and the matte asset is removed when nothing else references it; this is the stored timestamp that `masks-blending-keying.Cutout model and auto cutout` relies on for its 30-day rule. `disabled_ms` MUST be absent while `mode` is not `none`. [NEW] [CAPCUT CC-152, CC-153, CC-154, CC-157, CC-158]

#### Scenario: Auto cutout requested
- **WHEN** "Auto cutout" is pressed
- **THEN** the element stores `cutout = {mode: "auto", inverted: false, feather: 2, shift: 0, stroke: {style: "none", width: 8, color: "#ffffff", offset: 0, opacity: 100}, background: {kind: "none"}}` with no `matteAssetId` until the job completes

#### Scenario: Matte arrives
- **WHEN** the matte job finishes with asset `m7`
- **THEN** one state patch adds `cutout.matteAssetId = "m7"` and the undo stack length is unchanged

#### Scenario: Media background without an asset
- **WHEN** `cutout.background` is `{kind: "media"}` with no `mediaId`
- **THEN** validation fails with `document/missing-field`

#### Scenario: Matte kept for 30 days after turning cutout off
- **WHEN** an auto cutout with matte `m1` is turned off at time T
- **THEN** the element has `cutout.mode = "none"`, `cutout.matteAssetId = "m1"` and `cutout.disabled_ms = T`
- **AND** when the project is loaded at T + 31 days the two keys are removed by a non-history update and asset `m1` is removed when no other element references it

### Requirement: Analysis-driven settings
Video elements SHALL be able to carry `stabilization {enabled, level: "min-crop" | "recommended" | "max-stable"}` and `deflicker {enabled, strength 0–100 (50)}`. Video and image elements SHALL be able to carry `eyeContact {enabled, strength 0–100 (70)}`, `relight {enabled, presetId?, azimuth −180…180, elevation −90…90, intensity 0–100 (50), temperature 2 000–10 000 K (5 500), ambient −100…100 (0), scope: "face" | "subject" | "frame"}`, `retouch {enabled, applyToAll, autoStyle?, faces, body}` and `aiMotion {style, intensity, keyIds[]}` (`catalog.md` §7.7). `retouch.faces` is a map whose keys are `all` and up to 5 stable face ids; each value holds the 8 retouch keys (`smoothSkin`, `brightenSkin`, `darkCircles`, `smileLines`, `whitenTeeth`, `blemishes`, `brightenEyes` 0–100; `skinTone` −50…+50), `reshape` (11 keys, −100…100: `slimFace`, `jawWidth`, `chinLength`, `cheekbones`, `foreheadHeight`, `eyeSize`, `eyeDistance`, `noseWidth`, `noseLength`, `mouthSize`, `lipThickness`) and `makeup {look?, intensity (60), layers}`; `retouch.body` holds 9 keys (−100…100: `slimBody`, `waist`, `hips`, `legLength`, `legWidth`, `shoulderWidth`, `armWidth`, `headSize`, `neckLength`). The numeric retouch, reshape, body and relight values are animatable on the paths of `project-document.Animatable property paths`; makeup, `scope`, `level`, deflicker and eye-contact values are static. `aiMotion.keyIds` lists the ids of the keyframes that `ai-editing-tools.AI movement` wrote, so that re-applying a style replaces exactly those keys and no key authored by the user. The per-frame analysis tracks (stabilisation, deflicker gains, face mesh, depth, body pose) are derived caches keyed by content hash and are not in the document. Behaviour is owned by `ai-editing-tools`. `autoReframe {aspect, keyIds[]}` on video, image and compound elements records the target aspect and the ids of the keyframes that `ai-editing-tools.Auto reframe` wrote, with the same replace-only-your-own-keys rule as `aiMotion`; a user edit or deletion of one of those keys removes its id from the list in the same command. Face identities are stable: the keys of `retouch.faces` other than `all` are ids listed in the asset's `faces[] {id, firstSeen}` (`project-document.Media asset records`); a face id that the asset does not list is `document/unknown-reference` with severity `warning`, and its settings are kept and not applied. [NEW] [CAPCUT CC-097, CC-161, CC-163, CC-164, CC-165, CC-166, CC-167, CC-168, CC-169, CC-170]

#### Scenario: Retouch all faces
- **WHEN** "Smooth skin" is set to 40 with "Apply to all faces" on
- **THEN** the element stores `retouch = {enabled: true, applyToAll: true, faces: {all: {smoothSkin: 40, …}}, body: {…}}`

#### Scenario: Keyframed relight
- **WHEN** relight intensity is keyframed
- **THEN** the channel is stored under `relight.intensity`

#### Scenario: Re-applying AI movement
- **WHEN** "Zoom in" was applied (writing keys `k1`, `k2`), the user adds key `k3` by hand, and "Push" is applied
- **THEN** keys `k1` and `k2` are removed, `k3` is kept, and `aiMotion` is `{style: "push", intensity, keyIds: [<new ids>]}`

#### Scenario: Seventh face entry
- **WHEN** `retouch.faces` holds `all` plus six face ids
- **THEN** validation fails with `document/out-of-range`

#### Scenario: Re-running auto reframe keeps the user's keys
- **WHEN** Auto reframe wrote position keys `r1`, `r2`, the user added key `u1` on the same path, and Auto reframe runs again for 9:16
- **THEN** `r1` and `r2` are removed, `u1` is kept, and `autoReframe` is `{aspect: {numerator: 9, denominator: 16}, keyIds: [<new ids>]}`

#### Scenario: Face ids survive a rebuilt analysis cache
- **WHEN** the face-mesh cache of an asset with `faces = [{id: "f1", firstSeen: 0}]` is deleted and rebuilt
- **THEN** the detected face that overlaps the stored one at `firstSeen` is again `f1`, and `retouch.faces.f1` still applies to the same person

### Requirement: Colour adjustments
`adjustments` SHALL be an object with up to five sections, each with `enabled` (default true): `lut {lutId?, intensity 0–100 (100)}`; `basic` with the 17 integer keys `exposure`, `brightness`, `contrast`, `saturation`, `vibrance`, `highlights`, `shadows`, `whites`, `blacks`, `temperature`, `tint`, `clarity`, `vignette` (−100…100), `hue` (−180…180), `sharpness`, `fade`, `grain` (0–100), plus optional `autoStrength`; `wheels {shadows, midtones, highlights}` each `{x, y, luminance}` with `x² + y² ≤ 1` and `luminance` −100…100; `curves {master, red, green, blue}` each a list of 2–16 points `{x, y}` in 0…1 with strictly increasing `x` (default `[{0,0},{1,1}]`); `hsl` with the eight bands `red`, `orange`, `yellow`, `green`, `aqua`, `blue`, `purple`, `magenta`, each `{hue, saturation, lightness}` (−100…100). An absent `adjustments` object or section means identity. `lutId` is `bundled:<catalogue id>` (resolved against `color-adjustment/catalog.md`) or `user:<sha256>` (resolved against `media.luts[]`). Animatable: every basic key, every HSL value (path `adjustments.hsl.<band>.<hue|saturation|lightness>`), the nine wheel values and `adjustments.lut.intensity`; curve points, `lutId` and `enabled` are static. Behaviour is owned by `color-adjustment`; order of application by `render-engine.Colour adjustment pipeline order`. [NEW] [PORT N-002] [CAPCUT CC-117, CC-127, CC-128, CC-129, CC-130]

#### Scenario: One slider
- **WHEN** Exposure is set to 50 on a clip with no adjustments
- **THEN** the element stores `adjustments = {basic: {enabled: true, exposure: 50, …every other basic key 0}}` and no other section

#### Scenario: HSL path uses stored keys
- **WHEN** the blue band's lightness is keyframed
- **THEN** the channel is stored under `adjustments.hsl.blue.lightness`

#### Scenario: Missing user LUT record
- **WHEN** `adjustments.lut.lutId = "user:<h>"` and `media.luts` has no entry with that id
- **THEN** validation reports `document/unknown-reference` as a warning, the section renders as identity, and the picker shows "Missing LUT"

### Requirement: Retime and speed-curve fields
Video, audio and compound elements SHALL be able to carry `retime {rate, maintainPitch, reverse, smooth, curve?}`: `rate` 0.1–100 (step 0.01; a value 0.01–0.1 migrated from classic is valid as stored); `maintainPitch` boolean; `reverse` boolean, the ONLY place a reversed state is stored; `smooth` one of `none`, `blend`, `flow`; `curve {preset, points[]}` with `preset` one of `custom`, `montage`, `hero`, `bullet`, `jump-cut`, `flash-in`, `flash-out` and `points` a list of 2–32 `{u, rate}` entries with `u` strictly increasing from exactly 0 to exactly 1 and `rate` 0.1–10. With a curve, `rate` stores the average rate (`visible source span / duration`) for display. No retime value is animatable through the animation store: speed change over time is expressed only by `curve`. An absent `retime` means rate 1, forward, pitch unchanged, no smoothing. Compound elements accept `rate`, `maintainPitch` and `reverse` only. Behaviour and the time map are owned by `speed-retime`. [NEW] [PORT SP-001, SP-004, N-014] [CAPCUT CC-073, CC-074, CC-081, CC-039]

#### Scenario: Reverse only
- **WHEN** a clip at rate 1 is reversed
- **THEN** it stores `retime = {rate: 1, maintainPitch: false, reverse: true, smooth: "none"}` and no top-level `reverse` key

#### Scenario: Curve end points
- **WHEN** a writer stores a curve whose last point has `u = 0.9`
- **THEN** validation fails with `document/out-of-range`

#### Scenario: Thirty-third point
- **WHEN** a velocity effect would produce 33 points
- **THEN** the owner reduces it to 32 before writing, and a direct write of 33 fails with `document/limit-exceeded`

### Requirement: Freeze field
A freeze element SHALL be a `video` element with `freeze {mediaId, sourceTime}` or a `compound` element with `freeze {sourceTime}`: `sourceTime` is an integer tick in the source (it need not be frame-aligned to the project grid) and, for a video, lies in `[0, asset duration)`. A freeze element has `trimStart = trimEnd = 0`, no `sourceDuration`, no `retime`, contributes no audio (its audio fields are absent), and its `duration` is 1 frame to 6 h. It renders from the original media or scene; no still image asset is created. Behaviour is owned by `speed-retime.Freeze frame`. [NEW] [CAPCUT CC-040]

#### Scenario: Compound freeze
- **WHEN** a compound clip is frozen at its source time 1 s
- **THEN** the inserted element is `type: "compound"` with the same `sceneId` and `freeze = {sourceTime: 120000}`

#### Scenario: Source time beyond the asset
- **WHEN** `freeze.sourceTime` equals the asset's `duration`
- **THEN** validation fails with `document/time-out-of-bounds`

### Requirement: Element audio level fields
Audio elements and video and compound elements SHALL carry `volume` (dB, −60…+20, stored to 0.01, default 0, −60 = silence, animatable), `muted` (default false), `pan` (integer −100…+100, default 0, animatable), `fadeIn {duration, shape}` and `fadeOut {duration, shape}` (duration frame-aligned ticks, default 0, `fadeIn.duration + fadeOut.duration ≤ element duration`; `shape` one of `linear`, `equal-power`, `s-curve`, `logarithmic`, `exponential`, default `equal-power`), `isVoice` (default false; true for voiceover takes and text-to-speech clips) and, on video and compound elements, `isSourceAudioEnabled` (default true). Fades exist only on the sound of an element. An end of an element that carries a crossfade record or a paired transition crossfade has a fade duration of 0 at that end. Behaviour is owned by `audio-editing`. [NEW] [PORT AU-002, AU-003, AU-004, A-002, N-004] [CAPCUT CC-211, CC-212, CC-213, CC-214]

#### Scenario: Volume precision
- **WHEN** a gesture produces a volume of −3.14159 dB
- **THEN** the stored value is −3.14

#### Scenario: Fades longer than the clip
- **WHEN** a 2 s clip stores `fadeIn.duration = 180000` and `fadeOut.duration = 120000`
- **THEN** validation fails with `document/out-of-range`

#### Scenario: Fade under a crossfade
- **WHEN** a crossfade record exists at the end of an audio clip that has `fadeOut.duration = 60000`
- **THEN** validation fails with `document/out-of-range` at `fadeOut.duration`

### Requirement: Audio processing fields
Audio-capable elements SHALL be able to carry: `noiseReduction {enabled, strength 0–100 (50)}`; `enhanceVoice {enabled, strength 0–100 (50)}`; `vocalIsolation {mode: "off" | "keep-vocals" | "remove-vocals", vocalsAssetId?, accompanimentAssetId?}`; `voiceEffect {type, intensity 0–100 (100)}` with `type` one of `none`, `deep`, `high`, `chipmunk`, `giant`, `robot`, `echo`, `hall`, `telephone`, `megaphone`, `vinyl`, `synth`, `electronic`, `tremble`, `underwater`; `pitch {semitones −12…+12, cents −100…+100}`; `normalize {enabled, target −30…−5 LUFS (−14), gainDb, measuredLufs?}`; `eq {enabled, preset, bands {low, lowMid, mid, highMid, high}}` with `preset` one of `flat`, `voice-clarity`, `bass-boost`, `treble-boost`, `warm`, `radio`, `custom` and bands −12…+12 dB in 0.5 steps (a `preset` other than `custom` MUST carry that preset's band values); and `compressor {enabled, threshold −60…0 (−18), ratio 1–20 (3), attack 1–200 ms (10), release 10–1000 ms (120), makeup 0–24 dB (0)}`. None of these is animatable. `normalize.gainDb`, `normalize.measuredLufs` and the two stem asset ids are written by non-history updates when the measuring or separation job completes. Derived audio is a cache and is not referenced from the document except for the stem assets. Behaviour and DSP are owned by `audio-editing`; stem separation by `ai-editing-tools.Stem separation`. [NEW] [CAPCUT CC-086, CC-215, CC-216, CC-217, CC-219, CC-224]

#### Scenario: Pitch with cents
- **WHEN** pitch is set to +3 semitones and −20 cents
- **THEN** the element stores `pitch = {semitones: 3, cents: -20}`

#### Scenario: Preset bands
- **WHEN** the "Bass boost" preset is chosen
- **THEN** `eq = {enabled: true, preset: "bass-boost", bands: {low: 6, lowMid: 2, mid: 0, highMid: 0, high: 0}}`

#### Scenario: Edited preset becomes custom
- **WHEN** the user then moves the 3 kHz band to +1
- **THEN** `eq.preset` becomes `"custom"` in the same command; a write that keeps `"bass-boost"` with the changed band fails with `document/out-of-range`

#### Scenario: Unknown voice effect
- **WHEN** a schema-32 writer stores `voiceEffect.type = "alien"`
- **THEN** validation fails with `document/wrong-type`

### Requirement: Beat markers field
Audio-capable elements SHALL be able to carry `beats`, a strictly increasing array of at most 2 000 integer tick positions in SOURCE time (not frame-aligned), so a marker stays on the same sound through move, trim, split and retime. Split copies the full list to both halves; only beats inside an element's visible source span are shown and used. Beats are plain numbers without ids and are addressed by value in commands and by index in state patches. Behaviour is owned by `audio-editing.Beat markers on audio`. [NEW] [CAPCUT CC-220, CC-221]

#### Scenario: Tap a beat
- **WHEN** a beat is added at source time 1.5 s to a clip with beats at 1 s and 2 s
- **THEN** `beats = [120000, 180000, 240000]`

#### Scenario: Duplicate beat
- **WHEN** a writer stores `beats = [120000, 120000]`
- **THEN** validation fails with `document/elements-unsorted`

### Requirement: Animation store
An element's keyframes SHALL be stored in ONE store named `animations`: a map from property path to channel. There is no `keyframes` field, no `bindings` or `channels` sub-map, and no second store on effects, masks or tracks. A path is the dotted path of the STORED field relative to the element (`transform.position.x`, `opacity`, `adjustments.hsl.blue.lightness`); where the stored location passes through an id-keyed collection, the segment after the collection name is the entry's id (`effects.<effectId>.params.<key>`, `masks.<maskId>.params.<key>`, `retouch.faces.<faceKey>.<key>`), never an array index. A path SHALL resolve to an existing animatable field of that element (`project-document.Animatable property paths`); otherwise it is `document/animation-path-invalid`. A channel with zero keys is not stored: removing the last key removes the path, and an `animations` map with no path is removed from the element. The static field keeps a value at all times: while a channel exists the static value is the value shown when keyframes are disabled and the value written back by `keyframe-animation.Removing the last keyframe`. An element holds at most 256 animated paths. Behaviour is owned by `keyframe-animation.Keyframe data model`. [NEW] [PORT A-001, A-002, A-003, A-004, A-005, A-016] [CAPCUT CC-091, CC-092]

#### Scenario: Path equals the stored location
- **WHEN** horizontal position is keyframed
- **THEN** `animations` has the key `transform.position.x`, and no key `transform.positionX`

#### Scenario: Path to a missing effect
- **WHEN** `animations` holds `effects.e9.params.intensity` and the element has no effect `e9`
- **THEN** validation fails with `document/animation-path-invalid`

#### Scenario: Last key removed
- **WHEN** the only key of `opacity` is deleted
- **THEN** the `opacity` path is removed and, as it was the only path, the `animations` key is removed from the element

### Requirement: Channel and keyframe shapes
A channel SHALL have one of four shapes, fixed by its path (`catalog.md` §11.1). **Scalar**: `{keys[], extrapolation?}` with keys `{id, time, value, segmentToNext, tangentMode, leftHandle?, rightHandle?}`; `time` is integer ticks relative to the element start, frame-aligned, `0 ≤ time ≤ duration`; `segmentToNext` is `step`, `linear` or `bezier` (the stored word is `step`; UI and tools say "hold", and tools accept `hold` as an alias on input); `tangentMode` is `auto`, `aligned`, `broken` or `flat`; handles are `{dt, dv}` offsets from the key with `leftHandle.dt ≤ 0 ≤ rightHandle.dt`, and a handle never extends past the neighbouring key in time; `extrapolation {before, after}` each `hold` (default) or `linear`. **Discrete** (boolean and string values): `{keys[] {id, time, value}}`, always held. **Colour**: `{r, g, b, a}`, four scalar channels of linear-light components 0–1 with identical key ids and times and one shared segment type per segment; the static field and the UI use hex strings. **Path** (freeform mask path): `{keys[] {id, time, value {points[]}, segmentToNext, easing [x1, y1, x2, y2]}}`, interpolated per point id and component. Keys are sorted by `time` with at most one key per tick and at most 1 000 per channel. A key value SHALL be inside the field's range, except on `transform.scale.x` / `.y`, where −100…−0.01 is also valid for keys migrated from classic. New keys are created with `segmentToNext: "linear"` and `tangentMode: "auto"`. Evaluation is owned by `keyframe-animation.Interpolation types` and `keyframe-animation.Colour interpolation in linear RGB`. [NEW] [PORT A-006, A-007, A-018]

#### Scenario: Scalar key
- **WHEN** a key is added to `opacity` at 1 s with value 0.5
- **THEN** the channel holds `{id, time: 120000, value: 0.5, segmentToNext: "linear", tangentMode: "auto"}`

#### Scenario: Colour channel components stay aligned
- **WHEN** a colour key is added at 2 s to a text `color` channel
- **THEN** each of `r`, `g`, `b`, `a` gains a key at tick 240 000 with the same id

#### Scenario: Misaligned colour components
- **WHEN** the `r` component has 3 keys and `g` has 2
- **THEN** validation fails with `document/animation-channel-invalid`

#### Scenario: Key after the element end
- **WHEN** a 2 s element has a key at tick 300 000
- **THEN** validation fails with `document/animation-channel-invalid`

#### Scenario: Tool input alias
- **WHEN** an agent tool sets a segment to `hold`
- **THEN** the stored `segmentToNext` is `"step"`

### Requirement: Animatable property paths
The animatable paths at schema 32 SHALL be exactly the rows of `catalog.md` §11.2, in nine groups that also define lane order: (1) `transform.position.x`, `transform.position.y`, `transform.scale.x`, `transform.scale.y`, `transform.rotation`, `opacity`; (2) `volume`, `pan`; (3) text — `color`, `fontSize`, `letterSpacing`, `lineHeight`, `fill.gradientColor`, `fill.gradientAngle`, `box.width`, `curve`, `background.color`, `background.cornerRadius`, `background.paddingX`, `background.paddingY`, `background.offsetX`, `background.offsetY`, `stroke.color`, `stroke.width`, `shadow.color`, `shadow.opacity`, `shadow.blur`, `shadow.distance`, `shadow.angle`, `glow.color`, `glow.intensity`, `glow.radius`, `bubble.color`; (4) graphic `params.<key>`; (5) `effects.<effectId>.params.<key>` and `motionBlur.strength`; (6) `masks.<maskId>.params.<key>` including `params.path`; (7) `adjustments.basic.<key>`, `adjustments.hsl.<band>.<hue|saturation|lightness>`, `adjustments.wheels.<wheel>.<x|y|luminance>`, `adjustments.lut.intensity`; (8) `chromaKey.<strength|edge|shadow|spill>`, `cutout.stroke.<width|color|offset|opacity>`, `crop.<left|top|right|bottom>`; (9) `retouch.faces.<faceKey>.<key>`, `retouch.faces.<faceKey>.reshape.<key>`, `retouch.body.<key>`, `relight.<azimuth|elevation|intensity|temperature|ambient>`. Every other field is static. `transform.scale.x` and `transform.scale.y` are presented as one grouped property labelled `transform.scale` (one toggle, one diamond, one lane) while stored as two channels: a key written through the grouped property is written to both channels at the same tick with the same segment type, and the two channels are allowed to hold different values. An upsert on a path outside the table, or on a path the element type does not carry, is rejected with `document/animation-path-invalid`. `keyframe-animation.Animatable property paths` owns the UI and lane presentation and cites this table. [NEW] [PORT A-001, A-002, A-003, A-004, A-005, G-017, E-009] [CAPCUT CC-091, CC-092, CC-147, CC-182]

#### Scenario: Grouped scale
- **WHEN** the scale keyframe toggle is pressed at 1 s on an element at scale 1.5 × 1.5
- **THEN** both `transform.scale.x` and `transform.scale.y` gain a key at tick 120 000 with value 1.5

#### Scenario: Static field
- **WHEN** a tool tries to keyframe `blendMode`
- **THEN** the tool fails with `document/animation-path-invalid` and nothing changes

#### Scenario: Path not carried by the type
- **WHEN** a tool keyframes `volume` on an image element
- **THEN** the tool fails with `document/animation-path-invalid`

### Requirement: Media asset records
The document SHALL contain `media {assets[], folders[], luts[]}` (`catalog.md` §12). An asset record is `{id, name, type, kind, size, lastModified_ms?, contentHash, width?, height?, duration?, fps?, hasAudio?, videoCodec?, audioCodec?, container?, rotation, folderId, tags[], ephemeral, provenance, derived?, motionTracks[], faces[], created_ms}`: `type` is `image`, `video` or `audio`; `kind` is `null`, `slate` (a placeholder still, always `type: "image"`) or `derived` (a tool output hidden from the library, with `derived {role: "matte" | "stem-vocals" | "stem-accompaniment", sourceAssetId, sourceStart?, sourceEnd?}`); `contentHash` is the SHA-256 of the original bytes or `null` until the first hash completes; `duration` is in ticks and `fps` a Rational; `motionTracks[] {id, name, shape, sourceStart, sourceEnd, dataHash}` lists the motion tracks of `ai-editing-tools.Motion tracking` for that asset. Every `mediaId`, `freeze.mediaId`, `matteAssetId`, stem asset id, `cover.mediaId`, background `mediaId` and `processedSource.originalMediaId` in the document SHALL resolve to an asset record of the right `type` and `kind` (`document/unknown-asset`, `document/asset-type-mismatch`). Removing an asset is a command that removes or rewrites every reference in the same undo step (`media-library.Remove assets with cascade`). Probe metadata is written by non-history updates. The asset model's behaviour is owned by `media-library.Media asset model`. `faces[] {id, firstSeen}` (video and image assets, at most 32) lists the stable face identities of the asset: the first face analysis writes them by a non-history update, subsequent analyses only append, and a rebuilt analysis cache MUST match each detected face to an existing entry (greatest bounding-box overlap at `firstSeen`, at least 0.5 intersection-over-union) and reuse its id before creating a new one. [NEW] [PORT M-025, ST-003] [CAPCUT CC-020]

#### Scenario: Imported video
- **WHEN** a 1920 × 1080, 29.97 fps, 10 s clip is imported
- **THEN** its record has `type: "video"`, `kind: null`, `width: 1920`, `height: 1080`, `fps: {numerator: 30000, denominator: 1001}`, `duration: 1200000`, `provenance: {source: "imported", originalFileName}`, `tags: []`, `motionTracks: []`

#### Scenario: Dangling media reference
- **WHEN** a video element's `mediaId` names no asset
- **THEN** a writer's change fails with `document/unknown-asset`

#### Scenario: Derived asset is hidden but resolvable
- **WHEN** a matte asset with `kind: "derived"` exists
- **THEN** the library does not list it, `cutout.matteAssetId` resolves to it, and it is carried by packages and sync

### Requirement: Asset provenance
Every asset SHALL carry `provenance {source, …}` with `source` one of `imported`, `recorded`, `url`, `stock`, `ai`, `bundled`, `connector`, `device`, `slate`, `derived`, and the keys of its source (`catalog.md` §12.5): `url {url}`; `connector {connector, remoteId}`; `device {deviceId}`; `stock` and `bundled {provider, itemId, author, licence, licenceUrl, sourceUrl, attributionRequired}`; `ai {provider, model, role, prompt, negativePrompt?, seed?, referenceAssetIds[], jobId, cost?, created_ms}`; `slate {scriptId, sceneId, shotId?, versionId}`; `derived {tool}`. A sound added from the sounds library carries `author`, `licence`, `sourceUrl` and `attributionRequired` on its asset — this is the attribution record of `audio-editing.Add a library sound to the timeline`; there is no separate attribution list. `source: "ai"` is the AI-generated label data: `export-share.Provenance metadata` and the visible AI label read it, and it MUST be preserved by duplicate, package export/import, cross-project paste and sync. `prompt` is at most 20 000 characters. A `provenance` MUST NOT contain a provider key, a token or a signed URL (`document/field-not-allowed` for the keys `apiKey`, `token`, `authorization`, `signature`). Behaviour is owned by `media-library.AI-generated asset provenance`, `media-library.Stock and provider-sourced media`, `media-library.Slate media` and `generation-providers.Generated outputs become media assets`. [NEW] [CAPCUT CC-019, CC-020]

#### Scenario: Generated image
- **WHEN** an image is generated with a routed model
- **THEN** its asset has `provenance = {source: "ai", provider, model, role: "image", prompt, referenceAssetIds: [], jobId, created_ms}`

#### Scenario: Provenance survives a package round trip
- **WHEN** a project with one AI-generated and one stock asset is exported as a package and imported on another device
- **THEN** both asset records have byte-identical `provenance` values

#### Scenario: Secret in provenance
- **WHEN** a writer stores `provenance.apiKey`
- **THEN** validation fails with `document/field-not-allowed`

### Requirement: Library folders and LUT records
`media.folders[]` SHALL hold the project's library folders `{id, name, parentId, kind}`: nesting at most 4 levels; sibling names unique case-insensitively, 1–80 characters; `kind` is `user`, `ai-generated` or `slates`, with at most one folder of each automatic kind, created by the first asset that needs it; an asset's `folderId` resolves to a folder or is `null` (the root). `media.luts[]` SHALL hold a record `{id: "user:<sha256>", name, format: "cube" | "3dl", size, sha256}` for every user LUT the project references; the LUT bytes are a project blob addressed by `sha256` and travel with packages and sync. Bundled LUTs are referenced as `bundled:<id>` and have no record. Folder and LUT changes are ordinary commands and produce ordinary state patches. Deleting a folder moves its assets to the parent in the same command. Behaviour is owned by `media-library.Library folders` and `color-adjustment.LUT import`. [NEW] [PORT N-009] [CAPCUT CC-130]

#### Scenario: Automatic folder
- **WHEN** the first AI-generated asset enters a project
- **THEN** `media.folders` gains `{id, name: "AI generated", parentId: null, kind: "ai-generated"}` and the asset's `folderId` is that id

#### Scenario: Fifth level
- **WHEN** a folder is created inside a folder at level 4
- **THEN** the command fails with `document/limit-exceeded`

#### Scenario: Folder deleted
- **WHEN** a folder holding three assets is deleted
- **THEN** the three assets' `folderId` become the deleted folder's `parentId` in the same undo step

### Requirement: Per-project files and rebuildable index
Everything needed to reopen a project SHALL be in that project's own record, so that the desktop library index is purely derived (review finding R2-C3-06). On desktop the file `<projectId>/project.json` holds the canonical document — including `media.assets`, `media.folders`, `media.luts`, provenance, tags and the template state — plus the `local` section with, per asset, `storage`, `externalPath`, `externalSize`, `externalMtime_ms`, `canDecode`, `needsProbe` and `proxy`, and the project's `folderId` and `trash` state. `library.sqlite` SHALL hold ONLY data derivable from the project directories and the library-wide files: the project list (id, name, duration, modified time, folder id, trash state, cover hash, schema versions), per-project asset rows copied from `project.json`, content-hash reference counts, and search indexes. Data that belongs to no single project lives in library-wide files owned by `project-storage` and written atomically like `project.json`: the project-folder tree, scripts, saved sounds, the user LUT library, brand kits and saved styles. External-file grants are re-created on rebuild for each `local.media[…].externalPath` of a project inside the user's own library after re-validating size and modified time; a path that fails validation is offline with "Relink…". There is no separate `media-metadata` store on any platform at schema 32: on web and mobile the `projects` store record has the same shape (canonical document plus `local`). `project-storage.Desktop project library folder` and `project-storage.Stored record layout` own the file mechanics and cite this split. [NEW] [PORT ST-001, ST-003]

#### Scenario: Index rebuilt
- **WHEN** `library.sqlite` is deleted and the app starts
- **THEN** after the rebuild every project lists the same name, folder and trash state as before, every asset has its name, probe data, tags, folder and provenance, and every linked external file whose size and modified time match is online

#### Scenario: Project directory copied in
- **WHEN** the user copies a project directory from another library into the library folder
- **THEN** after the scan the project opens with all its asset records and its managed media, and external assets whose paths do not exist are offline with "Relink…"

#### Scenario: No asset record outside the project file
- **WHEN** a media asset is renamed
- **THEN** the change is in `project.json` (`media.assets[…].name`), produces one state patch, and the SQLite row is updated from it

### Requirement: Classic v31 mapping
The target of the v31→v32 migration SHALL be a document that passes `project-document.Document validator` in strict mode, and the conversion SHALL be exactly the tables of `catalog.md` §13 (project and settings §13.1, element common fields §13.2, visual `params` keys §13.3, per-type `params` keys §13.4, masks and animations §13.5, media metadata §13.6). In particular: the classic flat `element.params` map is converted key by key into typed fields — `transform.positionX` / `positionY` → `transform.position.x` / `.y`, `transform.scaleX` / `scaleY` → `transform.scale.x` / `.y`, `transform.rotate` → `transform.rotation`, `opacity`, `blendMode`, `volume`, `muted`, and the text keys `content`, `fontFamily`, `fontSize`, `color`, `textAlign`, `fontWeight` (string → number), `fontStyle`, `textDecoration` (→ `underline` / `strikethrough`), `letterSpacing`, `lineHeight`, `background.*` — reading `params` first, then the stale pre-v29 top-level copy, then the default; the `params` map is then removed from every element except graphics, where it keeps only the definition's keys. A classic effect element `{type: "effect", effectType, params}` becomes an effect element with `effects: [{id: new, type: effectType, kind: "effect", enabled: true, params}]`, and its animation paths `params.<key>` become `effects.<newId>.params.<key>`. Every clip effect entry gains `kind: "effect"`. A negative static scale becomes its absolute value plus `flip`; an all-negative scale channel is negated and flagged; a mixed-sign channel is kept. Classic animation paths are renamed to the schema-32 paths; the leftover `animations.bindings` and `animations.channels` are removed. Classic `bookmarks` become `markers` with new ids. Media metadata records become `media.assets[]` plus `local.media`. `currentSceneId` and `timelineViewState` move under `local`. Tracks gain `locked`, `pinned`, `transitions: []` and, by type, `solo`, `volume`, `pan`, `ducking`. `project-storage.Schema 32 migration` owns the mechanics (runner, backup, fixtures) and implements this mapping; where its text differs, this mapping is the target shape. Blur values are rescaled for the changed resolution rule: on a project canvas that is not 16:9 landscape, the blur background `blurIntensity` and every classic `blur` effect `intensity` (static and keyframed) are multiplied by the classic-canvas factor `k` of `catalog.md` §13.1, so that a migrated project keeps the blur strength it had (review finding R2-C5-35). [NEW] [PORT ST-006, T-003, A-001, B-001, E-004, K-021]

#### Scenario: Flat params become typed fields
- **WHEN** a v31 video element has `params = {"transform.positionX": 40, "transform.scaleX": 1.2, "transform.scaleY": 1.2, "transform.rotate": 15, "opacity": 0.8, "blendMode": "screen", "volume": -6, "muted": false}`
- **THEN** after migration it has `transform = {position: {x: 40, y: 0}, scale: {x: 1.2, y: 1.2}, rotation: 15}`, `opacity: 0.8`, `blendMode: "screen"`, `volume: -6`, `muted: false`, and no `params` key

#### Scenario: Classic effect element
- **WHEN** a v31 project holds `{type: "effect", effectType: "blur", params: {intensity: 30}}` with an animation on `params.intensity`
- **THEN** after migration the element has `effects: [{id: E, type: "blur", kind: "effect", enabled: true, params: {intensity: 30}}]`, `target: "beneath"`, no `effectType`, no `params`, the animation path `effects.E.params.intensity`, it validates, and it renders within the golden tolerance of the v31 rendering

#### Scenario: Stale top-level copy loses to params
- **WHEN** a v31 text element has top-level `fontSize: 12` (stale) and `params.fontSize = 20`
- **THEN** after migration `fontSize` is 20

#### Scenario: Keyframe paths renamed
- **WHEN** a v31 element animates `transform.positionX` and `transform.rotate`
- **THEN** after migration its `animations` keys are `transform.position.x` and `transform.rotation` with identical keys

#### Scenario: Bookmarks become markers
- **WHEN** a v31 scene has `bookmarks: [{time: 360000, note: "cut"}]`
- **THEN** after migration it has `markers: [{id: <uuid>, time: 360000, note: "cut", color: 1}]` and no `bookmarks` key

#### Scenario: Whole fixture set validates
- **WHEN** every project of the classic fixture set (one per element type, with masks, effects, keyframes and a standalone effect element) is migrated from v31
- **THEN** each result passes strict validation with zero errors and zero dropped elements

#### Scenario: Blur intensity rescaled on a square canvas
- **WHEN** a classic 1080 × 1080 project holds a clip effect `blur` with `intensity = 40`
- **THEN** the migrated entry has `params.intensity = 23` (40 × 0.5625 = 22.5, rounded half away from zero) and the migration report lists the change

### Requirement: Classic values without a counterpart
The migration SHALL treat classic data with no schema-32 field as listed in `catalog.md` §13.7 and SHALL record each case in a migration report stored with the pre-migration backup (`project-storage.Backup before migration`): `params` keys not registered for the element type are dropped; `textDecoration`, ISO date strings, `effectType`, runtime `buffer` / `url` / `file` values and the classic `version`-only fields are replaced or dropped as mapped; an animation path that has no schema-32 path is removed; a graphic with an unknown `definitionId` and a sticker with a malformed `stickerId` are removed by load repair and listed. Nothing is dropped silently: the report lists `{path, classicKey, reason}` for every dropped value, and when the list is not empty the app shows once, on first open, "{n} items from the original project have no equivalent and were not migrated", with "Details". The exceptions to the additive policy of `project-storage.Schema versioning` at this step are exactly: `params` removal, `fontWeight` type, `textDecoration` replacement, `bookmarks` → `markers`, ISO dates → `_ms`, `effectType` → `effects[0].type`, the data-URL thumbnails, and the move of `currentSceneId` and `timelineViewState` under `local`; the backup keeps the original bytes. [NEW] [PORT ST-006]

#### Scenario: Unregistered params key
- **WHEN** a v31 image element has `params.customGlow = 3`
- **THEN** the key is dropped, and the report holds `{path: <element>, classicKey: "customGlow", reason: "unregistered"}`

#### Scenario: Clean project
- **WHEN** a v31 project uses only registered keys
- **THEN** the report is empty and no notice is shown

#### Scenario: Backup keeps the original
- **WHEN** any v31 project is migrated
- **THEN** the pre-migration backup contains the original `params` maps, `bookmarks` and ISO dates byte for byte

### Requirement: Document validator
`packages/editor-core` SHALL export one validator, `validateProjectDocument(document, {mode, registries})`, and one transition validator, `validateDocumentChange(before, after, {writer})`, and every writer SHALL pass them before a change is committed, saved, emitted as a state patch or accepted from outside: UI commands, canvas gestures at commit, keyboard actions, agent tools (`agent-editing-tools`), host principals (workflow, film and automation writers), sync patches received from another device, the migration chain's final result, package import, classic import, template application and snapshot restore. `mode: "strict"` (every writer) rejects any error; `mode: "load"` applies `project-document.Load-time repair`. The validator checks, in order: structure and types (the Zod schema), ranges and limits, canonical order, id uniqueness, references, type/zone compatibility, animation paths and channels, transition records, template and multicam invariants. `validateDocumentChange` additionally enforces `project-document.Template lock enforcement`. A failed validation changes nothing, adds no history entry and returns every error found (up to 100), each `{code, path, message, details?}`. Validation of a document of 10 000 elements SHALL complete within 150 ms on the reference desktop device of `diagnostics-quality.Performance budgets` and within 600 ms on the reference mobile device; an incremental mode validates only the entities a command touched plus the references into and out of them, within 5 ms for a single-element edit. The Gateway's sync rendezvous does not run the validator (it applies patches with a JSON library, `cross-device-sync.Canonical document form`); the receiving client and every host-side writer do. [NEW]

#### Scenario: Same answer for every writer
- **WHEN** the inspector, a keyboard shortcut and an agent tool each try to give an element a `duration` of 0
- **THEN** all three fail with `document/out-of-range` at the same path and the document is unchanged

#### Scenario: All errors returned
- **WHEN** an imported document has an overlapping pair of elements and an unknown `mediaId`
- **THEN** the result lists both `document/elements-overlap` and `document/unknown-asset`

#### Scenario: Remote patch is validated
- **WHEN** a device receives a state patch whose result has two elements with the same id
- **THEN** it does not apply the patch and reports `document/duplicate-id` through the follow path of `cross-device-sync.Live following by non-writers` (a lease holder answering `jagentchill.sync.applyRemote` reports it per `cross-device-sync.Host principal lease`)

#### Scenario: Incremental validation budget
- **WHEN** one element's opacity is committed in a 10 000-element project
- **THEN** validation of the change completes within 5 ms on the reference desktop device

### Requirement: Structural and reference invariants
A valid document SHALL satisfy all of: (1) exactly one main scene, of `kind: "timeline"`; (2) every scene has `tracks.main` of type `video`; (3) zone/type and element/track compatibility; (4) ids unique per `project-document.Identifiers`; (5) no two elements of a track overlap, and arrays are in canonical order; (6) every element has `duration ≥ 1 frame`, `startTime ≥ 0`, `startTime + duration ≤ 24 h`, and `trimStart + trimEnd ≤ sourceDuration` where a source exists; (7) every asset, scene, track, folder, LUT, slot, angle, motion-track and target-element reference resolves, with the right type; (8) the compound reference graph is acyclic and at most 8 deep; (9) `groupId` is shared by ≥ 2 elements of one scene and `linkId` by exactly 2; (10) transition records mirror the element references and join exactly adjacent elements; (11) every animation path resolves to an animatable field of its element and every channel matches its shape; (12) count limits and the byte limit; (13) no schema-32 field on a type that does not carry it; (14) the template and multicam rules. References that are allowed to dangle — provenance links to hosts, `cover.sceneId`, `cover.mediaId`, a `user:` LUT id, a `user:` or `generated:` sticker hash, and a `background` or `cutout.background` media id whose asset was removed by another device — are reported with severity `warning` and never fail validation; every other violation has severity `error`. [NEW] [PORT T-004, T-005, T-009, SC-005]

#### Scenario: Missing main track
- **WHEN** a scene has no `tracks.main`
- **THEN** validation fails with `document/main-track-invalid`

#### Scenario: Warning does not block
- **WHEN** `cover.mediaId` names a removed asset and nothing else is wrong
- **THEN** validation succeeds with one warning `document/unknown-asset`

#### Scenario: Group across scenes
- **WHEN** two elements in different scenes share a `groupId`
- **THEN** validation fails with `document/group-invalid`

### Requirement: Load-time repair
In `mode: "load"` the validator SHALL repair instead of failing, in this fixed order, and return the repaired document with a list of repairs: (a) non-integer ticks are rounded half away from zero; (b) numbers outside a range are kept as stored and clamped only for evaluation (the stored value is corrected the next time the field is written), except counts over a limit, which keep the first entries; (c) arrays out of canonical order are sorted; (d) a dangling `groupId`, `linkId`, `transitionIn` / `transitionOut`, `tracking`, `folderId` or slot reference is cleared, and an orphan transition record is removed; (e) an animation path that does not resolve is removed; (f) an element that still fails (unknown asset for a required `mediaId`, wrong track, overlap with an earlier element, a compound cycle) is removed — of two overlapping elements, the one with the greater `startTime` (then the greater `id`); (g) a missing main scene is recreated as an empty "Main scene", and a missing main track as an empty "Main Track". Structural failures that cannot be repaired (the root is not an object, `scenes` is not an array, `schemaVersion` missing after migration) fail the load per `projects.Project not found and load errors`. Repairs are applied in memory, shown as the non-blocking notice "{n} items were repaired or skipped while loading" with "Details", and persisted only when the user makes the next edit (the repair then forms part of that first save, after a version snapshot of the unrepaired record). Unknown fields are never touched by repair. This requirement supersedes the drop rule of `project-storage.Storage integrity and concurrency` for the list of what is dropped. [NEW]

#### Scenario: Dangling link cleared
- **WHEN** a loaded element has `linkId = "L1"` and no other element shares it
- **THEN** the element loads with `linkId = null` and the repair list names it

#### Scenario: Overlap on load
- **WHEN** a loaded track holds elements at 0–3 s and 2–5 s
- **THEN** the element starting at 2 s is removed, the element starting at 0 s is kept, and the notice reports one repaired or skipped item using the singular form of the locale

#### Scenario: Repair is not saved until an edit
- **WHEN** a repaired project is opened and closed without editing
- **THEN** the stored record is byte-identical to the one before opening

#### Scenario: Unrepairable
- **WHEN** a record's `scenes` is a string
- **THEN** the load fails with the load-error screen and no record is modified

### Requirement: Validation error codes
Validation errors SHALL use only the codes of `catalog.md` §14, all of the form `document/<kebab>`: `document/not-an-object`, `document/unknown-format`, `document/schema-too-old`, `document/schema-too-new`, `document/invalid-min-reader`, `document/missing-field`, `document/wrong-type`, `document/out-of-range`, `document/not-integer-ticks`, `document/not-frame-aligned`, `document/invalid-number`, `document/invalid-rational`, `document/invalid-color`, `document/invalid-id`, `document/duplicate-id`, `document/field-not-allowed`, `document/too-large`, `document/limit-exceeded`, `document/no-main-scene`, `document/main-track-invalid`, `document/track-zone-mismatch`, `document/element-track-mismatch`, `document/elements-overlap`, `document/elements-unsorted`, `document/time-out-of-bounds`, `document/unknown-asset`, `document/asset-type-mismatch`, `document/unknown-scene`, `document/compound-cycle`, `document/compound-depth`, `document/unknown-definition`, `document/unknown-reference`, `document/link-invalid`, `document/group-invalid`, `document/transition-ref-mismatch`, `document/transition-not-adjacent`, `document/animation-path-invalid`, `document/animation-channel-invalid`, `document/effects-limit`, `document/masks-limit`, `document/caption-overlap`, `document/multicam-invalid`, `document/template-invalid`, `document/template-locked`, `document/patch-invalid` and `document/device-local-in-patch`. The family `document/<kebab>` is registered in `server-api.RPC error envelope` with this requirement as its definition. When a document error crosses an RPC or tool boundary it is carried as the general code `INVALID_PARAMS` with `details.documentErrors[]` (the `{code, path, message}` list), except `document/template-locked`, which is carried as `CONFLICT` with the same details, and sync application failures, which use `PATCH_INVALID` of `cross-device-sync` with the same details. `message` is English for logs; clients display localised text keyed by `code`. [NEW]

#### Scenario: Tool boundary
- **WHEN** an agent tool call would create overlapping elements
- **THEN** the tool result has `error.code = "INVALID_PARAMS"` and `error.details.documentErrors[0].code = "document/elements-overlap"`

#### Scenario: Unlisted code
- **WHEN** the validator's code table is compared with `catalog.md` §14 in CI
- **THEN** the two lists are identical, and a code emitted in tests that is not in the list fails the test

#### Scenario: Locked template over RPC
- **WHEN** a host writer tries a structural edit on a locked template project
- **THEN** the RPC error is `CONFLICT` with `details.documentErrors[0].code = "document/template-locked"`

### Requirement: State patch format
A state patch over a project document SHALL be an ordered list of entries `{op, path, value?, before?}` with `op` one of `add`, `remove`, `replace`, applied in order to the canonical document (never to `local`). `path` is a JSON Pointer (RFC 6901 escaping) in which a segment that addresses a member of an ID-KEYED array is written `@<id>` instead of an index. The id-keyed arrays are: `scenes`, `tracks.overlay`, `tracks.audio`, `elements`, `markers`, `transitions`, `effects`, `masks`, `masks[].params.path`, `strokes`, `multicam.angles`, `template.slots`, `cover.texts`, `media.assets`, `media.folders`, `media.luts`, and the `keys` of every channel. Every other array (`beats`, `words`, curve points, speed-curve points, stroke `points`, `tags`, `scriptLinks`, `themeColors`, `editableTexts`, `audioSlots`, `expandedKeyframeElementIds`) is addressed by zero-based index, with `-` for append. Animation paths are single pointer segments (the dotted path, escaped). `add` on an id-keyed array uses `path` ending in `@<id of value>` and inserts at the position given by canonical order for sorted arrays (`elements`, `markers`, `keys`, `media.assets`), or before the entry named by `before: "@<id>"` (absent = append) for ordered arrays; a reorder is a `remove` followed by an `add`. `replace` of a member replaces the value at that key; `remove` deletes the key or the entry. An applier resolves `@<id>` by a linear lookup of `id` and needs no editor code. A patch is invalid (`document/patch-invalid`) when a path does not resolve, an `@<id>` matches zero or several entries, `add` targets an existing id, or the value's `id` differs from the path's. Example: `/scenes/@s1/tracks/overlay/@t3/elements/@e9/transform/position/x`. `cross-device-sync.Operation log` and `project-storage.State patch emission` own transport, batching, revisions and the journal, and use this path syntax. [NEW]

#### Scenario: Field edit
- **WHEN** element `e9` on overlay track `t3` of scene `s1` is moved to x = 120
- **THEN** the patch is `[{op: "replace", path: "/scenes/@s1/tracks/overlay/@t3/elements/@e9/transform/position/x", value: 120}, {op: "replace", path: "/metadata/updated_ms", value: <ms>}]`

#### Scenario: Insert into a sorted array
- **WHEN** element `e12` starting at 2 s is added to a track holding elements at 0 s and 5 s
- **THEN** the entry is `{op: "add", path: "…/elements/@e12", value: {…id: "e12"…}}` with no `before`, and every applier places it second

#### Scenario: Reorder a track
- **WHEN** overlay track `t3` is moved above `t1`
- **THEN** the patch holds `{op: "remove", path: "/scenes/@s1/tracks/overlay/@t3"}` followed by `{op: "add", path: "/scenes/@s1/tracks/overlay/@t3", before: "@t1", value: <track>}`

#### Scenario: Ambiguous id
- **WHEN** a patch path contains `@e9` and two elements of that array have id `e9`
- **THEN** the patch is rejected with `document/patch-invalid`

#### Scenario: Keyframe addressed by id
- **WHEN** the value of key `k4` of the opacity channel is changed
- **THEN** the path is `…/elements/@e9/animations/opacity/keys/@k4/value`

### Requirement: Device-local data is never synced
A state patch, snapshot, package, share link, host copy or agent tool result SHALL NOT contain any value under `local`, and a patch whose path starts with `/local` SHALL be rejected by every applier with `document/device-local-in-patch`. The device-local values are exactly those of `catalog.md` §16: current scene, timeline view state (zoom, scroll, playhead, per-scene playheads, expanded keyframe lanes), project folder and trash state on this device, per-asset storage mode and external path, grant id, size and modified time, decode capability, probe flag, proxy state and variant presence, the last export save path, and the uniform-scale lock. Everything else in the document is synced, including `solo`, `settings.useProxies`, `exportSettings`, `publish`, `glossaries`, `template` and all media asset records. Editor preferences that change document RESULTS — magnet, ripple, linkage, Free layer, snapping — are not document fields at all (`project-storage.UI preference storage`): a command's result is what is stored and synced, so a host-side or remote writer never needs another device's preferences. Selection, undo history, preview-layer patches, object URLs and decoded buffers are runtime data and are never persisted. [NEW] [PORT T-099, U-005]

#### Scenario: Patch touching local
- **WHEN** a received patch has the path `/local/timelineViewState/zoomLevel`
- **THEN** it is rejected with `document/device-local-in-patch`

#### Scenario: External path stays on the desktop
- **WHEN** a desktop project with a linked external file syncs to a phone
- **THEN** the phone receives the asset record without any path, and its own `local.media[<id>].storage` is `"managed"`

#### Scenario: Solo syncs
- **WHEN** the lease holder solos a track
- **THEN** a viewer device shows the track soloed after the next applied patch

### Requirement: Evolution rules
Changes to the document after schema 32 SHALL be classified as additive or breaking. ADDITIVE (allowed in any schema step, never raises the minimum reader): a new optional field whose absence means the previous behaviour; a new optional structure; a wider numeric range; a new animatable path for an existing field; a new device-local field. BREAKING (allowed only with a schema step that declares a feature level): removing, renaming or moving a field; changing a type, unit, default or meaning; narrowing a range; a new required field; a new member of a closed union that an older reader would have to interpret to keep the invariants or the picture and sound of content it understood (a new element type, track type, zone, scene kind, background kind, mask type, channel shape, patch op or path syntax); a new invariant. A new member of an OPEN registry — effect, filter, transition, clip-animation, text-animation, bubble, shape-definition or voice-effect ids — is additive: an older reader preserves the entry and renders it as pass-through or not at all. No field is ever removed, renamed or repurposed from schema 32 upward; a superseded field is kept, written alongside its successor for as long as `minReaderSchemaVersion` is below the step that introduced the successor. Every schema step ships a migration, a fixture per changed structure, an updated `catalog.md` with a "since" note on each new row, and a down-level test proving that the previous app version opens, edits and saves a document of the new schema without losing a field. [NEW] [PORT ST-006]

#### Scenario: Additive field
- **WHEN** schema 33 adds the optional element field `lensCorrection`
- **THEN** a schema-33 document that uses it keeps `minReaderSchemaVersion: 32`, and the schema-32 app preserves the field

#### Scenario: Breaking union member
- **WHEN** schema 34 adds the element type `particle`
- **THEN** a document that contains such an element has `minReaderSchemaVersion: 34`, and a document at schema 34 without one keeps the lower value

#### Scenario: Down-level test
- **WHEN** the release pipeline runs for a schema step
- **THEN** the previous app build opens the new-schema fixtures, performs a move and a save, and the saved canonical form differs from the input only by the moved field and `metadata.updated_ms`

### Requirement: Minimum reader version
`minReaderSchemaVersion` SHALL be computed by the writer on every save as the highest feature level of the breaking features actually PRESENT in the document, and never below 32: each breaking feature has a declared level (the schema that introduced it), listed in a table in the protocol package and in `catalog.md` from schema 33 on; a document that stops using the feature (the last such element is deleted) returns to the lower value on the next save. It is always ≤ `schemaVersion`. A reader whose own schema is at least `minReaderSchemaVersion` opens the document read-write and applies `project-document.Unknown-field preservation`; a lower reader treats the document per `project-storage.Schema versioning` (listed with "Needs newer app", never modified). A writer MUST NOT lower `schemaVersion` and MUST NOT raise it except by running the migration chain; an app at schema N that edits a document at schema M > N leaves `schemaVersion = M` and recomputes `minReaderSchemaVersion` only over the features it knows, never below the stored value while unknown fields or types are present. At schema 32 the value is always 32. Both fields are part of the canonical document and of every snapshot and package manifest (`cross-device-sync.Schema version skew`). [NEW] [PORT ST-006]

#### Scenario: Schema 32
- **WHEN** any document is saved by a schema-32 app at schema 32
- **THEN** `schemaVersion = 32` and `minReaderSchemaVersion = 32`

#### Scenario: Older app edits a newer document
- **WHEN** a schema-32 app edits a document with `schemaVersion: 34`, `minReaderSchemaVersion: 32` and unknown fields
- **THEN** after save both values are unchanged

#### Scenario: Feature removed
- **WHEN** a schema-34 app deletes the only `particle` element of a document
- **THEN** the next save writes `minReaderSchemaVersion` as the highest level of the breaking features still present

### Requirement: Field ownership
Each section of the document SHALL have exactly one capability that owns its BEHAVIOUR (meaning, commands, UI, rendering parameters), while `project-document` owns every name, type, range, default, position, invariant and the validator:

| Document section | Fields | Behaviour owner |
|---|---|---|
| Envelope, versions, canonical form, limits, unknown fields | `format`, `schemaVersion`, `minReaderSchemaVersion`, `version` | `project-document`; storage mechanics and migration runner: `project-storage` |
| Project metadata, settings, cover, folders, trash | `metadata`, `settings.*` (except below), `cover`, `local.folderId`, `local.trash` | `projects` |
| Canvas background union | `settings.background`, element `background` (video, image, compound) | `projects` (value kinds), `timeline-editing` (per-clip rule), `render-engine` (rendering) |
| Colour pipeline | `settings.colorPipeline` | `render-engine` |
| Template mode | `template` | `templates` |
| Provenance links | `filmLink`, `workflowLink`, `scriptLinks`, element `scriptLink` | `film-production`, `agent-workflows` / `prompt-to-video-workflow`, `script-studio`; element chip and Unlink: `timeline-editing` |
| Export and publish data | `exportSettings`, `publish`, `local.exportSavePath` | `export-share` |
| Scene, tracks, zones, common element fields, markers, range, groups, links, compound | `scenes[]`, `tracks`, `markers`, `inPoint`, `outPoint`, §6 fields, `sceneId` | `timeline-editing` |
| Compound background rule | `compoundBackground` | `render-engine` |
| Multi-camera | scene `multicam`, element `multicam.angleId` | `timeline-editing` (creation, switching), `preview-canvas` (angle viewer), `render-engine` (render path) |
| Timeline view state, current scene | `local.currentSceneId`, `local.timelineViewState` | `timeline-editing`; expanded lanes: `keyframe-animation` |
| Transform, crop, flip | `transform`, `crop`, `flip`, `local.uniformScaleLock` | `preview-canvas`; geometry: `render-engine` |
| Opacity, blend, masks, chroma key, cutout | `opacity`, `blendMode`, `masks[]`, `chromaKey`, `cutout` | `masks-blending-keying` |
| Effects and filters, motion blur | `effects[]`, `motionBlur`, effect element `target` | `visual-effects-filters` |
| Colour adjustments, LUT records | `adjustments`, `media.luts` | `color-adjustment` |
| Transition records and references | `transitions[]` (`kind: "transition"`), `transitionIn`, `transitionOut` | `transitions` |
| Animation store, clip animation | `animations`, `clipAnimation` | `keyframe-animation` |
| Retime, speed curve, freeze | `retime`, `freeze` | `speed-retime` |
| Audio levels, fades, crossfades, processing, beats, track audio | §9 fields, track `muted`, `solo`, `volume`, `pan`, `ducking`, `transitions[]` (`kind: "crossfade"`), `shape` | `audio-editing` |
| Text | §10.4 fields, `tracking` on text | `text-and-titles` |
| Captions | caption element fields, track `caption`, `glossaries` | `captions-subtitles` |
| Stickers, shapes, drawings | `stickerId`, intrinsic size, `loop`, `playbackSpeed`, `definitionId`, graphic `params`, `strokes` | `stickers-shapes` |
| Analysis-driven settings, motion tracks, derived assets | `stabilization`, `deflicker`, `retouch`, `relight`, `eyeContact`, `aiMotion`, `processedSource`, asset `motionTracks`, asset `derived` | `ai-editing-tools` |
| Media assets, folders, provenance, device media state | `media.assets`, `media.folders`, `provenance`, `local.media`, `settings.useProxies` | `media-library`; AI provenance keys: `generation-providers`; variant presence: `cross-device-sync` |
| State patches over the document | path syntax here | transport and revisions: `cross-device-sync`; emission and journal: `project-storage` |

An owner specifies behaviour by citing field names from `project-document.Canonical field list` and MUST NOT restate a shape, range or default. A change to a field (new field, new range, new union member) is made in this capability first; the owner's behaviour change cites it. [NEW]

#### Scenario: One owner per section
- **WHEN** the ownership table is checked against the catalogue in CI
- **THEN** every catalogue row names an owner that appears in this table for its section, and no section has two behaviour owners for the same field

#### Scenario: Owner wants a new field
- **WHEN** `audio-editing` needs a per-clip "stereo width" value
- **THEN** the field is added to `catalog.md` §9 and to the Zod schema by a change to `project-document`, and `audio-editing` references it by name

#### Scenario: Restated shape is a lint error
- **WHEN** a spec other than `project-document` contains a sentence of the form "SHALL be `{…}`" that lists keys of a document structure
- **THEN** the document-schema lint, a CI script that scans every `specs/*/spec.md`, reports it as a restated schema and fails
