## ADDED Requirements

### Requirement: Template gallery
The app SHALL provide a Templates gallery reachable from the Templates asset tab of the editor (desktop and web), the Templates sheet of `mobile-editor.Captions, Stickers, Templates and AI tools groups` (mobile), the Templates entry of the home screen on every platform, and `/library/templates` (`app-shell-navigation.Library screen`). The gallery SHALL show the tabs "Bundled" and "My templates", a category filter (All, Vlog, Promo, Slideshow, Intro and outro, Social short, Quote, Other), an aspect-ratio filter (All, 9:16, 16:9, 1:1, 4:5) and a search field matching name and tags case-insensitively after a 150 ms debounce. Each card SHALL show a thumbnail, name, duration, aspect ratio and number of media slots; hovering a card (tapping it on mobile) SHALL play its preview video muted. The preview and thumbnail of a bundled template SHALL be the real render of that template filled with the demo media assigned to it in `templates/catalog.md`; no card SHALL show a stand-in image or a placeholder tile as its preview. The gallery SHALL work fully offline and SHALL make no network request. [CAPCUT CC-226, CC-229, CC-283, CC-290]

#### Scenario: Filter and search
- **WHEN** the user selects ratio 9:16 and types "travel"
- **THEN** only 9:16 templates whose name or tags contain "travel" are listed

#### Scenario: No results
- **WHEN** no template matches
- **THEN** the empty state "No templates match your search" is shown with a Clear filters button

#### Scenario: Offline
- **WHEN** the device is offline
- **THEN** bundled and personal templates are listed with thumbnails and previews

#### Scenario: Ratio filter on the bundled set
- **WHEN** the Bundled tab is filtered to 1:1 on a fresh install
- **THEN** exactly the two templates `promo-product` and `quote-card` are listed

### Requirement: Bundled templates are original content
The app SHALL ship exactly the 12 project templates enumerated in section 2 of `templates/catalog.md` (normative: id, name, category, canvas, duration, every slot with its type, duration and required flag, every editable text with its sample text, text template and maximum length, the music track, the transitions and theme colours): 4 in 9:16, 5 in 16:9, 2 in 1:1 and 1 in 4:5, covering all seven categories. Every bundled template SHALL be authored for this project and built only from bundled content of this change: the fonts of `text-and-titles.Bundled fonts`, the text templates of `text-and-titles.Text templates`, the transitions of `transitions.Bundled transition library`, shapes of `stickers-shapes.Shape parameter table`, and a music track of `audio-editing.Bundled sound pack` named by id. Preview videos and thumbnails SHALL be rendered at build time by the engine from the template filled with the demo media set of section 1 of the catalogue — procedural clips and stills generated deterministically from definitions in `packages/content/demo/`, authored for this project under CC0-1.0; the demo media SHALL be used only for previews and thumbnails and SHALL NOT appear in the user's media library or in a project created from a template. Each template manifest SHALL carry `author`, `license` and `sources[]` for every embedded asset, the demo media directory SHALL have a row in the asset provenance file of `platform-skeleton.Licence and third-party notices`, and the build SHALL fail when a bundled template has an embedded asset without a licence entry, references an id that is not in the cited catalogue, differs from its catalogue row, or contains a text element that is not an editable text and whose content equals a sample text of `text-and-titles/catalog.md` section 5, unless `templates/catalog.md` names that element as a design glyph (the countdown and step digits and the decorative quotation mark) — so no bundled template ships sample wording the user cannot change. There SHALL be no community feed, remote catalogue, marketplace or third-party template content. [NEW]

#### Scenario: Exactly 12 offline
- **WHEN** the Bundled tab is opened with no filters on a fresh install with no network
- **THEN** exactly 12 templates are listed with the catalogue ids

#### Scenario: Licence gate
- **WHEN** a bundled template package contains an audio file without a licence entry in its manifest
- **THEN** the build check fails naming the file

#### Scenario: Music id must exist
- **WHEN** a bundled template names a music id that is not in the catalogue of `audio-editing.Bundled sound pack`
- **THEN** the build check fails naming the template and the id

#### Scenario: No uneditable sample text
- **WHEN** the build check inspects the snapshots of `vlog-travel`, `slideshow-memories` and `event-countdown`
- **THEN** none contains the texts "Subtitle goes here", "Full Name" or "Location · Date", and every text element is either an editable text or a design glyph named in the catalogue

#### Scenario: Preview shows real content
- **WHEN** the preview of `vlog-day` is played
- **THEN** the preview is the full 15 s, every slot — including slot 6 from 12 s — shows its assigned demo clip with the template's texts, transitions and music timing, and no frame shows a placeholder tile

#### Scenario: Demo media stays out of projects
- **WHEN** the user creates a project from `vlog-day`
- **THEN** all six slots are empty and the project's media library contains no demo clip

### Requirement: Template data model
A template SHALL consist of a manifest and a project snapshot. The manifest SHALL contain: `id` (UUID for personal templates, the catalogue id for bundled ones), `name` (1–80 characters), `category`, `tags[]` (up to 20), `canvas {width, height}`, `frameRate`, `duration` (ticks), `slots[]`, `editableTexts[]`, `audioSlots[]`, `themeColors[]` (0–6 colours used by `templates.Brand kit`), `colorBindings[]`, `thumbnail`, `preview`, `author`, `license`, `sources[]`, `schemaVersion` (project schema version of the snapshot), `packageVersion` (1), `created_ms`, `appVersionMin`. A media slot SHALL be `{slotId, elementId, index, accepts: "video" | "image" | "any", duration, required: boolean, label}`; an editable text `{elementId, label, maxLength}`; an audio slot `{elementId, label, replaceable: boolean}`; a colour binding `{colorIndex, elementId, field}`. `elementId` is the id of the element in the snapshot — the manifest and the project use the same key name (the earlier manifest key `elementRef` is read as `elementId` on import and never written). `preview` is a video of the whole template — its full duration, at most 60 s (a longer template shows its first 60 s), 720 px on the long side, at most 12 MB — so that every slot, text, transition and the music timing of a bundled template is visible in it.

The snapshot SHALL be a single-scene project document in which every slot element has no `mediaId`. When a project is created from the template, these lists are copied into the project's `template` object, which is the stored model of template mode and is owned by `project-document.Template mode model`: `template {templateId, locked, sceneId, slots[], editableTexts[], audioSlots[], themeColors[], colorBindings[]}`, each slot gaining the per-project state `filled`, `framing {zoom, panX, panY}` and `sourceOffset`. This capability defines the behaviour of that object and restates none of its shape. The snapshot SHALL NOT carry `filmLink`, `workflowLink`, `scriptLink` or `scriptLinks` provenance; they are cleared when a template is saved. How an unfilled slot renders is defined by `templates.Slot semantics and locked structure`. [NEW]

#### Scenario: Manifest validity
- **WHEN** a template is saved with 5 slots
- **THEN** its manifest lists 5 slots with unique `slotId` values, `elementId` values that resolve to elements of the snapshot, and consecutive `index` values 1 to 5

#### Scenario: Schema validation
- **WHEN** a manifest lacks `canvas`
- **THEN** the template is rejected as invalid and is not listed

#### Scenario: Provenance is cleared
- **WHEN** a project whose clips carry `workflowLink` is saved as a template
- **THEN** no element of the template snapshot has a `workflowLink`

#### Scenario: Preview covers the whole template
- **WHEN** the preview of the 24 s bundled template `slideshow-memories` is inspected
- **THEN** it is 24 s long, 720 px on its long side and at most 12 MB, and slot 8 is visible from 21 s

#### Scenario: Older manifest key
- **WHEN** a package whose manifest uses `elementRef` is imported
- **THEN** the stored manifest and any project created from it use `elementId` with the same values

### Requirement: Create a template from a project
"Save as template" (File menu on desktop and web; top-bar overflow of `mobile-editor.Top bar` on mobile; agent tool `jc_template_save` of `agent-editing-tools.Template tool`) SHALL open a dialog with: name; category; tags; a list of every video and image element of the active scene with a "Slot" switch (default on for main-track elements, off for overlay elements), an order number, a label and a "Required" switch (default on); a list of every text element with an "Editable" switch (default on), a label and a maximum length (default: the larger of 20 and twice the current length, at most 500); a list of audio elements with a "Replaceable" switch (default off); up to 6 theme colours, proposed from the most used text and shape colours, each bound to the fields that use it (`colorBindings`); a thumbnail picker (current frame, default the frame at 1 s); and a switch "Show my media in the preview" (default on). Saving SHALL store the template under My templates, embedding the media of elements that are not slots (a size estimate SHALL be shown; saving SHALL be refused above 2 GiB) and storing no media for slot elements. A preview video SHALL be rendered in the background with the limits of `templates.Template data model` (the template's full duration up to 60 s, 720 px on the long side, at most 12 MB — the bitrate is lowered to fit): with "Show my media in the preview" on it is rendered from the project as it is; with it off, slot elements are rendered as numbered tiles (slot index and accepted type on a neutral fill, drawn for the preview render only) and the dialog states "Your clips are not included in the preview". The source project SHALL NOT be modified. Projects with more than one scene SHALL save the active scene only and state this in the dialog. A scene with no video or image element SHALL be savable as a template with zero slots. A project that is itself in template mode cannot be saved as a template until it is opened in the full editor. [CAPCUT CC-230] [NEW]

#### Scenario: Save a template
- **WHEN** the user saves a project with 4 main-track clips and 2 text elements using the defaults
- **THEN** My templates contains a template with 4 required slots and 2 editable texts and the project is unchanged

#### Scenario: Too large
- **WHEN** embedded non-slot media totals more than 2 GiB
- **THEN** saving is refused with the estimated size and a hint to turn more elements into slots

#### Scenario: Slot media is not embedded
- **WHEN** a clip is marked as a slot
- **THEN** the saved template's media directory contains no bytes of that clip's source media

#### Scenario: Preview without my media
- **WHEN** the user turns "Show my media in the preview" off and saves
- **THEN** the preview video shows numbered tiles in place of the user's clips

#### Scenario: Long project
- **WHEN** a 95 s project is saved as a template
- **THEN** its preview is the first 60 s

### Requirement: Slot semantics and locked structure
Each slot SHALL keep the element's timing, track, transform, crop mode, speed curve, effects, filters, adjustments, masks, animations and transitions; only the media source (`mediaId`), the source start offset (`sourceOffset`) and the in-slot framing (`framing`) are replaceable. Media placed in a slot SHALL be scaled to cover the slot element's bounds (centre crop) by default. A video shorter than the slot duration SHALL be accepted and SHALL hold its last frame for the remainder, with a warning badge "Shorter than slot" on the slot; an image SHALL fill the whole slot duration. A slot with `accepts = "video"` SHALL refuse images and vice versa with the toast "This slot needs a {type}".

**Empty slots render the same in preview and export.** An unfilled slot (`filled: false`) renders as `render-engine.Empty template slot rendering` defines, in preview playback, stills and every export alike: a main-track slot shows the last frame of the nearest earlier filled slot held over its whole time range (the first frame of the nearest following filled slot when no earlier one exists; nothing when no slot is filled), with the slot element's own transform, crop and effects; an unfilled slot on an overlay track renders nothing. Music, texts and transitions therefore keep their timing whether or not optional slots are filled. The numbered placeholder tile (slot index, accepted type, "required" dot) is NOT part of the rendered picture: the app draws it as an overlay on the preview only while that slot is selected or the transport is paused on it, and on the slot chips. An empty REQUIRED slot blocks export (`export/template-incomplete`, `export-share.Pre-flight validation`, no "Export anyway"); an empty OPTIONAL slot is not a pre-flight item.

**Lock and its enforcement.** A project is in template mode exactly while `template.locked` is `true` (`project-document.Template mode model`). In template mode, clips SHALL NOT be moved, trimmed, split, deleted or reordered and effects and timings SHALL NOT be editable; the only permitted changes are: fill, replace, clear and adjust a slot (media, `sourceOffset`, `framing`, volume, mute); the content of an editable text within its `maxLength`; replace, volume and mute of an audio slot as its `replaceable` flag allows; "Apply brand"; cover, project name, export settings and publish caption; and "Edit in full editor". This list is enforced for EVERY writer by the document validator — `project-document.Template lock enforcement`, which is the enforcement owner and evaluates the before/after documents — so the inspector, timeline gestures, keyboard shortcuts, agent tools (`agent-editing-tools.Template tool`: only `jc_template_edit` succeeds; any other structural tool returns `CONFLICT` with `details.documentCode: "document/template-locked"`), a patch synchronised from another device (`cross-device-sync.Operation log`), workflow and film writers, package import and migrations are all bound alike; a rejected change leaves the document untouched and, in the UI, shows the toast "This project is a template draft — open it in the full editor to change its structure". The UI of template mode offers no control that issues a forbidden change, and the standard editor is never shown for a locked project on any platform. A template draft is listed with the badge "Template draft" (`projects.Projects list`). [CAPCUT CC-227] [NEW]

#### Scenario: Cover fit
- **WHEN** a 16:9 video is placed in a 9:16 slot
- **THEN** the video fills the slot with its sides cropped equally

#### Scenario: Short clip
- **WHEN** a 2 s video is placed in a 3 s slot
- **THEN** the last frame is held for the final second and the slot shows the warning badge

#### Scenario: Wrong type
- **WHEN** the user picks an image for a slot that accepts only video
- **THEN** the slot stays empty and the toast is shown

#### Scenario: Empty optional slot in preview and export
- **WHEN** `vlog-day` has slots 1–3, 5 and 6 filled and optional slot 4 (7 s to 9 s) empty, and the frame at 8 s is rendered in preview playback and in an export
- **THEN** both show the last frame of slot 3, they match within the preview-versus-export tolerance, and the music and texts are at the same times as with slot 4 filled

#### Scenario: Placeholder tile is an app overlay
- **WHEN** the transport is paused on empty slot 4 and a snapshot is saved
- **THEN** the preview shows the numbered tile over the canvas and the snapshot file does not contain it

#### Scenario: Agent tool cannot break the lock
- **WHEN** an agent calls a split tool on a clip of a project whose `template.locked` is `true`
- **THEN** the tool returns `CONFLICT` with `details.documentCode: "document/template-locked"` and the project is unchanged

#### Scenario: Patch from another device cannot break the lock
- **WHEN** a second device running the standard editor sends a patch that deletes a slot element of a locked project
- **THEN** the patch is rejected with `document/template-locked` and the element still exists on every device

#### Scenario: Keyboard shortcut
- **WHEN** the user presses the key bound to `timeline.delete` in template mode on desktop
- **THEN** nothing is deleted and the template-draft toast is shown

### Requirement: Use a template
"Use template" (and the agent tool `jc_template_apply` with `target: "new_project"`) SHALL create a new project from the template's snapshot with `template {…, locked: true}` (`project-document.Template mode model`; the template itself is never modified) and open the fill flow: a media picker with ordered multi-select whose selection count target equals the number of slots, where the n-th selected item fills slot n; the user MUST be able to proceed with fewer items, leaving the remaining slots empty. The template-mode editor SHALL show the preview, a row of slot chips (index, thumbnail, duration, a "required" dot), Undo and Redo, and tabs Media, Text and Audio; tapping a chip SHALL seek to the slot start and select it. Preview playback SHALL work at any time, with empty slots rendered as `templates.Slot semantics and locked structure` defines. Export SHALL be enabled when every required slot is filled; otherwise the Export button SHALL be disabled with the hint "{n} required clips are missing" (pluralised per locale). Leaving before any slot is filled and before any text is changed SHALL discard the new project; otherwise it SHALL be kept in the project list as a template draft (badge "Template draft", `projects.Projects list`), still locked, synchronised like any project, and reopened in template mode on every platform. On desktop and web the flow SHALL be presented with the slot chips under the player and the three tabs in the inspector area, with no timeline, asset panel or standard inspector; on mobile it SHALL use the layout of `mobile-editor.Template editor variant`.

The agent contract is the same operation and is owned here (`agent-editing-tools.Template tool` carries the schema): `jc_template_apply {templateId, media?: {slotId, assetId}[], texts?: {elementId, text}[], audio?: {elementId, assetId}[], target: "new_project" | "insert", idempotencyKey, dryRun?}`. With `target: "new_project"` it creates the locked project, fills the named slots, sets the named editable texts and replaceable audio slots, and returns `{projectId, missingRequired: slotId[]}` — unfilled required slots are reported, not an error, exactly as a person is allowed to proceed with fewer items; the draft is then edited with `jc_template_edit`. With `target: "insert"` it performs `templates.Apply a template to the open project` on the bound project. It fails with `INVALID_PARAMS`, naming the offending entry and changing nothing, when a `slotId` or `elementId` is unknown, an asset's kind is not accepted by its slot, an `elementId` under `texts` is not an editable text or under `audio` is not a replaceable audio slot, or a `text` is longer than that text's `maxLength`; and with `NOT_FOUND` for an unknown `templateId`. [CAPCUT CC-227, CC-229] [NEW]

#### Scenario: Fill in order
- **WHEN** a template has 3 slots and the user selects clips A, B and C in that order
- **THEN** slot 1 holds A, slot 2 holds B and slot 3 holds C, and Export is enabled

#### Scenario: Missing required slot
- **WHEN** one required slot is empty
- **THEN** Export is disabled and the hint uses the singular plural form of the locale: "1 required clip is missing"

#### Scenario: Abandon
- **WHEN** the user leaves the fill flow without choosing any media or changing any text
- **THEN** no new project appears in the project list

#### Scenario: Draft is stored locked
- **WHEN** the user fills one slot, leaves, and reopens the project on another device
- **THEN** the project list shows it with the badge "Template draft", its `template.locked` is `true`, and it opens in template mode

#### Scenario: Agent creates a draft with a missing slot
- **WHEN** an agent calls `jc_template_apply` for `vlog-day` with `target: "new_project"` and media for slots 1, 2 and 3 only
- **THEN** a locked project is created and the result lists the required slot 5 in `missingRequired`

#### Scenario: Agent text too long
- **WHEN** an agent passes a 45-character text for an editable text whose `maxLength` is 30
- **THEN** the tool fails with `INVALID_PARAMS` naming that element and no project is created

### Requirement: Replace and adjust slot media
Selecting a filled slot SHALL offer: Replace (opens the media picker for that slot only); Adjust (pan and pinch-zoom the media inside the slot frame, zoom 1–5×, constrained so that the slot stays covered; for video, a strip to choose the source start offset within `[0, sourceDuration − slotDuration]`); Volume and Mute for video slots, using the control, range and touch presentation of `audio-editing.Clip volume in decibels` (this capability states no volume range of its own); Remove (empties the slot). Adjust writes the slot's `framing {zoom, panX, panY}` and `sourceOffset` (`project-document.Template mode model`); Replace and Remove write the slot element's `mediaId` and the slot's `filled`. Each action SHALL be one undo step, and undo/redo SHALL be available in template mode on every platform (desktop and web: the standard shortcuts and buttons beside the slot chips; mobile: the transport row of `mobile-editor.Template editor variant`). The same actions serve the Slots tab of a compound inserted from a template, and the agent through `jc_template_edit` (`fill_slot`, `adjust_slot`, `clear_slot`; `agent-editing-tools.Template tool`). [CAPCUT CC-228] [NEW]

#### Scenario: Choose the start offset
- **WHEN** a 10 s video fills a 3 s slot and the user drags the strip to start at 4 s
- **THEN** the slot plays the source from 4 s to 7 s

#### Scenario: Offset limit
- **WHEN** the user drags the strip beyond the end
- **THEN** the start offset stops at 7 s

#### Scenario: Adjust framing
- **WHEN** the user zooms to 2× and pans left inside the slot
- **THEN** the slot shows the chosen region and never shows empty space

#### Scenario: Volume uses the audio control
- **WHEN** the user sets a video slot's volume to the control's 100 % position
- **THEN** the slot element's `volume` is 0 dB

### Requirement: Edit template text and audio
In template mode the Text tab SHALL list every editable text with its label; tapping one SHALL seek to it and open content editing (limited to the text's `maxLength`); font, colour and animation of template texts SHALL stay as authored (only "Apply brand" changes font and bound colours). Every bundled template exposes every text a viewer reads as an editable text, so no sample wording is locked (`templates/catalog.md`). Agent: `jc_template_edit` actions `set_text`, `replace_audio`, `set_audio_level`. The Audio tab SHALL list audio slots: a replaceable slot SHALL offer Replace (from the media library or from `audio-editing.Sounds library panel`, including the bundled sound pack with no host), with the new audio trimmed or looped to the slot duration, plus Volume and Mute as defined by `audio-editing.Clip volume in decibels`; a non-replaceable slot SHALL offer Volume and Mute only. [CAPCUT CC-228] [NEW]

#### Scenario: Edit a title
- **WHEN** the user changes the text labelled "Title" to "Summer 2026"
- **THEN** the preview shows "Summer 2026" with the template's font and animation

#### Scenario: Length limit
- **WHEN** a text has `maxLength = 40` and the user types 60 characters
- **THEN** input stops at 40 characters

#### Scenario: Replace music
- **WHEN** the user replaces a 15 s replaceable music slot with a 60 s track
- **THEN** the first 15 s of the new track play in the slot

#### Scenario: Short replacement loops
- **WHEN** the user replaces a 15 s replaceable music slot with a 6 s sound
- **THEN** the sound plays two and a half times to fill the 15 s

### Requirement: Open a template project in the full editor
Template mode SHALL offer "Edit in full editor" (agent: `jc_template_edit {action: "unlock"}`, which requires approval), which after a confirmation ("Structure locks are removed. This cannot be turned back into template mode.") sets `template.locked` to `false` — the `template` object stays as a record of origin (`project-document.Template mode model`) — and converts the project into an ordinary project with every element editable; each empty slot SHALL become an image element whose asset is a locally rendered still of the numbered placeholder tile, stored with media kind `slate` (`media-library.Media asset model`), that can be replaced or deleted and that pre-flight reports as `export/slates-present`. The conversion SHALL be one undo step within the session (undo restores `locked: true` and the empty slots) and SHALL be persisted on save; after the project has been saved and reopened it cannot be locked again. The "Template draft" badge is removed. [NEW]

#### Scenario: Unlock
- **WHEN** the user confirms "Edit in full editor"
- **THEN** `template.locked` is `false`, the standard editor opens with all tracks and elements editable and the slot chips are gone

#### Scenario: Empty slot becomes a slate
- **WHEN** the project had one empty slot when it was unlocked
- **THEN** the timeline has an image element at that slot's time range whose asset has kind `slate`, and "Replace" on it accepts any image or video

#### Scenario: Cancel the confirmation
- **WHEN** the user cancels the confirmation
- **THEN** the project stays in template mode

#### Scenario: Structural edit after unlocking
- **WHEN** the project is unlocked and the user splits a former slot clip
- **THEN** the split succeeds and no `document/template-locked` error occurs

### Requirement: Apply a template to the open project
From the editor's Templates tab (desktop and web) and from the Templates sheet on mobile (`mobile-editor.Captions, Stickers, Templates and AI tools groups`), a template card SHALL offer "Use template" (creates a separate new project as above) and "Insert into timeline" (agent: `jc_template_apply` with `target: "insert"`), which inserts the template's content at the playhead as a compound clip (`timeline-editing.Compound clips`) by the placement strategy `mainInsert` of `timeline-editing.Placement strategies`, as one undo step. The open project is NOT put into template mode: the compound's scene is an ordinary scene whose slot elements are empty and listed, with the template's editable texts and audio slots, in the Slots tab of the compound's inspector (`preview-canvas.Inspector structure per element type`; on mobile the Slots tool of `mobile-editor.Compound clip tool strip`), where each slot offers the actions of `templates.Replace and adjust slot media`; entering the compound allows any ordinary edit. Empty slots of the compound render as `templates.Slot semantics and locked structure` defines, in preview and export alike, and are not pre-flight items. Media, texts and audio passed by the agent tool are applied in the same undo step. When the template canvas ratio differs from the project's, the compound SHALL be scaled to fit inside the canvas and a toast SHALL state the mismatch. Inserting SHALL be refused with the message of `timeline-editing.Compound clips` when it would exceed the compound nesting limit. [CAPCUT CC-229] [NEW]

#### Scenario: Insert
- **WHEN** the user inserts an 8 s intro template at the playhead
- **THEN** an 8 s compound clip appears at the nearest main-track cut and one undo removes it

#### Scenario: Ratio mismatch
- **WHEN** a 9:16 template is inserted into a 16:9 project
- **THEN** the compound is fitted by height, centred, and a toast states that the template ratio differs

#### Scenario: Insert on a phone
- **WHEN** the user taps "Insert into timeline" on a card in the mobile Templates sheet
- **THEN** the sheet closes and the compound clip is selected on the main track with the Slots tool in its strip

#### Scenario: Fill a slot from the inspector
- **WHEN** the compound is selected on desktop and the user fills slot 2 in the Slots tab
- **THEN** the compound shows that media in slot 2's time range and the host project's `template` field is still absent

### Requirement: Manage personal templates
My templates SHALL support, from a card's context menu (long-press on touch): Rename, Edit details (category, tags, thumbnail), Duplicate, Export package, and Delete (with confirmation; a deleted template becomes a trash entry of kind `template` in `projects.Trash`, kept 30 days and restorable from there). Templates SHALL be stored through `project-storage.Storage port and per-platform stores`, counted in the storage usage display, synced between the user's devices by `cross-device-sync.Library item sync` and included in backups. Bundled templates SHALL NOT be renamed or deleted; "Duplicate to My templates" SHALL create an editable copy. The same list is shown at `/library/templates`. [NEW]

#### Scenario: Delete and restore
- **WHEN** the user deletes a personal template and restores it from the trash within 30 days
- **THEN** the template is listed again with its slots intact

#### Scenario: Trash entry kind
- **WHEN** a personal template is deleted
- **THEN** the Trash lists an entry of kind `template` with the template's name and thumbnail

#### Scenario: Bundled template menu
- **WHEN** the user opens the menu of a bundled template
- **THEN** Rename and Delete are not offered and "Duplicate to My templates" is

### Requirement: Preset packs
Besides project templates, the app SHALL support preset packs (`.jcpack`) containing any of these item kinds, each stored and listed by its owning requirement:

| `kind` | Content | Appears in |
|---|---|---|
| `text-effect` | text style preset | `text-and-titles.Text effect presets` (after the bundled groups) |
| `text-template` | text template group | `text-and-titles.Text templates` |
| `text-preset` | saved text preset | `text-and-titles.Save a text preset` |
| `caption-style` | caption style | `captions-subtitles.Caption style templates` (My styles) |
| `effect-preset` | effect or filter parameter set | `visual-effects-filters.Effect and filter presets` |
| `transition-preset` | transition parameter set | `transitions.Transition presets` |
| `adjustment-preset` | colour adjustment parameter set | `color-adjustment.Adjustment presets` |
| `lut` | `.cube` file | `color-adjustment.LUT library management` |
| `font` | font file | My fonts of `text-and-titles.Import custom fonts` |
| `sticker` | sticker image | `stickers-shapes.Sticker packs` |

After import, the items of a pack SHALL appear in those libraries under a group named after the pack. Presets SHALL contain parameters and assets only and SHALL NOT contain executable code or shader source. The user SHALL be able to select personal items of any kind and "Export as pack". Imported packs are listed at `/library/presets` with name, author, licence, item count and "Remove pack", which deletes the pack's library items after confirmation and leaves projects untouched. [NEW]

#### Scenario: Import a mixed pack
- **WHEN** a pack with 5 text presets, 2 LUTs and 1 font is imported
- **THEN** the 5 presets appear in the Text tab, the 2 LUTs in the adjustment library and the font under My fonts, each under the pack's name

#### Scenario: Code is refused
- **WHEN** a pack contains a file with a shader or script extension
- **THEN** that file is not imported and the import summary lists it as refused

#### Scenario: Unknown kind
- **WHEN** a pack contains an item whose `kind` is not in the table
- **THEN** that item is skipped, listed as refused in the import summary, and the other items are imported

### Requirement: Template and pack package format
Templates and preset packs SHALL be exchanged as a single ZIP-based file with the extension `.jctpl` (project template, MIME `application/vnd.jagentchill.template+zip`) or `.jcpack` (preset pack, MIME `application/vnd.jagentchill.pack+zip`); these are the only extensions for them, and their file associations and share-sheet registration are those of `app-shell-navigation.Deep links and file types`. A package SHALL contain: `manifest.json` (as in `templates.Template data model`, or for packs `{id, name, author, license, packageVersion, appVersionMin, items[] {kind, id, name, file}}`); `project.json` (templates only); `media/` (embedded assets named by SHA-256); `fonts/`; `thumbnails/`; `preview.mp4` (templates only; limits of `templates.Template data model`: full duration up to 60 s, 720 px, at most 12 MB). The manifest SHALL list every file with its SHA-256 and byte size. Limits: package up to 2 GiB; up to 5 000 entries; a single entry up to 1 GiB; uncompressed size up to 4 GiB and at most 100× the compressed size. Fonts: bundled fonts and online-catalogue fonts SHALL be recorded by family name (and catalogue SHA-256) and never embedded; device fonts SHALL never be embedded; an imported font SHALL be embedded only when the user ticked "I have the right to redistribute this font" for it (`text-and-titles.Import custom fonts`). A family that is not embedded SHALL be resolved on the importing device through `text-and-titles.Font loading`. [NEW]

#### Scenario: Package contents
- **WHEN** a template with 3 embedded media files is exported
- **THEN** the package contains `manifest.json`, `project.json`, three files under `media/`, a thumbnail and a preview, and the manifest hashes match the files

#### Scenario: Font without the redistribution tick
- **WHEN** a template uses an imported font for which the redistribution box is not ticked
- **THEN** the package contains no file for that font and the manifest records its family name

#### Scenario: Device font
- **WHEN** a template uses a device font
- **THEN** the export summary lists it as "not included" with no option to include it

### Requirement: Import a package
Import (button in My templates and in each preset library; opening a `.jctpl` / `.jcpack` file through the desktop file association or the mobile share sheet; drag-and-drop on desktop and web) SHALL validate before writing anything, following `security-privacy.Untrusted file and pack handling`: ZIP structure; the limits above; no entry with an absolute path, `..` segment, symbolic link or name outside the allowed directories; manifest schema; every hash and size; `schemaVersion` not greater than the app's project schema (a greater version SHALL be refused with "This template was made with a newer version of the app"); a lower `schemaVersion` SHALL be migrated through `project-storage.Migration chain`. A failed validation SHALL import nothing and name the reason. When an item with the same `id` already exists, a dialog SHALL offer Replace, Keep both (new id, name suffixed " 2") or Skip. Import SHALL show progress with Cancel and SHALL be atomic and restartable: items are written to a staging area and moved into the libraries only after every item has been written, so that a cancelled, failed or interrupted import leaves no partial item, and starting the same import again begins from the first item. Import SHALL end with a summary of imported, replaced, skipped and refused items. Imported content SHALL be treated as untrusted data: SVGs SHALL be sanitised as in `stickers-shapes.Imported stickers`, and no file from a package SHALL be executed. [NEW]

#### Scenario: Valid import
- **WHEN** a valid `.jctpl` is imported
- **THEN** the template appears in My templates with its thumbnail, preview and slot count

#### Scenario: Path traversal
- **WHEN** a package contains an entry named `../../evil.js`
- **THEN** nothing is imported and the error "Package contains unsafe paths" is shown

#### Scenario: Corrupted file
- **WHEN** one media file's hash differs from the manifest
- **THEN** nothing is imported and the error names the file

#### Scenario: Newer schema
- **WHEN** the package `schemaVersion` is higher than the app supports
- **THEN** import is refused with the newer-version message

#### Scenario: Cancelled half-way
- **WHEN** the user cancels the import of a 40-item pack after 20 items were staged
- **THEN** none of the 40 items is listed in any library and the staging area is empty

#### Scenario: App killed during import
- **WHEN** the app is terminated during an import and started again
- **THEN** no item of that package is listed and the staging area is cleared at start-up

### Requirement: Export a package
"Export package" SHALL write a `.jctpl` or `.jcpack` file through the native save dialog (desktop), a download (web) or the share sheet (mobile), streaming to the destination rather than holding the whole package in memory, with progress and Cancel (a cancelled export SHALL leave no partial file). Before writing, a summary SHALL list embedded media, every font with its status ("referenced by name", "not included — device font", or an imported font with the checkbox "I have the right to redistribute this font", default unticked), and the total size; the user SHALL confirm. Bundled templates, bundled presets, the starter sticker pack and the bundled sound pack SHALL NOT be exportable. [NEW]

#### Scenario: Export and re-import
- **WHEN** a personal template is exported and imported on another device
- **THEN** the imported template renders the same frames as the original for the same slot media

#### Scenario: Cancel
- **WHEN** the user cancels at 50 %
- **THEN** no file remains at the destination

#### Scenario: Redistribution tick
- **WHEN** the user ticks the redistribution box for one imported font and exports
- **THEN** the package contains that font file under `fonts/` and its manifest entry

### Requirement: Missing resources in a template
When a template or pack references a font, effect, transition, animation or sticker that is not available on the device, using the template SHALL still work: the missing resource SHALL fall back as defined by its owning capability (`text-and-titles.Missing font and preset resources`; no effect; a hard cut instead of the transition; no animation; `stickers-shapes.Missing sticker state`), and a notice "Some items in this template are not available: {list}" SHALL be shown once when the template is opened and in `export-share.Export summary`; at export the same items are the pre-flight item `export/resource-missing` of `export-share.Pre-flight validation` (waiver `allowMissingResources`). [NEW]

#### Scenario: Unknown transition
- **WHEN** a template references a transition id that this build does not have
- **THEN** the two clips are joined with a hard cut and the notice lists the transition

### Requirement: Brand kit
The editor SHALL provide a "Brand kit" in its own asset-panel tab (tab id and label owned by `app-shell-navigation.Editor asset panel tabs`), in the More sheet and the template editor's overflow menu on mobile (`mobile-editor.More sheet`, `mobile-editor.Template editor variant`), and at `/library/brand-kits`, with: Logos (imported images, up to 20, stored like imported stickers); Colours (up to 24 named swatches); Fonts (up to 10 families chosen from bundled, imported or online-catalogue fonts, each assignable to the roles Heading, Body and Caption). The brand kit SHALL be stored per device, synced by `cross-device-sync.Library item sync`, and SHALL surface as: a "Brand" swatch row at the top of every colour picker; a "Brand" group at the top of the font picker; a "Brand" row in the Stickers tab for one-click logo insertion; and "Apply brand" in template mode (agent: `jc_template_edit {action: "apply_brand", brandKitId}`), which as one undo step (a) sets `fontFamily` of the editable text with the largest `fontSize` to the Heading font and of every other editable text to the Body font (ties for largest: the earliest by start time is the Heading), and (b) for each index i below both the number of brand colours and the number of theme colours, replaces `template.themeColors[i]` by brand colour i and writes that colour into every element field bound to index i by `template.colorBindings[] {colorIndex, elementId, field}` (`project-document.Template mode model`) — the bindings, recorded when the template was authored, are the only fields rewritten, so no colour is changed by guessing. A theme colour with no brand colour at its index, and a field with no binding, stay unchanged. A role with no font assigned leaves the affected texts unchanged. These are exactly the changes `project-document.Template lock enforcement` permits to "Apply brand". An empty brand kit SHALL show "Add your logo, colours and fonts to reuse them everywhere" and SHALL add nothing to the pickers. [CAPCUT CC-231] [NEW]

#### Scenario: Brand colours in the picker
- **WHEN** the brand kit has 3 colours and the user opens a text colour picker
- **THEN** a Brand row with those 3 swatches is shown

#### Scenario: Apply brand to a template
- **WHEN** the user presses "Apply brand" on a template with editable texts of `fontSize` 12, 6 and 4 and two theme colours
- **THEN** the size-12 text takes the Heading font, the other two take the Body font, the two theme colours are replaced by the first two brand colours, and one undo reverts all of it

#### Scenario: Bound fields follow the theme colour
- **WHEN** theme colour 0 is bound to the `color` of the title text and to `params.fill` of a rectangle, and "Apply brand" runs with brand colour 0 `#0055ff`
- **THEN** the title's `color` and the rectangle's fill are `#0055ff` and no unbound element changed colour

#### Scenario: Fewer brand colours than theme colours
- **WHEN** the brand kit has 1 colour and the template has 3 theme colours
- **THEN** only the first theme colour and its bound fields are replaced

#### Scenario: Empty kit
- **WHEN** the brand kit is empty
- **THEN** no Brand row appears in colour or font pickers
