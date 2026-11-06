## ADDED Requirements

### Requirement: Scene track layout
Every scene SHALL hold its tracks as three zones: `overlay` (ordered list, zero or more tracks), `main` (exactly one video track named "Main Track" that always exists and cannot be deleted, reordered or moved out of its zone) and `audio` (ordered list, zero or more tracks). The display order top to bottom MUST always be `[...overlay, main, ...audio]`. A non-audio track MUST NOT be placed below the main track and an audio track MUST NOT be placed above it. The number of overlay tracks and audio tracks is limited to 99 each per scene; an operation that would create track number 100 in a zone MUST be rejected as a whole with the message "Track limit reached (99)" and no undo step. [PORT T-002, T-009] [CAPCUT CC-027, CC-058]

#### Scenario: New scene has only the main track
- **WHEN** a project or scene is created
- **THEN** the scene contains zero overlay tracks, one empty main track named "Main Track" and zero audio tracks

#### Scenario: Main track cannot be removed
- **WHEN** the user opens the context menu of the main track
- **THEN** the menu contains no "Delete track" item
- **AND** a programmatic remove-track command targeting the main track leaves the scene unchanged and adds no undo step

#### Scenario: Picture-in-picture stacking
- **WHEN** a video clip is placed on an overlay video track above the main track over the same time range as a main-track clip
- **THEN** the overlay clip is composited above the main-track clip, and overlay tracks nearer the top are composited above overlay tracks nearer the main track

#### Scenario: Track limit boundary
- **WHEN** a scene has 99 overlay tracks, all occupied at 5 s, and an image is dropped at 5 s
- **THEN** no track and no element is added, the message "Track limit reached (99)" is shown and the undo stack is unchanged
- **AND** with 98 overlay tracks the same drop creates the 99th track

### Requirement: Timeline document model
The timeline SHALL read and write only the project document defined by capability `project-document`; this capability defines editing BEHAVIOUR and declares no field, type, range or default of its own. Field names used anywhere in this capability are the names of `project-document.Canonical field list`: scenes per `project-document.Scene fields`, tracks per `project-document.Track zones and types` and `project-document.Track fields` (the zone is the container `tracks.overlay` / `tracks.main` / `tracks.audio`; no `zone` field is stored), elements per `project-document.Element common fields` and `project-document.Element types and field applicability`, the transform as `transform.position.x`, `transform.position.y`, `transform.scale.x`, `transform.scale.y`, `transform.rotation` (`project-document.Transform`), keyframes in `animations` (`project-document.Animation store`), markers in `markers` (`project-document.Markers`), picture transitions and audio crossfades in the track's `transitions[]` (`project-document.Track transition records`), and the current scene and view state under `local` (`project-document.Device-local section`). Every timeline command SHALL (a) produce a document that passes `project-document.Document validator` in strict mode, or fail as a whole with no change and no undo step; (b) keep `elements[]` of each track in the canonical order of `project-document.Track and element ordering`; (c) give new entities new ids and rewrite internal references of copied sets per `project-document.Identifiers`; (d) write every non-absent default explicitly on a new element per `project-document.Absent, null and default values`; (e) carry unknown fields along with the entity that holds them through move, trim, split, duplicate and paste per `project-document.Unknown-field preservation`; (f) respect the limits of `project-document.Document size and count limits`, showing "Track limit reached (99)", "Scene limit reached (200)" or the cycle and depth messages of `timeline-editing.Compound clips` when the corresponding limit rejects a command; and (g) while `template.locked` is true, be rejected with `document/template-locked` and the toast "This project is a template draft. Choose 'Edit in full editor' to change its structure." unless the change is one that `project-document.Template lock enforcement` allows. A standalone filter is an `effect` element with one entry of `kind: "filter"` on an `effect` track; there is no `filter` element type. [PORT T-001] [NEW]

#### Scenario: New element is written with canonical fields
- **WHEN** a video asset is inserted into a schema-32 project
- **THEN** the stored element is exactly the shape of the scenario "New element writes its defaults" of `project-document.Absent, null and default values`, and it has no `params`, `keyframes` or `zone` key

#### Scenario: Standalone filter
- **WHEN** a filter is dropped on empty track area
- **THEN** the created element has `type: "effect"` with exactly one `effects` entry of `kind: "filter"`, on a track of type `effect`

#### Scenario: Unknown field moves with its element
- **WHEN** an element carrying a key this app version does not know is moved to another track and the project is saved
- **THEN** the key is still present on that element with its original value

#### Scenario: Command that would break the document is refused
- **WHEN** a command would leave two elements of one track overlapping
- **THEN** the command fails with `document/elements-overlap`, the project is unchanged and the undo stack is unchanged

#### Scenario: Template draft refuses a split
- **WHEN** the user presses the Split shortcut in a project whose `template.locked` is true
- **THEN** nothing is split and the toast "This project is a template draft. Choose 'Edit in full editor' to change its structure." is shown

### Requirement: Track types and element compatibility
The timeline SHALL support the track types `video`, `text`, `audio`, `graphic`, `effect`, `adjustment` and `caption`, and the element types `video`, `image`, `text`, `sticker`, `graphic`, `effect`, `audio` (always with a `mediaId`; `sourceType` per `project-document.Audio element`), `adjustment`, `caption` and `compound`. Element-to-track mapping MUST be strict: audio→audio track; text→text track; sticker and graphic→graphic track; effect (including an effect element of kind `filter`)→effect track; adjustment→adjustment track; caption→caption track; video, image and compound→video track. `adjustment` and `caption` tracks live only in the overlay zone. An operation that would put an element on an incompatible track MUST fail without changing the project. Capability sets: maskable = video, image, graphic, sticker, compound, adjustment (owner `masks-blending-keying.Maskable element types`); retimable = video, audio, compound, except freeze elements (owner `speed-retime.Retime data model`); hideable = every element type except audio; effect-capable = video, image, text, sticker, graphic, compound (caption elements carry `hidden` and no `effects[]`). The complete matrix of which field group exists on which element type is `project-document.Element types and field applicability`; this requirement restates none of it beyond the placement mapping above. [PORT T-001, T-003, T-004] [CAPCUT CC-027] [NEW]

#### Scenario: Image goes to a video track
- **WHEN** an image asset is inserted with automatic placement
- **THEN** it is placed on a track of type `video`

#### Scenario: Incompatible drop is refused
- **WHEN** an audio asset is dragged over a text track and released on that track row
- **THEN** no element is added to the text track
- **AND** the audio element is placed on a new or existing audio track below the main track according to `timeline-editing.Placement strategies`

#### Scenario: Caption track is separate from text track
- **WHEN** captions are generated for a scene that already has a text track
- **THEN** the caption elements are placed on a `caption` track and no caption element is placed on the `text` track

#### Scenario: Sticker is maskable
- **WHEN** a sticker element is selected
- **THEN** the mask entry of the inspector is available for it

### Requirement: Track state flags
The track flags are the fields of `project-document.Track fields`: `locked` and `pinned` on every track; `muted`, `solo`, `volume` and `pan` on video and audio tracks; `hidden` on every type except audio. This requirement owns the behaviour of `locked`, `pinned`, `hidden` and `muted`; `solo`, `volume`, `pan` and `ducking` behave as defined by `audio-editing.Track volume, pan and solo` and `audio-editing.Equaliser, compressor and ducking`. A hidden track contributes nothing to the preview and export picture; a muted track contributes nothing to the audio mix. Toggling mute or hide on a track is an undoable command; toggling solo emits a state patch and creates no undo step (`project-document.Track fields`). The header controls for a flag the track type does not support MUST NOT be rendered, and the corresponding menu items MUST be omitted (no no-op history entries). An active mute or hide icon is drawn in the destructive colour token of `design-system.Colour tokens`. [PORT T-012, T-013] [CAPCUT CC-060, CC-062]

#### Scenario: Mute a video track
- **WHEN** the user clicks the mute icon on an overlay video track header
- **THEN** all clips on the track are silent in playback and export, the icon is drawn in the destructive colour token, and one undo step is recorded

#### Scenario: Audio track has no hide control
- **WHEN** an audio track header is rendered
- **THEN** it shows a mute control and a lock control and no visibility control

#### Scenario: Undo track hide
- **WHEN** the user hides a text track and then invokes undo
- **THEN** the track is visible again in preview and its icon returns to the default colour

#### Scenario: Solo control on audio-capable tracks only
- **WHEN** the headers of a video track, an audio track and a text track are rendered
- **THEN** the video and audio headers show a solo control and the text header shows none

### Requirement: Track rename
Every track SHALL have a user-editable name. Default names are "Main Track", "Video track", "Text track", "Audio track", "Graphic track", "Effect track", "Adjustment track" and "Caption track" (localised). Rename is started by double-clicking the name in the track header, by the track context menu item "Rename track", or by the action `timeline.track.rename` with the header focused (mobile: the layers sheet of `mobile-editor.Layers sheet`). The name is trimmed, MUST be 1–64 characters, and an empty result restores the previous name. Enter or blur commits, the cancel action cancels. Rename is one undoable command and sets the track's `pinned` flag. [PORT N-005] [NEW]

#### Scenario: Rename and undo
- **WHEN** the user double-clicks the name "Video track", types "B-roll" and presses Enter
- **THEN** the header shows "B-roll" and the track's accessible label is "B-roll"
- **AND** undo restores "Video track"

#### Scenario: Empty name is rejected
- **WHEN** the user clears the name field and presses Enter
- **THEN** the previous name is kept and no undo step is recorded

#### Scenario: Length bound
- **WHEN** a 70-character name is pasted
- **THEN** the field holds the first 64 characters

### Requirement: Track lock
A locked track SHALL reject every mutation of its elements: move, trim, split, delete, paste onto it, drop onto it, ripple shift, magnet shift (including the gap closing done when the magnet is turned on), linkage shift, group move, replace and property edits made through timeline gestures. Elements on a locked track cannot be selected by click, box select or select-all, and are drawn with the locked hatch atom of `design-system.Timeline atoms`. A multi-track operation (split all, ripple, select-all, group move) skips locked tracks; a group move that includes a member on a locked track is rejected as a whole. Lock is toggled from the track header lock icon, the track context menu or the action `timeline.track-lock.toggle` (mobile: `mobile-editor.Layers sheet`) and is an undoable command. The main track can be locked. [PORT N-005] [CAPCUT CC-061]

#### Scenario: Locked clip cannot be moved
- **WHEN** a track is locked and the user presses and drags one of its clips
- **THEN** the clip does not move, is not selected and the pointer shows the not-allowed cursor

#### Scenario: Split all skips locked tracks
- **WHEN** three tracks have clips under the playhead, one of them is locked, and the user invokes "Split all"
- **THEN** the clips on the two unlocked tracks are split and the clip on the locked track is unchanged

#### Scenario: Drop on locked track
- **WHEN** an asset is dragged over a locked compatible track
- **THEN** the drop indicator shows a new-track line above or below the locked track (by hover half) and the element is placed on a new track

### Requirement: Track reorder within a zone
The user SHALL be able to reorder overlay tracks among overlay tracks and audio tracks among audio tracks by dragging a track header vertically (drag threshold 5 px; on touch through the layers sheet of `mobile-editor.Layers sheet`) or with the actions `timeline.track.move-up` and `timeline.track.move-down` (context menu items "Move track up" and "Move track down"; bindings in `keyboard-shortcuts`). A 2 px horizontal insertion line in the primary colour token shows the target index. A track cannot cross the main track; a drop target outside its zone is clamped to the nearest valid index in its zone. Reorder is one undoable command and changes compositing order for overlay tracks. [PORT N-005] [NEW]

#### Scenario: Reorder overlay tracks
- **WHEN** the user drags the header of overlay track at index 2 above the track at index 0 and releases
- **THEN** the dragged track is at index 0, its clips composite above all other overlay tracks, and undo restores the original order

#### Scenario: Clamp at the main track
- **WHEN** the user drags an overlay track header below the main track and releases
- **THEN** the track is placed directly above the main track

#### Scenario: Move up at the zone limit
- **WHEN** `timeline.track.move-up` is invoked on the first overlay track
- **THEN** nothing changes and no undo step is recorded

### Requirement: Track creation and insert index
Tracks SHALL be created automatically when an element is inserted, pasted, dropped or moved and no existing compatible track is free, and explicitly through "Add track" in the timeline toolbar menu and the track context menu (type chosen from the seven track types). New-track index rules: with the default rule, an audio track goes after the last audio track, an effect or adjustment track goes to overlay index 0 (top), a caption track goes to overlay index 0 above effect and adjustment tracks, and every other type goes to `overlay.length` (directly above main); with the "highest" rule, an audio track goes to the first audio slot (directly below main) and every other type goes to overlay index 0. Any requested index is clamped to the track's zone, and creation is subject to the 99-track limit of `timeline-editing.Scene track layout`. A track created together with an element (drop, paste, move, duplicate) forms one undo step with that element change. [PORT T-006, T-007]

#### Scenario: First audio insert
- **WHEN** an audio asset is inserted into a scene without audio tracks
- **THEN** a new audio track is created directly below the main track containing the element, and one undo removes both

#### Scenario: Effect track goes to the top
- **WHEN** an effect is dropped on an empty area of a scene that has two overlay tracks
- **THEN** a new effect track is created at overlay index 0

#### Scenario: Text track default index
- **WHEN** a text element is inserted and no text track is free
- **THEN** the new text track is inserted directly above the main track

### Requirement: Empty track pruning and persistent tracks
After every command execute and redo, the editor SHALL remove every empty overlay and audio track whose `pinned` and `locked` flags are both false. `pinned` is set to true when a track is created through "Add track" and when it is renamed, and is never changed by locking or unlocking; a locked empty track is kept because it is locked, and when it is unlocked while empty and not pinned, the unlock command prunes it in the same undo step. Pinned empty tracks persist and are removed only by "Delete track". The main track is never pruned. Every empty track row — the main track and pinned tracks alike — renders a dashed 1 px placeholder border in the border colour token across the row. Pruning is part of the triggering command's undo step. [PORT T-008, T-018] [NEW]

#### Scenario: Auto-created track disappears with its last clip
- **WHEN** the only clip on an auto-created overlay track is deleted
- **THEN** the track is removed in the same undo step, and undo restores both the track and the clip

#### Scenario: Explicitly added track persists
- **WHEN** the user chooses "Add track → Text"
- **THEN** an empty text track with `pinned = true` and a dashed placeholder appears directly above the main track and remains after any subsequent command

#### Scenario: Empty main track in a new project
- **WHEN** a new project is opened
- **THEN** the main track row shows the dashed placeholder border

#### Scenario: Pinned survives a reload
- **WHEN** a project with an empty renamed track is closed and reopened
- **THEN** the track is still present

#### Scenario: Unlocking an empty auto-created track prunes it
- **WHEN** an auto-created overlay track is locked, its last clip is removed by a scene-level command, and the track is then unlocked
- **THEN** the track stays while locked, is removed by the unlock command, and one undo restores it locked and empty

### Requirement: Track header column and row dimensions
This requirement owns the timeline geometry that behaviour depends on; appearance (fills, strokes, opacities, handle and flag shapes) comes from `design-system.Timeline atoms` and `design-system.Editor colour tokens`, and no literal colour is stated here. On desktop and web the timeline SHALL render a track header column 136 px wide showing, per track, left to right: type icon (16 px), name (truncated with an ellipsis, full name in the tooltip), then 20 px icon buttons — mute and solo (video and audio tracks), visibility (every type except audio), lock — and, on video and audio tracks, a disclosure button that opens a popover holding the volume and pan sliders of `audio-editing.Track volume, pan and solo` (the popover is the only place for those two sliders in the header; rows keep their height); the main-track header additionally shows a "Cover" button 40 px wide that opens `projects.Cover editor`. Row heights: video tracks (including compound-bearing tracks) 65 px; audio tracks 50 px; text, graphic, effect, adjustment and caption tracks 25 px; gap between rows 6 px; ruler height 22 px; marker row height 16 px; marker flag 12 × 15 px; keyframe lane height 20 px; content top padding 2 px; scrollbar thickness 12 px; playhead line 2 px with a 12 px round handle; trim handles 8 px wide; keyframe diamond hit size 14 px. Rows and headers of tracks that contain at least one selected element are filled with the accent colour token at 50 % opacity. All positions are rounded to the device-pixel grid. On mobile (iOS and Android) there is no header column: every track control of this requirement (rename, hide, lock, mute, solo, volume, pan, reorder) is in the "Tracks" tab of `mobile-editor.Layers sheet`, and row heights are: main track 56 pt, overlay video 40 pt, audio 32 pt, all bar-type tracks 24 pt; touch values (trim handle width and hit target, long-press time, drag travel, snap threshold) are owned by `mobile-editor.Touch gesture constants`. [PORT T-011, T-016, T-017, T-109] [NEW]

#### Scenario: Row heights
- **WHEN** a desktop timeline shows one text track, the main track and one audio track
- **THEN** their row heights are 25 px, 65 px and 50 px with 6 px gaps

#### Scenario: Selected-track highlight
- **WHEN** an element on an overlay track is selected
- **THEN** that track's row and header are highlighted and no other row is highlighted

#### Scenario: Cover button
- **WHEN** the user activates "Cover" in the main-track header
- **THEN** the cover editor of `projects.Cover editor` opens

#### Scenario: Mobile rows
- **WHEN** a phone timeline shows the main track, one overlay video track, one audio track and one text track
- **THEN** their row heights are 56, 40, 32 and 24 pt

#### Scenario: Header controls of an audio track
- **WHEN** a desktop audio track header is rendered at 136 px
- **THEN** it shows the type icon, the name, mute, solo, lock and the volume/pan disclosure, and no visibility control

### Requirement: Overlap rule
Within one track, elements MUST NOT overlap. Overlap is evaluated on half-open intervals: two elements overlap when `startA < endB && endA > startB`; touching edges are allowed. Every placement, move, paste, trim and retime MUST be validated against the final adjusted position (after main-track start adjustment and snapping), never against the pre-adjustment position. [PORT T-005]

#### Scenario: Touching edges are legal
- **WHEN** a clip ending at tick 600000 has another clip dropped starting at tick 600000 on the same track
- **THEN** the drop is accepted on that track

#### Scenario: Overlap after adjustment is re-checked
- **WHEN** an element is placed on the main track with magnet off at a start that is adjusted to 0 and the adjusted interval intersects an existing clip
- **THEN** the element is not placed on the main track and is placed according to the fallback of the active placement strategy

### Requirement: Placement strategies
Element placement SHALL be resolved by one of seven strategies: `explicit` (target track id; fails when the track is missing, of the wrong type, locked, or would overlap), `firstAvailable` (first compatible unlocked track in display order with no overlap, the main track counting for video, image and compound; otherwise a new track at the "highest" index), `preferIndex` (the hovered track when compatible, unlocked and free; otherwise a new track above or below chosen by the hovered half of the row, or by vertical drag direction when the hovered track is of an incompatible type), `aboveSource` (the track directly above the source when same type, unlocked and free; else first available; else new at highest), `alwaysNew`, `mainFirst` (video, image and compound items only: the main track when it is unlocked and free for the item's whole range at the requested time; else the overlay video track nearest the main track — the highest index in `tracks.overlay` — that is unlocked and free for that range; else a new overlay video track inserted at `overlay.length`, directly above the main track; identical to rule (c) of `timeline-editing.Free layer mode`), and `mainInsert` (video, image and compound items only: the item is inserted into the main track at the cut nearest the playhead — at the end of the clip under the playhead when the playhead is at or past that clip's midpoint, otherwise at its start; at tick 0 on an empty main track; at the track end when the playhead is beyond the last clip — and every main-track clip from that cut onward shifts right by the inserted duration, with attached and linked elements following per `timeline-editing.Linkage`; several items are inserted back to back in the given order; it fails when the main track is locked). **Click-to-add rule:** every add that is not a drag — the "+" button and double-click on a library item on desktop and web, the main-track "+" and the new-project picker on mobile, paste of system-clipboard media, and "+" on stock items — uses `mainInsert` for video, image and compound items while the main track magnet is on, and `mainFirst` at the playhead while the magnet is off or Free layer mode is on; audio, text, sticker, graphic, effect and adjustment items always use `firstAvailable` at the playhead. While the magnet is on, an item becomes an overlay only through an Overlay action ("Add as overlay" in `media-library.Add to timeline from the library`, the mobile Overlay group, "To overlay" on a clip) or by a drag onto an overlay track; while the magnet is off or Free layer mode is on, click-to-add additionally creates an overlay exactly when `mainFirst` finds the main track occupied at the playhead. Default durations for elements without an intrinsic duration come from `settings-preferences.Editing default preferences`: image — the "Default still-image duration" preference (factory value 5 s, 600000 ticks); text — the "Default text duration" preference (factory value 3 s, 360000 ticks); sticker and graphic — the "Default sticker and graphic duration" preference (`editing.defaultStickerDuration`, factory value 5 s, 600000 ticks); effect and adjustment — the "Default effect and adjustment duration" preference (`editing.defaultEffectDuration`, factory value 5 s, 600000 ticks). The inserted element becomes the selection. Insertion validates its references (media id, sticker id, registered graphic definition, registered effect type) and fails with no change when a reference is invalid; empty text content is accepted for user insertion, while agent-tool insertion of text additionally requires non-empty content. [PORT T-006, T-019] [CAPCUT CC-018, CC-038]

#### Scenario: preferIndex falls to a new track
- **WHEN** an image is dropped on the upper half of an overlay video track that is occupied at the drop time
- **THEN** a new video track is created directly above the hovered track and holds the image

#### Scenario: mainInsert before the midpoint
- **WHEN** the magnet is on, the main track holds clips at 0–6 s and 6–10 s, the playhead is at 2 s and a 4 s video is added with "+"
- **THEN** the new clip occupies 0–4 s, the other clips occupy 4–10 s and 10–14 s, and one undo restores the previous state

#### Scenario: mainInsert past the midpoint
- **WHEN** the same add is made with the playhead at 4 s
- **THEN** the new clip occupies 6–10 s and the second clip moves to 10–14 s

#### Scenario: mainInsert beyond the end
- **WHEN** the playhead is at 30 s and the main track ends at 10 s
- **THEN** the new clip starts at 10 s

#### Scenario: Click-to-add never creates an overlay with the magnet on
- **WHEN** the magnet is on and a video is added with "+" while the playhead is inside a main-track clip
- **THEN** the scene has the same number of overlay tracks as before

#### Scenario: Default durations
- **WHEN** a text element and a sticker are added with factory preferences
- **THEN** the text element lasts exactly 360000 ticks, the sticker exactly 600000 ticks, and each is selected when added

#### Scenario: Locked main track
- **WHEN** the main track is locked and a video is added with "+" while the magnet is on
- **THEN** nothing is inserted and the toast "The main track is locked" is shown

#### Scenario: mainFirst uses the main track when it is free
- **WHEN** the magnet is off, the main track is free from 10 s onward, the playhead is at 12 s and a 4 s video is added with "+"
- **THEN** the clip is placed on the main track at 12–16 s and no track is created

#### Scenario: mainFirst creates an overlay directly above the main track
- **WHEN** the magnet is off, the main track holds a clip at 0–10 s, the scene has one overlay text track, the playhead is at 3 s and a 4 s video is added with "+"
- **THEN** a new overlay video track is created at index `overlay.length` (directly above the main track, below the text track) and holds the clip at 3–7 s

#### Scenario: firstAvailable for a non-main item
- **WHEN** a text item is added with "+" at a time where the only text track is occupied
- **THEN** the text element is placed on a new text track at the "highest" index of `timeline-editing.Track creation and insert index`

### Requirement: Frame-accurate positions and scene duration
All element start times, durations, trims, marker times, playhead positions and split points SHALL be integer ticks (120000 per second) rounded to the nearest project frame boundary (half away from zero); source bounds take precedence over frame alignment when the two conflict. No element starts before tick 0. Scene duration is the maximum element end across all tracks of the scene (0 for an empty scene); project duration is the duration of the main scene. [PORT T-020, T-082]

#### Scenario: Drop is frame-rounded
- **WHEN** an asset is dropped at pointer time 1.017 s in a 30 fps project
- **THEN** the element start is 124000 ticks (frame 31)

#### Scenario: Duration follows the last end
- **WHEN** the element with the greatest end time is trimmed to end 2 s earlier
- **THEN** the scene duration decreases by 240000 ticks and the playhead is clamped to the new duration

### Requirement: Magnetic main track
The timeline SHALL provide a "Main track magnet" toggle (toolbar button and action `timeline.magnet.toggle`), default on, stored as the preference `timeline.magnet`. The magnet is a member of the `EditContext` of `timeline-editing.Command system`: a command applies the magnet rule exactly when it is executed with `magnet: true`, whichever device or host principal executes it. The magnet rule is local to the edit: a command executed with the magnet on that inserts, removes, lengthens or shortens main-track content at time `t` MUST shift every main-track element that starts at or after `t` by the signed change of occupied duration at `t`, inside the same undo step, so that the command itself creates neither a gap nor an overlap; and a main-track element placed before the first existing element starts at tick 0. Gaps that existed before the command keep their length and are never closed as a side effect. On a main track that is contiguous from tick 0 this keeps the track contiguous from tick 0. With the magnet on: inserting or dropping onto the main track inserts at the nearest cut boundary to the drop time and shifts following clips right by the inserted duration; deleting a clip closes the gap; trimming either edge shortens or lengthens the clip and shifts following clips so no gap or overlap results; dragging a main-track clip horizontally reorders it, with a 2 px vertical insertion line at the target boundary. **Turning the magnet on closes existing gaps at once (decision E5, as CapCut does).** When the toggle goes from off to on — by the toolbar button, the action, or on mobile by turning Free layer off — and the active scene's unlocked main track has a gap or does not start at tick 0, the editor executes in the same gesture one undoable command, named "Close gaps" in the undo history, that moves every main-track element of the active scene left so the track is edge to edge from tick 0, with the linkage shifts of `timeline-editing.Linkage`; undoing it restores the gaps and leaves the magnet on. When there is nothing to close, turning the magnet on changes no data and adds no undo step; turning it off never changes data and is not an undo step. There is no "Close gaps" badge, menu entry, palette command or action id: the toggle is the only control. Opening a project or activating a scene compacts nothing and writes no revision, also when the stored preference is on: a main track that arrives with gaps (a classic or imported project, a package, a project edited elsewhere in Free layer mode) keeps them until the magnet is turned off and on again in that scene, and the magnet button's tooltip then reads "Main track magnet — on. Turn off and on to close the gaps on this track". Other scenes are compacted only when the magnet is turned on while they are active. While the magnet is off, gaps are allowed on the main track, the overlap rule applies, and the classic start rule holds: when the main track has no other element, or the requested start is at or before the earliest other element's start, the start is forced to 0. A locked main track is never compacted: turning the magnet on while it is locked moves nothing, and the button's tooltip reads "Unlock the main track to close its gaps". On mobile the magnet has no switch: it is on whenever Free layer mode is off and off whenever it is on. [PORT T-010] [CAPCUT CC-038, CC-047]

#### Scenario: Delete closes the gap
- **WHEN** the magnet is on and the second of three main-track clips (durations 4 s, 3 s, 5 s) is deleted
- **THEN** the third clip starts at 4 s, the main track has no gap, and one undo restores all three clips at 0 s, 4 s and 7 s

#### Scenario: Reorder by drag
- **WHEN** the magnet is on and the first main-track clip is dragged past the midpoint of the third clip and released
- **THEN** the order becomes second, third, first with all clips contiguous from tick 0

#### Scenario: Magnet off keeps gaps
- **WHEN** the magnet is off and the middle main-track clip is deleted with ripple mode off
- **THEN** the gap remains and no other clip moves

#### Scenario: First clip snaps to zero with magnet off
- **WHEN** the magnet is off, the main track is empty and a clip is dropped on it at 3 s
- **THEN** the clip starts at tick 0

#### Scenario: Turning the magnet on closes the gaps
- **WHEN** the magnet is off, the main track holds clips at 0–4 s and 6–9 s, and the magnet is turned on
- **THEN** the second clip moves to 4–7 s at once through one undo step named "Close gaps", no badge and no separate "Close gaps" control is shown, and undoing restores 6–9 s with the magnet still on

#### Scenario: Turning the magnet on with nothing to close
- **WHEN** the magnet is off, the main track is contiguous from tick 0, and the magnet is turned on
- **THEN** no element moves and the undo stack is unchanged

#### Scenario: Locked main track is not compacted
- **WHEN** the main track is locked and holds a gap, and the magnet is turned on
- **THEN** no element moves and the button's tooltip reads "Unlock the main track to close its gaps"

#### Scenario: An old gap survives an unrelated edit
- **WHEN** the magnet is on, the main track holds clips at 0–4 s, 6–9 s and 9–12 s, and the third clip's right edge is trimmed to 11 s
- **THEN** the gap at 4–6 s is still there and only the third clip changed

#### Scenario: Delete before an old gap
- **WHEN** the magnet is on, the main track holds clips at 0–4 s, 4–6 s and 8–10 s, and the second clip is deleted
- **THEN** the third clip moves to 6–8 s (shifted by the removed 2 s) and the 2 s gap before it keeps its length

#### Scenario: Opening a project with gaps
- **WHEN** an imported classic project whose main track has gaps is opened with the magnet preference on
- **THEN** no element moves, no revision is created and no badge is shown; turning the magnet off and on closes the gaps as one undo step

### Requirement: Free layer mode
The timeline SHALL provide Free layer mode, the preference `timeline.freeLayer` (default off; a row in `settings-preferences.Editing default preferences`, a switch in `mobile-editor.More sheet` and the action `timeline.toggle-free-layer`; no desktop toolbar button), in which the main track behaves as a free layer. While Free layer is on: (a) the Main track magnet is forced off, its toolbar button is disabled with the tooltip "Off while Free layer is on", and the stored `timeline.magnet` value is kept and applies again when Free layer is turned off; (b) main-track clips keep any start time ≥ 0, gaps are allowed, the classic force-to-0 start rule does not apply, and nothing is compacted; (c) inserting, dropping, pasting or moving a video, image or compound element onto a main-track range that is occupied never rejects and never ripples: the incoming element is placed at the requested time on the first overlay video track directly above the main track that is free there, else on a new overlay video track at `overlay.length` (directly above main), in the same undo step; (d) click-to-add uses `mainFirst` at the playhead (`timeline-editing.Placement strategies`), which gives the same result as (c); (e) in a main-track gap the canvas shows the project default background (`projects.Background colour and gradient`) and overlay elements over the gap still render; (f) Ripple editing and Linkage keep working as on any other track. Turning Free layer on changes no data and is not an undo step; turning it off with the magnet stored on turns the magnet on again, which closes the existing gaps of the active scene's main track at once as the one undoable "Close gaps" step of `timeline-editing.Magnetic main track` (decision E5), and turning it off with the magnet stored off changes no data. Free layer is the `freeLayer` member of the `EditContext` of `timeline-editing.Command system`; a command executed with `freeLayer: true` behaves as (b)–(d) whatever the device preference of another device says. The mode applies on every platform; on mobile it is the only state in which the main track accepts gaps. [CAPCUT CC-280] [NEW]

#### Scenario: Overlap creates an overlay
- **WHEN** Free layer is on, the main track holds a clip at 0–10 s and a 4 s video is dropped on the main track at 3 s
- **THEN** the dropped clip is at 3–7 s on a new overlay video track directly above the main track, the main-track clip is unchanged, and one undo removes the clip and the track

#### Scenario: Gap shows the background
- **WHEN** Free layer is on, the main track holds clips at 0–4 s and 6–9 s and the project default background is `sw-red`
- **THEN** the frame at 5 s is `#E5383B` and deleting nothing closes the gap

#### Scenario: Magnet button
- **WHEN** Free layer is turned on while the magnet is on
- **THEN** the magnet button is disabled with the tooltip "Off while Free layer is on" and the main track is no longer compacted after edits

#### Scenario: Turning Free layer off
- **WHEN** Free layer is turned off with the stored magnet value on and the main track has a gap at 4–6 s
- **THEN** the magnet button is enabled and on, the gap is closed at once as one undo step named "Close gaps", and undoing restores the gap

#### Scenario: Free main-track start
- **WHEN** Free layer is on, the main track is empty and a clip is dropped on it at 3 s
- **THEN** the clip starts at 3 s

### Requirement: Per-clip canvas background
A video, image or compound element on the main track SHALL be able to carry the optional `background` field of `project-document.Per-clip canvas background field` (a value of `project-document.Canvas background union`); an absent field means the project default. The canvas background is resolved ONLY in the scene being presented — the root scene of a render, or a compound scene whose `compoundBackground` is `"own"` (`project-document.Compound background rule`) — and for every frame in this order: the `background` of the main-track element that covers the frame, else the project default background; for a main-track `compound` element the resolved background is the compound element's own `background`, else the project default, and never a background from inside the referenced scene. `blur` always blurs the picture of the main-track element at that frame (so each clip gets its own blur; for a compound element it blurs the compound's texture). During a transition between two main-track clips each side is rendered over its own resolved background and the transition shader combines the two full pictures, so a slide or wipe moves each background with its clip (`render-engine.Background nodes`, `render-engine.Transition nodes`); the backgrounds are not cross-faded separately. `background` overrides of elements moved into a compound scene by "Create compound clip" are kept in the data and ignored while that scene is rendered as a compound source with `compoundBackground: "none"`. The background is edited with the Background editor of `projects.Background colour and gradient` shown for the selected main-track clip — on desktop and web in the inspector location defined by `preview-canvas.Inspector structure per element type`, on mobile from the root toolbar "Background" entry of `mobile-editor.Root toolbar`, which targets the main-track clip under the playhead; with no main-track clip selected or under the playhead the same editor edits the project default. The editor shows "Use project background" (removes the override) and "Apply to all": Apply to all writes the shown value to the project default and removes the `background` override from every main-track element of every scene, as one undo step, after which every clip shows that background. Live drags preview through the preview layer and commit one undo step. The field is kept by split (both halves), duplicate, copy/paste and replace media; it is ignored (kept in the data, not rendered and not editable) while the element sits on an overlay track, and takes effect again when the element returns to the main track. A `background` of kind `image` whose asset is removed renders `#000000` per `projects.Background blur and image`. [CAPCUT CC-008, CC-009, CC-010, CC-011] [NEW]

#### Scenario: Two clips, two backgrounds
- **WHEN** a 16:9 project holds two portrait main-track clips, the first with `background` blur 200 and the second with `background` colour `#FFFFFF`
- **THEN** frames of the first clip show its own blurred picture left and right of it, and frames of the second show white there

#### Scenario: Apply to all
- **WHEN** the second clip is selected and "Apply to all" is chosen
- **THEN** the project default background is `#FFFFFF`, no main-track element has a `background` override, every frame shows white behind the clips, and one undo restores the previous default and both overrides

#### Scenario: No clip selected
- **WHEN** nothing is selected, the playhead is in a main-track gap and the Background editor sets Blur
- **THEN** the project default background is `{kind: "blur"}` and no element gains a `background` field

#### Scenario: Split keeps the override
- **WHEN** a main-track clip with a colour override is split
- **THEN** both halves carry the same `background`

#### Scenario: Moved to an overlay
- **WHEN** a main-track clip with a blur override is moved to an overlay track
- **THEN** the canvas behind it shows the background resolved from the main track, the Background editor is not offered for it, and moving it back to the main track shows its blur again

#### Scenario: Slide transition carries each background
- **WHEN** two main-track clips with `background` colours `#ff0000` and `#0000ff` are joined by a "Slide left" transition and the frame at eased progress 0.5 is rendered
- **THEN** the left half of the frame shows the second clip over blue and the right half shows the first clip over red, with no purple blend of the two backgrounds anywhere

#### Scenario: Background inside a compound is ignored
- **WHEN** a main-track clip with `background {kind: "color", color: "#ffffff"}` and a title are made into a compound clip
- **THEN** the element inside the new scene still stores that `background`, the compound texture is transparent around the clip, and the canvas behind the compound element shows the project default until the compound element is given its own `background`

### Requirement: Linkage
The timeline SHALL provide a "Linkage" toggle (toolbar and action `timeline.linkage.toggle`), default on, stored as the preference `timeline.linkage`, not undoable; a command applies linkage exactly when it is executed with `linkage: true` in the `EditContext` of `timeline-editing.Command system`. While linkage is on, each element on an unlocked non-main track is attached to the main-track clip whose half-open interval contains the element's start time; elements starting at or after the main track's end are unattached. When a main-track clip's start changes by Δ through the magnet rule, the gap closing done when the magnet is turned on, reorder, ripple or move, every attached element shifts by the same Δ within the same undo step. When the shifted position overlaps on its own track the attached element is moved to the first available compatible track, else a new track. While linkage is off, edits to the main track never move elements on other tracks. Attachment is recomputed from the document before every command and is never stored. Elements attached to a main-track clip that is deleted, cut or moved to an overlay track keep their own start time (after the command they are attached to whichever main-track clip then covers that time, or to none); elements attached to a clip that is reordered or shifted move with it; an attached element on a locked track does not move and does not block the command. [CAPCUT CC-049]

#### Scenario: Attached title follows its clip
- **WHEN** linkage and magnet are on, a text element starts 1 s into the third main-track clip, and the first main-track clip (4 s long) is deleted
- **THEN** the text element starts 4 s earlier and is still 1 s into the same clip

#### Scenario: Linkage off
- **WHEN** linkage is off and the same deletion is performed
- **THEN** the text element's start time is unchanged

#### Scenario: Deleting the clip leaves its attached title in place
- **WHEN** linkage and magnet are on, a text element starts at 5 s, 1 s into the second main-track clip (4–8 s), and that second clip is deleted
- **THEN** the text element still starts at 5 s and is now attached to the clip that moved into 4 s onward

### Requirement: Video and audio linking
This requirement owns the `linkId` semantics; creating and removing the extracted audio element is owned by `audio-editing.Extract audio from video` and `audio-editing.Recover audio into video`, which assign and clear the shared `linkId` (the timeline toolbar and context menu entries "Extract audio" / "Recover audio" are enabled when at least one selected video element has enabled, respectively disabled, source audio). A linked pair is one `audio` element plus one `video`, `compound` or `text` element (`project-document.Element common fields`): a video or compound with its extracted audio, or a text element with the speech generated from it by `text-and-titles.Text-to-speech hand-off`, which assigns the shared `linkId` when it places the audio element. Every rule below applies to both kinds of pair, except that retime of a text member is not available and retime of the speech member does not change the text. While two elements share a `linkId` (linked) they SHALL edit together: selecting one selects both; Alt/Option-click selects a single member without the other; move, trim, split, delete, duplicate and retime applied to one apply to the other with identical time deltas, in the same undo step; a split gives the left halves one `linkId` and the right halves a new shared `linkId`; copy/paste and duplicate give the copies a new shared `linkId`. A linked member on a locked track blocks the linked edit as a whole. "Unlink" clears the `linkId` on both so they edit independently. "Link" is enabled for exactly one unlinked video and one unlinked audio element that reference the same media id and overlap in time, and for exactly one unlinked text and one unlinked audio element that overlap in time, and sets a shared `linkId` without moving either. Link and Unlink are each one undo step. Linked elements show the linked badge of `design-system.Timeline atoms`. `audio-editing` defines no linking rule of its own and refers to this requirement. [PORT T-083, T-084] [CAPCUT CC-051]

#### Scenario: Linked move
- **WHEN** a video clip linked to its extracted audio is dragged 1 s to the right
- **THEN** the linked audio element also moves 1 s to the right in the same undo step

#### Scenario: Single member selection
- **WHEN** the user Alt/Option-clicks the audio member of a linked pair
- **THEN** only the audio element is selected

#### Scenario: Linked split
- **WHEN** the video member is split at 4 s
- **THEN** the audio member is split at 4 s, the two left halves share one `linkId` and the two right halves share another

#### Scenario: Unlinked edit
- **WHEN** the pair is unlinked and the audio element is deleted
- **THEN** the video element is unchanged

#### Scenario: Link needs the same media and an overlap
- **WHEN** a video and an audio element of different media ids are selected, or of the same media id without any overlap in time
- **THEN** "Link" is disabled

#### Scenario: Text and its generated speech move together
- **WHEN** a text element linked to its text-to-speech audio is dragged 2 s to the right
- **THEN** the audio element moves 2 s to the right in the same undo step, and deleting the text element deletes the audio element with it

### Requirement: Click selection
The editor SHALL have one active selection scope at a time — timeline and preview elements, media-library items, or the Scenes sheet; making a selection in one scope clears the selection of the previous scope, and Delete, Copy, Cut, Duplicate and Select all act on the active scope (`media-library.Library selection` references this rule). Within the timeline scope: a primary click (mobile: tap) on an element of an unlocked track selects only that element; a plain click on the sole selected element only clears the keyframe selection. Cmd/Ctrl-click or Shift-click toggles the element in the selection on pointer down. A secondary click on an unselected element selects it first; a secondary click on a selected element keeps the multi-selection. Selecting elements clears keyframe and mask-point selections. The selection state holds `selectedElements`, `selectedKeyframes` with an anchor, and `selectedMaskPoints`; the active selection kind is mask points, then keyframes, then elements. Selected elements show the 2 px `timeline/selection` outline of `design-system.Timeline atoms` and trim handles. Selection changes are not undoable. [PORT T-030, T-031, T-131]

#### Scenario: Toggle with a modifier
- **WHEN** clip A is selected and the user Ctrl-clicks clip B, then Ctrl-clicks clip A
- **THEN** only clip B is selected

#### Scenario: Context click keeps the multi-selection
- **WHEN** three clips are selected and the user right-clicks one of them
- **THEN** all three remain selected and the context menu shows "Delete 3 elements"

#### Scenario: Scope change
- **WHEN** two library assets are selected and the user clicks a timeline clip
- **THEN** the clip is selected, the library selection is empty, and Delete removes the clip only

### Requirement: Box selection
A drag starting on empty track area, the tracks container background or the gutter below the tracks SHALL start a marquee after more than 5 px of movement. Elements on unlocked tracks whose time-rectangles intersect the marquee (using base row height, ignoring expanded keyframe lanes) become the selection; with Shift, Ctrl or Cmd held at drag start the hits are added to the existing selection. The marquee is a 1 px border in the primary colour token with a 10 % fill of the same token. On mobile there is no marquee; multi-selection uses the tool defined in `mobile-editor.Selection, trim handles and clip badges`. [PORT T-032, T-033]

#### Scenario: Replace by marquee
- **WHEN** one clip is selected and the user drags a marquee over two other clips without modifiers
- **THEN** exactly those two clips are selected

#### Scenario: Additive marquee
- **WHEN** one clip is selected and the user Shift-drags a marquee over two other clips
- **THEN** three clips are selected

#### Scenario: Below threshold is a click
- **WHEN** the pointer moves 4 px on empty track area and is released within 500 ms
- **THEN** no marquee appears, the selection is cleared and the playhead seeks to the click time

### Requirement: Selection commands
The editor SHALL provide these selection actions, each exposed to `keyboard-shortcuts` and the timeline menu: "Select all" (every element on unlocked tracks of the active scene), "Deselect all", "Select all before playhead" (every element whose end ≤ playhead time, plus elements under the playhead), "Select all after playhead" (every element whose start ≥ playhead time, plus elements under the playhead), "Select previous clip" and "Select next clip" (the nearest element on the same track as the current single selection; with no selection, the nearest main-track clip to the playhead). The cursor-mode dropdown offers "Select leftward" and "Select rightward" modes in which a click at time t selects every element on unlocked tracks ending at or before t, or starting at or after t, respectively. The registry actions for "Select all" and "Deselect all" are `selection.all` and `selection.none`. [PORT T-034] [CAPCUT CC-035]

#### Scenario: Select all after playhead
- **WHEN** the playhead is at 10 s and the scene has clips at 0–5 s, 8–12 s and 15–20 s
- **THEN** "Select all after playhead" selects the 8–12 s and 15–20 s clips

#### Scenario: Select all with an empty scene
- **WHEN** the scene has no elements and Select all is invoked
- **THEN** the selection stays empty and no error is shown

### Requirement: Layered cancel and empty-area click
The cancel action (`editor.cancel`; binding in `keyboard-shortcuts`) SHALL first cancel any in-flight gesture (drag, trim, marquee, marker drag, keyframe drag, blade preview), restoring the pre-gesture state with no undo step; when no gesture is active it clears one selection level per invocation in the order mask points, keyframes, elements. A click on empty track area, the ruler, the marker row or the gutter (movement ≤ 5 px, duration ≤ 500 ms, not during a marquee) clears the selection and seeks to the clicked time; a click on the track header column clears the selection without seeking. [PORT T-035, T-036]

#### Scenario: Cancel during a drag
- **WHEN** the user is dragging a clip and invokes the cancel action
- **THEN** the clip returns to its original position and track, and the undo stack is unchanged

#### Scenario: Cancel peels one level
- **WHEN** an element with two selected keyframes is selected and the cancel action is invoked twice
- **THEN** the first invocation clears the keyframe selection and the second clears the element selection

### Requirement: Cursor modes
The desktop and web timeline toolbar SHALL offer a cursor-mode dropdown with "Select" (default), "Split" (blade), "Select leftward" and "Select rightward". In Split mode the pointer over a clip shows a 1 px vertical cut-preview line (snapped per `timeline-editing.Snapping`) and a click splits the clip under the pointer at that time; with Shift held the click splits every clip on unlocked tracks at that time. The mode persists until changed and resets to Select when the project is closed. Mobile has no cursor modes; split is performed at the fixed-centre playhead. The mode actions are `tools.select`, `tools.blade`, `timeline.cursor.select-left` and `timeline.cursor.select-right`. [CAPCUT CC-031]

#### Scenario: Blade click
- **WHEN** Split mode is active and the user clicks a clip at 3.5 s
- **THEN** the clip is split at the frame nearest 3.5 s, the mode stays Split, and one undo step is recorded

#### Scenario: Blade outside a clip
- **WHEN** Split mode is active and the user clicks empty track area
- **THEN** nothing is split and the playhead seeks to the click time

### Requirement: Moving elements
Dragging an element SHALL start a move after 5 px of pointer travel; on touch the long-press time and travel are those of `mobile-editor.Touch gesture constants`, with the gesture of `mobile-editor.Long-press reorder and move`. Releasing within the threshold of the origin cancels the move. Dragging a selected element moves the whole selection, each member keeping its time offset from the anchor. Target time = pointer time minus grab offset, clamped so no member starts before 0, rounded to a frame, then snapped. On an existing-track target the anchor goes to the hovered track and the other members go to the nearest unused compatible track above or below, preserving vertical order; the move is rejected (elements return, no undo step) when members would overlap each other or stationary elements and no new-track fallback applies. When the existing-track move is invalid or the drop target is a new-track zone, one new track per member is created as a contiguous block and a 2 px horizontal drop line in the primary colour token marks the insert index; a group mixing audio and non-audio members cannot move to new tracks and is rejected. Dragging a video, image or compound element between the main track and an overlay video track is allowed (the clip actions "To overlay" and "To main track" perform the same move without a drag: to the first free overlay video track at the same time, respectively into the main track with `mainInsert`). While dragging, the dragged elements follow the pointer, are drawn above all other elements, and the scene preview is not changed; the commit happens on release as one undo step that includes any created tracks, and the moved elements stay selected. [PORT T-037, T-038, T-039, T-040, T-041, T-042] [CAPCUT CC-059]

#### Scenario: Sub-threshold drag
- **WHEN** the pointer is pressed on a clip, moved 3 px and released
- **THEN** the clip does not move and no undo step is recorded

#### Scenario: Group move keeps offsets
- **WHEN** two selected clips starting at 2 s and 5 s are dragged so the first lands at 4 s
- **THEN** they start at 4 s and 7 s after release and both remain selected

#### Scenario: Clamp at zero
- **WHEN** two selected clips starting at 1 s and 3 s are dragged far to the left
- **THEN** they come to rest at 0 s and 2 s

#### Scenario: Main track to overlay
- **WHEN** a main-track clip is dragged upward onto the new-track zone above the main track and released
- **THEN** a new overlay video track holds the clip at the dropped time, and with the magnet on the remaining main-track clips close the gap in the same undo step

#### Scenario: To overlay action
- **WHEN** "To overlay" is invoked on the second of three main-track clips with the magnet on
- **THEN** the clip keeps its start time on an overlay video track and the third clip closes the gap, in one undo step

### Requirement: Edge auto-scroll
During element drag, trim, marker drag, marquee and playhead scrub, when the pointer is within 100 px of the left or right edge of the tracks viewport the timeline SHALL scroll horizontally up to 15 px per animation frame, scaled linearly by proximity to the edge; within 40 px of the top or bottom edge it SHALL scroll vertically up to 10 px per frame with the same scaling. [PORT T-043] [NEW]

#### Scenario: Horizontal auto-scroll
- **WHEN** a clip is dragged to 10 px from the right edge of the viewport and held
- **THEN** the timeline scrolls right at 13.5 px per frame (±1 px) until the pointer leaves the 100 px zone or the drag ends

### Requirement: Trimming elements
Selected elements SHALL show left and right trim handles (width per `timeline-editing.Track header column and row dimensions`; touch sizes per `mobile-editor.Touch gesture constants`). Dragging a handle trims non-destructively: the left handle changes `trimStart`, `startTime` and `duration`; the right handle changes `trimEnd` and `duration`; retimed clips convert the clip delta to a source delta per `speed-retime.Trim and split of retimed clips`. With several elements selected, dragging one handle applies the same delta to all selected elements, except that elements selected only because they share a `groupId` with the dragged element are not trimmed (group selection does not count as multi-selection for trim; `timeline-editing.Group and ungroup`); a linked partner (`linkId`) is always trimmed with its pair. Bounds: minimum duration is one project frame; the left edge cannot pass time 0. Neighbour bounds — the left edge cannot pass the left neighbour's end and the right edge cannot pass the right neighbour's start — apply on every track, with two exceptions: on any track while ripple is on (following clips shift per `timeline-editing.Ripple mode`), and on the main track while the magnet is on (following clips shift per `timeline-editing.Magnetic main track`). The magnet never lifts a neighbour bound on an overlay or audio track; an element with `sourceDuration` cannot extend past `trimStart = 0` or past the source end; elements without `sourceDuration` (text, sticker, graphic, effect, adjustment, caption, image, freeze) extend freely up to the neighbour bound and at most to 6 hours. The delta is snapped to a frame once and then re-clamped. While dragging, the result is shown through the preview layer in both timeline and player and a tooltip shows the new duration as `HH:MM:SS:FF`; on release one undo step is committed when anything changed. Shrinking truncates keyframes past the new end and inserts a boundary keyframe holding the interpolated value; a left trim re-bases keyframe times by the trimmed amount so each keyframe keeps its position relative to source content, inserting a boundary keyframe at local time 0. Transitions on a trimmed edge follow `transitions.Interaction with trim`. [PORT T-044, T-045, T-046, T-047, T-048, T-049, T-050, T-051] [CAPCUT CC-028]

#### Scenario: Source bound
- **WHEN** a video clip with `trimStart = 0` has its left handle dragged left
- **THEN** the clip does not grow and its start does not change

#### Scenario: One-frame minimum
- **WHEN** a clip in a 30 fps project has its right handle dragged left past its start
- **THEN** the clip duration stops at 4000 ticks (one frame)

#### Scenario: Free extension of text
- **WHEN** a 5 s text element with free space to its right has its right handle dragged 10 s to the right
- **THEN** its duration becomes 15 s

#### Scenario: Left trim keeps keyframe content position
- **WHEN** a clip with an opacity keyframe at local time 2 s is left-trimmed by 1 s
- **THEN** the keyframe is at local time 1 s and the picture at any absolute source frame has the same opacity as before the trim

#### Scenario: Group trim with one member at its bound
- **WHEN** two selected clips are right-trimmed outward and one reaches its source end after 0.5 s
- **THEN** both clips stop growing at 0.5 s

#### Scenario: Left neighbour bound with ripple off
- **WHEN** ripple is off (the magnet being on or off) and an overlay clip starting at 5 s with 3 s of source before its in-point, whose left neighbour ends at 4 s, has its left handle dragged 2 s to the left
- **THEN** the clip's start stops at 4 s

#### Scenario: Trimming one member of a selected group
- **WHEN** a group of a text element and a sticker is selected by clicking the text element, and the sticker's right handle is dragged 1 s to the left
- **THEN** only the sticker becomes 1 s shorter and the text element is unchanged

#### Scenario: Explicit multi-selection trims together
- **WHEN** two ungrouped clips are selected with Shift-click and one right handle is dragged 1 s to the left
- **THEN** both clips become 1 s shorter in one undo step

#### Scenario: Main-track trim with the magnet on has no neighbour bound
- **WHEN** the magnet is on and the first of two contiguous main-track clips, with 3 s of unused source after its out-point, has its right handle dragged 2 s to the right
- **THEN** the clip becomes 2 s longer and the second clip's start moves 2 s to the right

### Requirement: Split
The editor SHALL provide four split actions at the playhead (toolbar, context menu, actions exposed to `keyboard-shortcuts`): "Split" (keeps both halves), "Delete left" (splits and removes the part before the playhead), "Delete right" (splits and removes the part after the playhead) and "Split all" (splits every element on unlocked tracks strictly under the playhead regardless of selection). Split, Delete left and Delete right target the selected elements, or with no selection every element strictly under the playhead on unlocked tracks. The action is a no-op for an element whose edges are at or outside the split time. Result: the left half keeps its id with `trimEnd` increased by the right source span; the right half gets a new id, `startTime = splitTime` and `trimStart` increased by the left source span; the source split point is rounded once and is retime-aware per `speed-retime.Trim and split of retimed clips`; names get the suffixes " (left)" and " (right)" once (no suffix stacking on repeated splits). Animations are split at the local time with boundary keyframes on both halves; a transition attached at the original outer edges stays on those edges (`transitions.Interaction with split, move, delete and ripple`); fades stay on the outer edges; `background` and provenance links are copied to both halves. After Split the right halves are selected. Delete left with ripple or magnet active moves the playhead to the first remaining element's new start. Each action is one undo step. The registry actions of this requirement are `timeline.split`, `timeline.split-all`, `timeline.delete-left` and `timeline.delete-right` (default bindings only in `keyboard-shortcuts.Default bindings for editing and history`). [PORT T-052, T-053, T-054, T-055, T-056, T-057] [CAPCUT CC-029, CC-030, CC-032, CC-033]

#### Scenario: Split a retimed clip
- **WHEN** a clip at 2× speed, start 0 s, duration 10 s, `trimStart` 0 is split at 4 s
- **THEN** the left half has duration 4 s and the right half starts at 4 s with `trimStart` equal to 8 s of source and duration 6 s

#### Scenario: Split with no selection
- **WHEN** nothing is selected and the playhead lies inside clips on three unlocked tracks
- **THEN** Split divides all three clips and selects the three right halves

#### Scenario: Split at an edge
- **WHEN** the playhead is exactly at the selected clip's start
- **THEN** Split changes nothing and records no undo step

#### Scenario: Delete right
- **WHEN** a 10 s clip starting at 0 s is selected, the playhead is at 6 s and Delete right is invoked
- **THEN** the clip's duration is 6 s and its source material after 6 s remains available by extending the right handle

### Requirement: Delete and ripple delete
"Delete" SHALL dispatch by active selection kind: mask points, then keyframes, then elements; deleting elements removes them, clears the selection and is one undo step. Whether following elements close the gap is determined by the magnet (main track) and ripple mode (all tracks). "Ripple delete" is a separate action that always closes the gap on each affected track regardless of the ripple toggle. A transition whose either adjacent clip is deleted is removed in the same step. Deleting a compound element does not delete its source scene. The registry actions are `timeline.delete` and `timeline.ripple-delete`. [PORT T-072] [CAPCUT CC-034]

#### Scenario: Plain delete on an overlay track
- **WHEN** ripple mode is off and the first of two clips on an overlay track is deleted
- **THEN** the second clip keeps its start time

#### Scenario: Ripple delete
- **WHEN** ripple mode is off and "Ripple delete" is invoked on a 3 s clip followed by another clip on the same overlay track
- **THEN** the following clip starts 3 s earlier and one undo restores both

#### Scenario: Delete with keyframes selected
- **WHEN** two keyframes of an element are selected and Delete is invoked
- **THEN** only the two keyframes are removed and the element remains

### Requirement: Ripple mode
The timeline SHALL provide a "Ripple editing" toggle (toolbar and action `timeline.ripple.toggle`), default off, stored as the preference `timeline.ripple`, not undoable; a command applies ripple exactly when it is executed with `ripple: true` in the `EditContext` of `timeline-editing.Command system`. While on, after every command execute and redo the tracks are diffed before and after, per unlocked track: a vacated interval arises when an element is removed from the track, when an element's end moves earlier (`[newEnd, oldEnd]`), or when an element's start moves to a greater time through a left trim (`[oldStart, newStart]`, after which the trimmed element itself is shifted back to `oldStart`); intervals covered by new-id elements on the same track are subtracted. For each vacated interval, processed right to left, every element on that track with `startTime ≥ interval.end` moves left by the interval length. A right-edge extension with ripple on is bounded only by source bounds and pushes following same-track elements right by the growth. A left-edge outward extension with ripple on keeps the element's `startTime`, decreases `trimStart` and increases `duration` by the dragged amount (bounded by `trimStart = 0`, or by 6 hours of duration for elements without `sourceDuration`), and pushes following same-track elements right by the growth; it never moves or overlaps the left neighbour. Ripple affects only the track where the change occurred, plus linked and attached elements per `timeline-editing.Video and audio linking` and `timeline-editing.Linkage`. Ripple shifts are part of the originating command's undo step. Changes recorded with `push` that are not gesture commits, and non-history updates, are not rippled; gesture commits (trim, volume line) are rippled. On mobile (iOS and Android) the toggle has no entry and every command is executed with `ripple: false`: the main track stays gap-free through the magnet rule, and overlay and audio tracks never ripple. [PORT T-058, T-059]

#### Scenario: End trim ripples
- **WHEN** ripple is on and a clip's right edge is trimmed 2 s shorter on a track with two following clips
- **THEN** both following clips start 2 s earlier and one undo restores all three

#### Scenario: Left trim ripples
- **WHEN** ripple is on and a clip starting at 5 s is left-trimmed by 1 s
- **THEN** the clip still starts at 5 s, is 1 s shorter, shows source content beginning 1 s further in, and following clips on the track start 1 s earlier

#### Scenario: Left outward extension
- **WHEN** ripple is on and an overlay clip starting at 5 s with `trimStart` of 2 s, whose left neighbour ends at 5 s, has its left handle dragged 1 s to the left
- **THEN** the clip still starts at 5 s, is 1 s longer with `trimStart` of 1 s, the left neighbour is unchanged, and following clips on the track start 1 s after their previous starts

#### Scenario: Other tracks are untouched
- **WHEN** ripple is on, linkage is off and a clip is deleted on overlay track 1
- **THEN** no element on any other track moves

### Requirement: Snapping
The timeline SHALL provide an "Auto snapping" toggle (toolbar and action `timeline.snapping.toggle`), default on, stored as the preference `timeline.snapping`. The snap threshold is 10 px converted to ticks at the current zoom on desktop and web and 12 pt on mobile (the touch value is restated from `mobile-editor.Touch gesture constants`). Snap point types are element start, element end, playhead, marker, keyframe, in point, out point and time 0. Snap sources per gesture: element move and trim use element edges, playhead, markers, keyframes of other elements, in/out points and 0; playhead scrub uses element edges, markers, keyframes and in/out points; marker drag uses element edges, playhead, other markers and keyframes; blade preview uses element edges, playhead and markers; keyframe drag snapping is defined in `keyframe-animation.Drag keyframes in time`, uses this threshold and honours this toggle. Members of the dragged group and elements on hidden tracks are excluded as sources; the closest candidate wins and ties resolve to the earliest time. Holding Shift during a pointer gesture disables snapping for that gesture; playhead scrub honours the toggle as every other gesture does. While a snap is active a 1 px vertical line in the `timeline/snap` token of `design-system.Timeline atoms` spans the timeline height at the snap time, and the playhead handle is drawn solid when the snap target is the playhead; on mobile a snap also triggers the haptic of `mobile-editor.Haptics`. Beat snapping is added by `audio-editing.Snap to beats`. [PORT T-060, T-061, T-062, T-063, T-064, T-065, T-066, T-067] [CAPCUT CC-048]

#### Scenario: Snap to a neighbour edge
- **WHEN** snapping is on and a dragged clip's start comes within 10 px of another clip's end
- **THEN** the dragged clip's start equals that end exactly and the snap line is shown at that time

#### Scenario: Shift disables snapping
- **WHEN** the same drag is performed with Shift held
- **THEN** the clip follows the frame-rounded pointer time and no snap line is shown

#### Scenario: Threshold scales with zoom
- **WHEN** the zoom is 50 px per second on desktop
- **THEN** the snap threshold is 0.2 s (24000 ticks)

#### Scenario: Toggle off applies to scrubbing
- **WHEN** snapping is off and the playhead is scrubbed past a clip edge
- **THEN** the playhead does not jump to the edge

#### Scenario: Just outside the threshold
- **WHEN** a dragged clip's start is 11 px from the nearest snap point
- **THEN** no snap occurs

### Requirement: Preview axis
On desktop and web the timeline SHALL provide a "Preview axis" toggle (toolbar and action `timeline.preview-axis.toggle`), default on, stored as the preference `timeline.previewAxis`. While on and no gesture or playback is active, hovering the tracks area or ruler draws a 1 px vertical hover line at the pointer time with a timecode label, and the player shows the frame at the hover time without moving the playhead; leaving the timeline restores the playhead frame within 100 ms. The preview axis is not available on touch devices, and it is disabled with the tooltip "Preview is unavailable" while the engine is in the no-GPU or stopped state of `preview-canvas.Engine states`. [CAPCUT CC-050]

#### Scenario: Hover scrub
- **WHEN** the preview axis is on, the playhead is at 2 s and the pointer hovers the tracks at 8 s
- **THEN** the player shows the frame at 8 s while the playhead and timecode display remain at 2 s

#### Scenario: Disabled during playback
- **WHEN** playback is running and the pointer hovers the timeline
- **THEN** no hover line is shown and the player continues to show the playing frame

### Requirement: Clipboard
The editor SHALL provide Copy, Cut and Paste acting on the active selection scope. Copy priority: keyframes when any keyframe is selected, else elements; keyframe copy, cut and paste — including their targets, time mapping and messages — are defined in `keyframe-animation.Copy and paste keyframes`. Cut follows the same priority; cutting elements copies them and then deletes them as one undo step, honouring ripple and magnet. The clipboard holds one entry (`elements` or `keyframes`) in an app-level store that survives scene switches and project switches for the lifetime of the app session, and on web and desktop is shared between windows of the same profile. Paste elements: at the playhead, preserving relative offsets from the earliest copied element; grouped by source track and placed with `aboveSource`; new element ids, regenerated keyframe ids, new `groupId` and `linkId` values preserving the copied grouping and linking; `background`, `filmLink`, `workflowLink` and `scriptLink` are kept; pasted elements become the selection; one undo step. Pasting onto a locked target falls back to another track. Paste into a different project additionally copies every referenced media asset that the target project lacks (matched by content hash) through `media-library.Import pipeline` quota checks; when quota is insufficient the paste is aborted with no change and the quota message is shown. With no editor clipboard entry and media present on the system clipboard, Paste imports that media per `media-library.Paste import`. On mobile, Copy is offered in the clip and multi-select strips and "Paste" is the action `timeline.paste` invoked by the mobile entry defined in `timeline-editing.Timeline actions for mobile toolbars`. [PORT T-068, T-069, T-070, U-006, N-006] [NEW]

#### Scenario: Paste preserves offsets
- **WHEN** clips starting at 2 s and 5 s are copied and pasted with the playhead at 10 s
- **THEN** new clips start at 10 s and 13 s, are selected, and the originals are unchanged

#### Scenario: Cut
- **WHEN** a clip is cut with ripple off
- **THEN** the clip is removed, the clipboard holds it, and undo restores the clip while the clipboard still holds the copy

#### Scenario: Cross-project paste copies media
- **WHEN** a video clip is copied in project A and pasted in project B that does not contain its media asset
- **THEN** project B gains the asset in its media library and the pasted clip references it

#### Scenario: Cross-project paste without space
- **WHEN** the referenced asset is 2 GiB and project B's device has 1 GiB available
- **THEN** nothing is pasted, no asset is added and the quota message is shown

#### Scenario: Empty clipboard
- **WHEN** Paste is invoked with no clipboard entry and no media on the system clipboard
- **THEN** nothing changes and no undo step is recorded

### Requirement: Duplicate
"Duplicate" SHALL copy the selected elements with new ids, regenerated keyframe, effect and mask ids (`project-document.Identifiers`), the same `background` and provenance links, and the name suffix " (copy)" applied once; the copies become the selection; one undo step. Placement per source track, for the selected elements of that track taken together (their span is from the earliest selected start to the latest selected end on that track): on the main track with the magnet on, the copies are inserted directly after the last selected element of that track and following clips shift right; on every other track, and on the main track with the magnet off or Free layer on, the copies keep their relative offsets and start at the end of the span when the track is free for the whole copied span there; otherwise they are placed at the SAME start times as the originals on one new track directly above the source track (audio tracks: directly below), created by the same command. Copies of a linked pair or of a group keep the pair or group among the copies with new `linkId` / `groupId` values. Duplicate is available for single and multiple selections. The registry action is `timeline.duplicate`. [PORT T-071] [CAPCUT CC-036]

#### Scenario: Duplicate on the magnetic main track
- **WHEN** the magnet is on and a 4 s main-track clip is duplicated
- **THEN** the copy sits directly after the original on the main track and following clips shift right by 4 s

#### Scenario: Duplicate an overlay clip with free space after it
- **WHEN** an overlay text element at 2–5 s with nothing after it on its track is duplicated
- **THEN** the copy sits on the same track at 5–8 s, is named "<name> (copy)" and is selected, and no track is created

#### Scenario: Duplicate when the space after is occupied
- **WHEN** an overlay text element at 2–5 s whose track holds another element at 6–9 s is duplicated
- **THEN** a new text track directly above the source track holds the copy at 2–5 s

### Requirement: Group and ungroup
"Group" SHALL assign one new `groupId` to two or more selected elements; "Ungroup" clears the `groupId` of every element in the selected groups. Selecting any member of a group selects all members; Alt/Option-click selects a single member without the others. Move, delete, duplicate, copy, cut, hide and mute applied to a group apply to all members; trimming a member of a selected group trims only that member — no modifier is needed, and group selection does not count as multi-selection for trim (`timeline-editing.Trimming elements`). A group whose members are reduced to one by deletion is dissolved in the same step. Grouped elements show the group marker of `design-system.Timeline atoms`. Group and Ungroup are undoable, are the actions `timeline.group` and `timeline.ungroup`, and are offered in the context menu and, on mobile, through `timeline-editing.Timeline actions for mobile toolbars`. [CAPCUT CC-052]

#### Scenario: Group then move
- **WHEN** a text element and a sticker are grouped and the text element is dragged 2 s to the right
- **THEN** both elements move 2 s to the right in one undo step

#### Scenario: Ungroup
- **WHEN** Ungroup is invoked on the group and the sticker is then clicked
- **THEN** only the sticker is selected

#### Scenario: Group dissolves at one member
- **WHEN** one member of a two-member group is deleted
- **THEN** the remaining element has no `groupId`, and undo restores both the element and the group

### Requirement: Compound clips
"Create compound clip" on a selection of one or more elements SHALL create a new non-main scene named "Compound N" (N = next unused integer) with `kind: "compound"` and `compoundBackground: "none"` (`project-document.Scene fields`, `project-document.Compound background rule`), move the selected elements into it preserving relative times (earliest start becomes tick 0), and replace them with one `compound` element (`project-document.Compound element`) referencing that scene and spanning the selection's time range. Zones in the new scene: elements that were on the parent's main track go to the new scene's main track; elements from overlay tracks go to overlay tracks of the same types in the same relative order; audio elements go to audio tracks in the same relative order; transition records whose two elements both moved are moved with them and others are removed. Target track of the compound element in the parent scene: (a) when any selected element was on the main track, the main track — the selected main-track elements MUST then be contiguous on the main track (no unselected main-track element between the first and last selected one), else the action is disabled with the tooltip "Select adjacent main-track clips"; (b) otherwise the track of the topmost selected visual element when that track holds no unselected element intersecting the range, else a new overlay video track directly above that track; (c) for a selection without any visual element (audio only), a new overlay video track at `overlay.length`, directly above the main track. The compound element never overlaps an unselected element. Per-clip `background` overrides of moved elements are kept in the data and ignored while the scene renders as a compound source (`timeline-editing.Per-clip canvas background`); the inspector of a compound whose scene has main-track content offers "Keep this clip's background", which sets `compoundBackground` to `"own"` as one undo step. The compound element renders the referenced scene's picture and audio (`render-engine.Compound clip nodes`), supports trim within the scene duration, transform, opacity, effects, masks, retime and keyframes, and its `sourceDuration` follows the referenced scene's duration. Double-clicking a compound element (mobile: "Edit compound") enters the scene: the timeline shows the scene with a breadcrumb "Main scene › Compound N" above the ruler, and clicking a breadcrumb segment or the exit action returns to the parent scene with the playhead at the corresponding parent time. "Undo compound" (dissolve) replaces the compound element with the scene's elements at their mapped times and deletes the scene when no other compound element references it. Nesting depth is limited to 8 and a scene MUST NOT contain a compound element that references itself directly or transitively; violating operations are rejected with "A compound clip cannot contain itself", and exceeding the depth with "Compound clips can be nested up to 8 levels". Create and dissolve are single undo steps; entering and exiting are not undoable. The actions are `timeline.compound.create`, `timeline.compound.edit`, `timeline.compound.exit` and `timeline.compound.dissolve`; their mobile entries are listed in `timeline-editing.Timeline actions for mobile toolbars`. [CAPCUT CC-053] [NEW]

#### Scenario: Create a compound clip
- **WHEN** three clips spanning 4–12 s on two tracks are selected and "Create compound clip" is invoked
- **THEN** one compound element spanning 4–12 s replaces them, the preview at any time matches the previous preview within the tolerance of `render-engine.Golden-frame determinism`, and a scene "Compound 1" exists with the three clips starting at 0 s

#### Scenario: Enter and exit
- **WHEN** the user double-clicks the compound element with the playhead at 6 s
- **THEN** the timeline shows "Compound 1" with the playhead at 2 s and a breadcrumb back to the parent
- **AND** choosing the parent breadcrumb returns to the parent scene with the playhead at 6 s

#### Scenario: Cycle is refused
- **WHEN** the user pastes the compound element referencing "Compound 1" into scene "Compound 1"
- **THEN** the paste is rejected with "A compound clip cannot contain itself" and nothing changes

#### Scenario: Depth limit
- **WHEN** a compound clip is created inside a scene that is already at nesting depth 8
- **THEN** the action is rejected with "Compound clips can be nested up to 8 levels" and nothing changes

#### Scenario: Dissolve
- **WHEN** "Undo compound" is invoked on the compound element
- **THEN** the three original clips are back at 4–12 s on compatible tracks and the "Compound 1" scene is deleted

#### Scenario: Audio-only selection
- **WHEN** two audio elements at 2–6 s are selected and "Create compound clip" is invoked
- **THEN** a new overlay video track directly above the main track holds one compound element at 2–6 s that renders no picture and plays both sounds, and the new scene holds the two elements on audio tracks

#### Scenario: Unselected clip inside the range
- **WHEN** overlay clips 1 and 3 of three clips on one overlay track are selected (clip 2 lies between them) and "Create compound clip" is invoked
- **THEN** the compound element is placed on a new overlay video track directly above that track, and clip 2 is unchanged

#### Scenario: Non-adjacent main-track selection
- **WHEN** main-track clips 1 and 3 of three are selected
- **THEN** "Create compound clip" is disabled with the tooltip "Select adjacent main-track clips"

#### Scenario: Overlay-only compound keeps the picture beneath
- **WHEN** a title and a sticker above a main-track video are made into a compound clip
- **THEN** the main-track video is still visible around them at every frame of the range

### Requirement: Multi-camera clip
The timeline SHALL support multi-camera editing on the data of `project-document.Multi-camera definition` (scene `kind: "multicam"` with `multicam {syncMethod, angles[], audioAngleId, audioFollowsVideo}`) and `project-document.Multi-camera clip` (a `compound` element with `multicam {angleId}`); rendering is `render-engine.Compound clip nodes`, the angle viewer is `preview-canvas.Multi-camera angle viewer`, and the agent tools are those of `agent-editing-tools` named `jc_multicam_create`, `jc_multicam_switch` and `jc_multicam_set_audio`.

**Creation.** "Create multi-camera clip" (`timeline.multicam.create`; context menu and Clip menu on web and on desktop macOS, Windows and Linux; on iOS and Android the tool "Multi-camera" of `mobile-editor.Multi-select tool strip`, decision E5) is enabled for 2–8 selected `video` elements of one scene, none of which is a freeze element or carries a `linkId` (tooltips: "Select 2 to 8 video clips"; "Recover audio into the clips first" for linked clips). A dialog asks for the sync method — "Audio" (default when every clip has source audio), "Start", or "Keep current positions" — stored as `syncMethod` `audio`, `start` or `playhead`. Angle order is the selection's track order from top to bottom, then start time; angles are named "Angle 1" … "Angle n". Offsets relative to angle 1: `start` — every offset is 0; `playhead` — offset = the clip's start minus angle 1's start; `audio` — for each clip against angle 1, the normalised cross-correlation (range 0–1) of the two clips' 8 kHz mono amplitude envelopes over offsets of ±30 s, taking the offset of the peak rounded to the project frame grid; a clip whose peak value is below 0.6 uses offset 0 with a warning listing its name, and its `syncConfidence` records the peak. The command creates a scene named "Multicam N" with `compoundBackground: "none"`, one overlay `video` track per angle (named like the angle) holding that clip at scene time `offset − min(offsets)`, an empty main track and no audio track; removes the selected clips; and places one `compound` element with `multicam.angleId = angles[0].id`, `duration` = the scene duration (the latest clip end) and start = the earliest selected start, on the target track chosen by the rules (a)–(b) of `timeline-editing.Compound clips`. The audio analysis runs on-device, shows a progress dialog with Cancel, and cancelling changes nothing. Creation is one undo step.

**Switching.** The active angle of a part is `multicam.angleId`. Choosing an angle — a tile of the angle viewer, the keys 1–8 while the viewer or timeline has focus (`timeline.multicam.switch-angle-1` … `-8`), the timeline context menu "Switch angle ▸", or the mobile "Angle" strip item — applies to the multi-camera part under the playhead: at the part's first frame it rewrites that part's `angleId`; anywhere else it splits the part at the playhead and sets the `angleId` of the right-hand part; choosing the angle the part already shows does nothing. During playback the cut is made at the frame presented when the input arrived and playback continues. Adjacent parts with the same angle and continuous source time are merged by the same command. Every switch is one undo step. Parts are ordinary compound elements for move, trim (within the scene duration), split, delete, transform, effects, masks, opacity and constant-rate retime; a split copies every field to both halves. Where the active angle has no clip at a time (an angle shorter than the scene), the part renders transparent and silent there and the viewer tile reads "No media".

**Audio.** The inspector of a multi-camera part shows "Audio source" (the angle list; writes `audioAngleId`) and "Audio follows video" (writes `audioFollowsVideo`, default off). Both are fields of the scene, so they apply to every part that references it; each change is one undo step. With "Audio follows video" off, every part plays the audio angle's sound; with it on, each part plays the sound of its own angle. Part volume, mute, fades and audio processing are the part's own element fields.

**Editing the source.** "Edit multi-camera source" enters the scene like `timeline-editing.Compound clips` (breadcrumb, exit). Inside it the user can slide an angle's clip to correct sync (the same command adds the delta to that angle's `syncOffset`), rename an angle (1–80 characters), reorder angles in the angle list (array order), "Add angle" from the media library while fewer than 8 exist (a new video track and angle, placed by the scene's `syncMethod`), and "Remove angle", which is refused with "This angle is used by {n} clips" while any part's `angleId` names it or it is the audio angle. Commands that would break `project-document.Multi-camera definition` (an element on the scene's main track, an audio track, a non-video overlay track) are rejected with "A multi-camera source holds only its angles".

**Flatten.** "Flatten multi-camera clip" (`timeline.multicam.flatten`) replaces each selected part by copies of the active angle's clip(s) restricted to the part's range, at the same times on the same track, keeping the part's transform, opacity, effects, masks and audio fields; it is enabled only when the result has the same sound — `audioFollowsVideo` is true or every selected part shows the audio angle — and is otherwise disabled with the tooltip "Turn on 'Audio follows video' to flatten". The scene is deleted when no part references it any more. One undo step.

**Clip display.** A multi-camera part shows the filmstrip of its active angle, the multi-camera badge of `design-system.Timeline atoms` and the label "A{index} {angle name}". On iOS and Android — phones and tablets — a multi-camera project opens and plays, parts can be moved, trimmed, split and deleted, the angle can be switched, and creation, source editing (adding, removing, renaming, reordering and re-syncing angles), the audio-angle choice and flatten are offered with the same commands and limits as on desktop, through the entries of `timeline-editing.Timeline actions for mobile toolbars` (decision E5). [CAPCUT CC-072] [NEW]

#### Scenario: Create by audio sync
- **WHEN** two selected clips of the same event with overlapping audio are combined with method "Audio"
- **THEN** one multi-camera element replaces them, a scene of `kind: "multicam"` holds one angle track per clip, and the two clips' audio waveforms are aligned within one project frame

#### Scenario: Unrelated audio
- **WHEN** one of three clips has audio unrelated to the others (correlation peak 0.31)
- **THEN** that angle has offset 0 and `syncConfidence = 0.31`, the other two are aligned by audio, and a warning names the clip

#### Scenario: Switch angle at the playhead
- **WHEN** the playhead is at 5 s inside a multi-camera part showing angle 1 and the user presses 2
- **THEN** the part is split at 5 s, the part after 5 s has `multicam.angleId` of angle 2 and shows angle 2, the sound continues from angle 1, and one undo removes the split

#### Scenario: Live cutting during playback
- **WHEN** playback is running and the user presses 2 at the frame for 3 s and 1 at the frame for 6 s
- **THEN** the element is split at 3 s and 6 s, the middle part shows angle 2, playback did not stop, and two undo steps exist

#### Scenario: Switching back merges
- **WHEN** the part after 5 s is switched back to angle 1 on its first frame
- **THEN** the two parts merge into one element and no cut remains at 5 s

#### Scenario: Audio follows video
- **WHEN** "Audio follows video" is turned on for a source whose parts show angles 1, 2, 1
- **THEN** the sound heard is angle 1, then angle 2, then angle 1, for every part of that source, as one undo step

#### Scenario: Angle in use cannot be removed
- **WHEN** "Remove angle" is invoked on an angle that two parts show
- **THEN** nothing is removed and the message "This angle is used by 2 clips" is shown

#### Scenario: Selection size bounds
- **WHEN** one clip, or nine clips, are selected
- **THEN** "Create multi-camera clip" is disabled with the tooltip "Select 2 to 8 video clips"

#### Scenario: Flatten is refused when the sound would change
- **WHEN** a part shows angle 2 while the audio source is angle 1 and "Audio follows video" is off
- **THEN** "Flatten multi-camera clip" is disabled with the tooltip "Turn on 'Audio follows video' to flatten"

#### Scenario: Opened on a phone
- **WHEN** a project with a multi-camera clip is opened on iOS or Android
- **THEN** it plays with the stored angles, the "Angle" strip item lists the angles and switching splits at the playhead, and "Edit source", "Audio" and "Flatten" are offered on the part

#### Scenario: Created on a phone
- **WHEN** three video clips are selected on an Android phone and "Multi-camera" is chosen with the sync method "Audio"
- **THEN** one multi-camera clip with three angles is created through the same command as on desktop, as one undo step

### Requirement: Replace media
"Replace media" SHALL be available from the element context menu, the mobile clip strip of `mobile-editor.Video clip tool strip`, and by dropping a media asset from the library onto a video or image element while holding Alt/Option (desktop/web) or by using the drop zone "Replace" shown on the hovered clip. It swaps the element's media id while keeping start time, duration, transform, crop, `background`, effects, masks, adjustments, animations, transitions, speed settings and track. The element's in-point and out-point are preserved by the same rule as the command `ReplaceElementSource` of `timeline-editing.Element provenance link`, so that the parts of a split clip keep their in-points: with `D` the new source's duration and `need` the source span the element consumes at its retime, `trimStart` is kept when `trimStart + need ≤ D`, otherwise it is clamped to `max(0, D − need)`, and when `D < need` the clip is additionally shortened to the duration that `D` provides (ripple/magnet rules apply); `trimEnd` is recomputed, and the "Trim adjusted" badge of that command is shown whenever the clamp changed `trimStart` or the duration; replacing with an image removes retime and audio. Video↔image replacement is allowed; audio elements can be replaced only with audio assets. A picker dialog lists compatible library assets with search, and offers "Import…". A replacement performed by the user removes `filmLink` and `workflowLink` and keeps `scriptLink`, per `timeline-editing.Element provenance link`. One undo step. [PORT T-076] [CAPCUT CC-037]

#### Scenario: Replace keeps edits
- **WHEN** a 5 s clip with a mask and a blur effect is replaced with a 20 s video asset
- **THEN** the clip is still 5 s at the same start with the same mask and effect and, its `trimStart` being 0, shows the first 5 s of the new asset

#### Scenario: Replace keeps the in-point
- **WHEN** a 5 s clip whose `trimStart` is 8 s is replaced with a 20 s video asset
- **THEN** the clip is still 5 s and shows seconds 8 to 13 of the new asset

#### Scenario: Shorter replacement
- **WHEN** a 5 s clip with `trimStart` 0 is replaced with a 3 s video asset
- **THEN** the clip duration becomes 3 s and the "Trim adjusted" badge is shown

#### Scenario: Incompatible asset
- **WHEN** an audio asset is dropped with Alt held onto a video clip
- **THEN** no replacement occurs and the drop is treated as a normal insert onto an audio track

### Requirement: Transform entry points in the timeline
The timeline toolbar and the element context menu SHALL provide entry points only; behaviour, ranges and stored fields belong to the owners named here. For a selection of visual elements: "Crop" opens the crop tool of `preview-canvas.Crop mode`; "Rotate 90°", "Mirror" (horizontal flip) and "Flip vertical" invoke `preview-canvas.Flip, mirror and quarter-turn rotation` (which owns the rotation normalisation and its behaviour with keyframes); "Reset transform" invokes the action of `preview-canvas.Element context menu`. Free rotation by value, position and scale are edited in the inspector (`preview-canvas.Basic tab fields`) and by direct manipulation in the player (`preview-canvas.Transform handles`). "Reverse" invokes `speed-retime.Reverse` (stored only as `retime.reverse`) and is enabled for the element types that requirement lists. "Freeze frame" invokes `speed-retime.Freeze frame`, which owns the precondition, the default 3 s duration, the shift of following elements, trimming and rendering of the freeze element; the timeline contributes the toolbar button, the context-menu item and the action id `timeline.freeze`, and shows that requirement's disabled reason as the button tooltip. Each entry applies to every selected element its owner accepts, is one undo step, and is disabled when its owner accepts none of the selection. [PORT N-013, N-014, T-077] [CAPCUT CC-039, CC-040, CC-041, CC-042, CC-043, CC-044, CC-045, CC-046]

#### Scenario: Mirror several clips
- **WHEN** three video clips are selected and Mirror is invoked
- **THEN** all three have `flip.horizontal` toggled in one undo step

#### Scenario: Disabled for an audio-only selection
- **WHEN** only an audio element is selected
- **THEN** the Crop, Rotate 90°, Mirror and Freeze frame buttons are disabled, and Reverse is enabled or disabled as `speed-retime.Reverse` defines for audio

#### Scenario: Freeze frame entry
- **WHEN** one video clip is selected with the playhead inside it and the Freeze frame button is activated
- **THEN** the result is exactly the result defined in `speed-retime.Freeze frame`, recorded as one undo step

### Requirement: Element hide, mute and deactivate
"Hide/Show" SHALL apply to selected visual elements and "Mute/Unmute" to selected audio-capable elements (audio, and video or compound whose source has audio): when any target is visible (or unmuted) all targets are hidden (or muted), otherwise all are shown (or unmuted). "Deactivate/Activate" toggles both at once: a deactivated element contributes neither picture nor sound. Hidden elements are drawn at 50 % opacity; muted elements show the muted badge and their waveform is drawn at 35 % opacity; deactivated elements show both (badge and opacity atoms from `design-system.Timeline atoms`). Each action is one undo step and is registered as `timeline.toggle-hidden`, `audio.mute.toggle` and `timeline.activate.toggle`. [PORT T-073, T-074, T-132] [CAPCUT CC-054]

#### Scenario: Mixed selection hide
- **WHEN** one hidden and one visible clip are selected and Hide/Show is invoked
- **THEN** both clips are hidden

#### Scenario: Deactivate
- **WHEN** a video clip with audio is deactivated
- **THEN** it is absent from picture and audio in preview and export and is drawn at 50 % opacity with a muted badge

### Requirement: Element provenance link
Elements SHALL be able to carry the three optional provenance fields of `project-document.Project provenance links` that record where a clip came from: `filmLink` (written by `film-production.Assembly of an episode into a timeline project`), `workflowLink` (written by workflow editor nodes of `agent-workflows` and by `prompt-to-video-workflow.Assembly into a real editor timeline`) and `scriptLink` (written by `script-studio.Draft timeline from a script`); one element is able to carry all three at once, and the command that adds or removes the last element `scriptLink` of a script adds or removes the project's `scriptLinks` entry in the same undo step. The fields are ordinary document data: they are preserved by split (both halves), trim, move, duplicate, copy/paste (including into another project), group, compound creation and dissolve, package export/import and sync; they are never interpreted by rendering. A linked element shows a provenance chip on its clip when the clip is at least 64 px wide and in the inspector header — "From film · Panel {n}", "From workflow · {step}", "From script · Shot {n}" — whose actions are delegated to the producing spec (`film-production.Round-trip between studio and timeline`, `agent-workflows`, `script-studio.Two-way links between shots and timeline clips`) and need the producer's target to be reachable; the editor itself offers only "Open source" and "Unlink". "Unlink" (one undo step; available for a multi-selection) removes all three fields from the selected elements and changes nothing else. "Replace media" performed by the user removes `filmLink` and `workflowLink` and keeps `scriptLink` (a slate replaced by real footage stays linked to its shot). Producers update a linked element through the command `ReplaceElementSource {elementId, mediaId, link}`, which keeps start time, track, transform, crop, effects, masks, adjustments, `animations`, retime and transitions, and preserves the element's in-point and out-point: with `D` the new source's duration and `need` the source span the element consumes at its retime, `trimStart` is kept when `trimStart + need ≤ D`; otherwise `trimStart` is clamped to `max(0, D − need)`, and when `D < need` the element additionally is shortened to the duration that `D` provides (applying ripple and magnet rules); `trimEnd` is then recomputed as `D − trimStart − consumed span`, never below 0. Whenever the clamp changed `trimStart` or the duration, the command sets the transient session flag `trimAdjusted` (editor session state, not a document field), shown as a "Trim adjusted" badge until the element is next edited; when nothing was clamped no flag is set. It is one undo step labelled with the producer's name. Because the in-point is preserved, the two halves of a split clip keep showing their own parts of the regenerated media. A link whose target no longer exists is kept and its chip reads "Source no longer available". [NEW]

#### Scenario: Split keeps the link
- **WHEN** a clip with `filmLink` for panel 12 is split
- **THEN** both halves carry the same `filmLink` and both show "From film · Panel 12"

#### Scenario: Paste into another project
- **WHEN** a clip with `workflowLink` is copied and pasted into another project
- **THEN** the pasted clip carries the same `workflowLink`

#### Scenario: User replace clears film and workflow links
- **WHEN** the user replaces the media of a clip carrying `filmLink` and `scriptLink`
- **THEN** the clip has no `filmLink`, still has its `scriptLink`, and shows only the "From script" chip

#### Scenario: Unlink
- **WHEN** "Unlink" is chosen on a linked clip
- **THEN** the clip has none of the three fields, its picture and timing are unchanged, and one undo restores the fields

#### Scenario: Producer update shortens the clip
- **WHEN** `ReplaceElementSource` gives a 5 s linked clip with `trimStart` 0 a 3 s source
- **THEN** the clip lasts 3 s at the same start with its effects and keyframes kept, shows the "Trim adjusted" badge, and one undo restores the previous source and duration

#### Scenario: Regenerating a split panel keeps both in-points
- **WHEN** a 6 s linked clip was split at 2 s into halves with `trimStart` 0 s and 2 s, and `ReplaceElementSource` gives both halves a regenerated 6 s source
- **THEN** the first half still shows source 0–2 s and the second half source 2–6 s, neither shows the "Trim adjusted" badge

#### Scenario: In-point beyond the new source
- **WHEN** a 2 s half with `trimStart` 4 s receives a 5 s source
- **THEN** its `trimStart` becomes 3 s, its duration stays 2 s and the "Trim adjusted" badge is shown

#### Scenario: Target deleted
- **WHEN** the film of a linked clip was permanently deleted
- **THEN** the clip still plays and its chip reads "Source no longer available"

### Requirement: Element parameter registry
`packages/editor-core` SHALL hold one registry of parameter definitions `{key, type: "number" | "boolean" | "color" | "select" | "text" | "font", default, min?, max?, step?, displayMultiplier?, unit?, options?, group?, keyframable?, dependencies?}` per element kind (visual, audio, text, graphic definition, effect, mask); the definitions' values are owned by the feature specs, and `visual-effects-filters.Effect definition registry` contributes the effect and filter entries to this registry. Every command that writes a parameter — from the inspector, a canvas gesture, paste, a template, sync application of a local command, or an agent tool — coerces through the registry before writing: a number is snapped to the nearest `step` and then clamped to `[min, max]`; a `select` value MUST equal one of `options`, a `color` MUST be `#RRGGBB` or `#RRGGBBAA`, a `boolean` MUST be a boolean, and a `font` MUST be a non-empty family name, otherwise the command fails validation; writing a key that is not registered for the element's kind fails validation. A failed validation changes nothing and adds no history entry (`timeline-editing.Command system`). Coercion is identical for every trigger. Stored documents are not rewritten by the registry on load: an out-of-range stored value is clamped only for evaluation and is corrected the next time that parameter is written. [NEW]

#### Scenario: Step then clamp
- **WHEN** a parameter with `min 0`, `max 100`, `step 5` is written with 103.7
- **THEN** the stored value is 100

#### Scenario: Invalid select value from an agent tool
- **WHEN** an agent tool writes `blendMode: "shiny"`
- **THEN** the command fails validation, the element is unchanged and the undo stack is unchanged

#### Scenario: Unknown key
- **WHEN** a paste carries a parameter key that is not registered for text elements
- **THEN** that write fails validation and the paste reports the key by name

#### Scenario: Same result from two triggers
- **WHEN** opacity 250 is entered in the inspector and sent by an agent tool on equivalent states
- **THEN** both store 100

### Requirement: Element context menu
A secondary click (mobile: the clip strips of `mobile-editor`) on an element SHALL open a menu with these items in order, each shown only when applicable and each showing its shortcut hint at the right: Split; Cut; Copy; Paste; Duplicate; separator; Mute/Unmute; Extract audio/Recover audio; Link/Unlink; Hide/Show; Deactivate/Activate; separator; Group/Ungroup; Create compound clip/Undo compound; To overlay/To main track (video, image and compound elements); Freeze frame; Reverse; Crop; Rotate 90°; Mirror; Replace media; separator; Expand keyframes/Collapse keyframes (element has keyframes); Reveal media (single selection with a media id; behaviour in `media-library.Reveal media and usage indicator`); Open source and Unlink source (element with a provenance link); Rename (omitted for text and caption elements, whose bar shows their content per `text-and-titles.Text content`); separator; "Delete N elements" / "Delete text" / "Delete clip"; Ripple delete. "Rename" edits the element name (1–128 characters, undoable). The menu is fully keyboard-operable and opens with the context-menu key on the focused element. [PORT T-075]

#### Scenario: Menu on a video clip with audio
- **WHEN** the user right-clicks a single main-track video clip whose media has audio and which has no provenance link
- **THEN** the menu contains Split, Cut, Copy, Paste, Duplicate, Mute, Extract audio, Hide, Deactivate, Create compound clip, To overlay, Freeze frame, Reverse, Crop, Rotate 90°, Mirror, Replace media, Reveal media, Rename, "Delete clip" and Ripple delete

#### Scenario: Menu on a text element
- **WHEN** the user right-clicks a text element without keyframes
- **THEN** the menu contains no Mute, Extract audio, Reverse, Replace media, Reveal media, Rename or Expand keyframes items and its delete item reads "Delete text"

#### Scenario: Linked clip
- **WHEN** the user right-clicks a clip carrying a `filmLink`
- **THEN** the menu contains "Open source" and "Unlink source"

### Requirement: Track context menu
A secondary click on a track row's empty area or on a track header SHALL open a menu with: "Paste" (pastes at the click time onto this track when compatible, else per `aboveSource`), "Add track ▸" (type list), "Rename track", "Mute track"/"Unmute track" and "Solo track"/"Unsolo track" (video and audio tracks only), "Hide track"/"Show track" (non-audio tracks only), "Lock track"/"Unlock track", "Move track up", "Move track down" (overlay and audio tracks, disabled at zone limits), "Select all on track", and "Delete track" (omitted for the main track). "Delete track" removes the track and all its elements in one undo step; when the track holds elements a confirmation "Delete track and its N elements?" is shown first. [PORT T-014, T-015]

#### Scenario: Delete a populated track
- **WHEN** the user chooses Delete track on an overlay track with 4 elements and confirms
- **THEN** the track and its 4 elements are removed and undo restores them at the same index

#### Scenario: Main track menu
- **WHEN** the context menu is opened on the main track
- **THEN** it has no "Delete track", "Move track up" or "Move track down" items

### Requirement: Drag and drop from the library
Dragging a library item (media, text preset, sticker, graphic, effect, filter, adjustment; transitions are handled by `transitions.Apply a transition on desktop and web`) over the timeline SHALL show a ghost element with the item's duration at the frame-rounded, snapped pointer time, resolved with `preferIndex` on the hovered track; outside all tracks, a new track above (pointer above the first track) or below. A new-track drop is one undo step containing the track creation and the insert. The drop line is hidden while a target element is hovered for an on-element drop. Dropping onto the main track with the magnet on inserts at the nearest cut boundary to the drop time; with Free layer on, a drop onto an occupied main-track range goes to an overlay track per `timeline-editing.Free layer mode`. A drag is the only way, besides an Overlay action, to place a library item on an overlay track. Adding without a drag (the "+" button, double-click, and every mobile tap-to-add) follows the click-to-add rule of `timeline-editing.Placement strategies`. [PORT T-078] [CAPCUT CC-018]

#### Scenario: Drop on free space of a compatible track
- **WHEN** a video asset is dropped at 12.5 s on an overlay video track that is free there
- **THEN** a clip with the asset's duration starts at 12.5 s on that track and is selected

#### Scenario: Drop below all tracks
- **WHEN** an audio asset is dropped below the last track
- **THEN** a new audio track is appended after the last audio track and one undo removes both the track and the clip

#### Scenario: Drop on the magnetic main track
- **WHEN** the magnet is on, the main track holds clips at 0–6 s and 6–10 s and a 4 s video is dropped on the main track at 5 s
- **THEN** the new clip occupies 6–10 s and the second clip moves to 10–14 s

### Requirement: Effect drop targets
Dropping an effect or filter item onto a visual element SHALL add it as a clip effect on that element (the target is dimmed to 50 % while hovered); dropping it elsewhere creates an effect element of 5 s at the drop time, resolved with `preferIndex` among effect tracks (hovered effect track when free, otherwise a new effect track at overlay index 0). Both are single undo steps. Clips that carry at least one clip effect show an effects badge; activating the badge selects the clip and opens the Effects tab of the inspector. Effect and filter behaviour is defined in `visual-effects-filters.Apply an effect or filter to a clip` and `visual-effects-filters.Standalone effect layer`, and the badge in `visual-effects-filters.Timeline affordances for effects and filters`; a new effect track takes the index of `timeline-editing.Track creation and insert index`. [PORT T-079, T-080, T-121]

#### Scenario: Drop on a clip
- **WHEN** a blur effect is dropped onto a video clip
- **THEN** the clip has one clip effect, shows the effects badge, and no effect element is created

#### Scenario: Drop on empty area
- **WHEN** the same effect is dropped on empty track area at 3 s
- **THEN** an effect element of 5 s starts at 3 s on an effect track

### Requirement: Operating-system file drop
Dropping files from the operating system onto the timeline (desktop and web) SHALL import each file through `media-library.Import pipeline` sequentially with the import toast, and insert the successfully imported assets at the drop pointer time (frame-rounded, snapped) — an intended change from OpenCut classic, which inserted at the playhead. Batch rule: the visual files are chained end to end in drop order on one track resolved by `preferIndex` from the hovered track for the first visual file (onto the main track with a magnetic insert when the hovered track is the main track and the magnet is on); the audio files are chained end to end in drop order on one audio track resolved by `firstAvailable` for the first audio file; both chains start at the drop time. When the timeline is completely empty, the visual chain goes onto the main track at tick 0. Files that fail import are skipped and listed in the toast. All inserts of one drop form one undo step. [PORT T-081, M-003]

#### Scenario: First visual on an empty timeline
- **WHEN** a video file is dropped on an empty timeline
- **THEN** the asset is imported and its clip is on the main track starting at 0 s

#### Scenario: Unsupported file in a batch
- **WHEN** a PDF and an MP4 are dropped together
- **THEN** the MP4 is imported and inserted, and the toast reports "Unsupported file type: <pdf name>"

#### Scenario: Mixed batch
- **WHEN** two videos (4 s, 6 s) and one 10 s audio file are dropped at 8 s on an empty overlay video track
- **THEN** the videos occupy 8–12 s and 12–18 s on that track, the audio occupies 8–18 s on an audio track, and one undo removes all three

### Requirement: Timeline zoom
Zoom SHALL be expressed as a factor where 1 = 50 px per second, maximum 100, and a dynamic minimum equal to `containerWidth × 0.25 / (max(durationSeconds, 1) × 50)` capped at 100. Controls: zoom-in and zoom-out buttons multiply or divide by 1.7; a slider 0–1 with step 0.005 mapped exponentially as `min × (max/min)^position`; Ctrl/Cmd + wheel zooms by factor `exp(−delta/300)` with per-frame delta capped at ±30, batched per animation frame, suppressing browser zoom; pinch zooms on touch and trackpads (touch per `mobile-editor.Timeline pinch zoom and ruler`); "Zoom to fit" sets the zoom so the scene duration spans 95 % of the tracks viewport width and sets horizontal scroll to 0. Zoom anchoring: at slider position ≥ 0.15 the playhead keeps its viewport offset (desktop/web) and wheel or pinch zoom keeps the time under the pointer or pinch centre fixed; below 0.15 there is no anchoring, and crossing back down restores the scroll position saved when crossing up. On mobile the zoom always anchors on the fixed-centre playhead. Right padding after the content is 75 % of the container at minimum zoom, easing to 15 % at slider position 0.2. Zoom is not undoable. The registry actions are `timeline.zoom-in`, `timeline.zoom-out` and `timeline.zoom-fit`. [PORT T-090, T-091, T-092, T-093, T-094] [CAPCUT CC-063, CC-064]

#### Scenario: Button zoom
- **WHEN** the zoom is 1 and zoom-in is clicked once
- **THEN** the zoom is 1.7 (85 px per second)

#### Scenario: Zoom to fit
- **WHEN** the scene is 60 s long, the viewport is 1200 px wide and Zoom to fit is invoked
- **THEN** 60 s spans 1140 px (19 px per second, zoom 0.38) and the scroll position is 0

#### Scenario: Maximum
- **WHEN** zoom-in is invoked at zoom 100
- **THEN** the zoom stays 100

### Requirement: Timeline scrolling and layout
Plain wheel SHALL scroll the tracks vertically; Shift + wheel, Alt/Option + wheel, or dominant horizontal delta scrolls horizontally, capped at 40 px per event. The ruler and marker row stay fixed vertically and follow the tracks viewport's horizontal scroll; the track header column stays fixed horizontally and follows vertical scroll. On opening a project the tracks area is scrolled vertically so the main track and audio tracks are visible (scrolled to the bottom). The timeline panel height is user-resizable within the limits defined in `app-shell-navigation.Editor four-region layout`; when tracks exceed the panel the tracks area scrolls. [PORT T-095, T-096, T-097, T-098]

#### Scenario: Ruler stays visible
- **WHEN** a scene with 20 tracks is scrolled vertically
- **THEN** the ruler and marker row remain at the top and stay aligned with track content horizontally

#### Scenario: Initial scroll
- **WHEN** a project with 12 overlay tracks is opened in a timeline panel that fits 5 rows
- **THEN** the main track row is visible without scrolling

### Requirement: Timeline view state persistence
The editor SHALL persist, per project and per device, the view state `local.timelineViewState {zoomLevel, scrollLeft, playheadTime, scenePlayheads, expandedKeyframeElementIds[]}` and the current scene `local.currentSceneId` of `project-document.Device-local section`, and restore them when the project opens; scroll saves are debounced 300 ms, and the state is also saved when a scrub ends. Which elements have expanded keyframe lanes is part of this state, as required by `keyframe-animation.Expanded keyframe lanes and keyframe panel`; ids of elements that no longer exist are dropped on load. The snapping, ripple, magnet, linkage, preview-axis, Free layer and auto-follow settings are stored app-wide through `project-storage.UI preference storage`. Cursor mode is not persisted. View state lives under `local`, which is excluded from the canonical document, from state patches, sync and packages; changing it creates no undo step and no revision. [PORT T-099]

#### Scenario: Restore on reopen
- **WHEN** a project is closed at zoom 3.2, scroll 840 px, playhead 12 s and reopened
- **THEN** the timeline shows zoom 3.2, scroll 840 px and playhead at 12 s

#### Scenario: Expanded lanes survive a reload
- **WHEN** keyframe lanes are expanded on one element and the project is closed and reopened
- **THEN** that element's lanes are expanded and no other element's are

### Requirement: Ruler and timecode
The ruler SHALL draw ticks adapting to zoom: frame-level tick intervals `[1, 2, 3, 5, 10, 15]` frames with spacing ≥ 18 px and label intervals `[2, 3, 5, 10, 15]` frames with spacing ≥ 120 px; second multipliers `[1, 2, 3, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]` with a 60 s fallback; tick intervals always divide the label interval. Labels read `MM:SS` on second boundaries, `H:MM:SS` at ≥ 1 h, and `{n}f` between seconds. Only ticks inside the viewport plus a buffer of `max(200 px, 15 % of viewport)` are rendered. The timeline has no time-entry field of its own: the single editable timecode (`HH:MM:SS:FF`, its accepted short forms and its invalid-input behaviour) is owned by `preview-canvas.Timecode and duration display`, and a time committed there seeks the timeline playhead, frame-snapped and clamped to `[0, duration]`. [PORT T-100, T-101, T-102]

#### Scenario: Label format past one hour
- **WHEN** the visible range includes 1 h 2 min 5 s at a second-level zoom
- **THEN** that label reads "1:02:05"

#### Scenario: Timecode entry moves the timeline playhead
- **WHEN** "00:00:10:15" is committed in the player's timecode field in a 30 fps project of 60 s
- **THEN** the timeline playhead is at 10.5 s and the timeline scrolls to show it per the auto-follow mode

#### Scenario: Frame labels
- **WHEN** the zoom makes one frame 20 px wide in a 30 fps project
- **THEN** frame ticks are drawn every frame and the labels between seconds read `{n}f`

### Requirement: Playhead and seeking
On desktop and web the playhead SHALL be a 2 px line with a 12 px round handle in the `timeline/playhead` token. Dragging the handle or pressing on the ruler scrubs: time clamped to `[0, duration]`, frame-snapped, no snap on the initial press, snapping while moving. Click-to-seek works on the ruler, marker row, empty track area and gutter. With the playhead focused, the frame-step actions step one frame. Seek actions registered in `keyboard-shortcuts.Action registry` (bindings in `keyboard-shortcuts.Default bindings for playback and navigation`): step ±1 frame, step ±10 frames, seek ±1 s, jump ±5 s, go to start, go to end, stop (pause and seek to 0), previous and next cut point (cut points are tick 0, every element start and end on unlocked visible tracks of the active scene, and the scene end; the nearest strictly before or after the playhead). The playhead rests at exactly the scene duration at the end of the timeline (`preview-canvas.End-of-timeline behaviour`). Playback transport, playback rate, J/K/L shuttle and Loop are owned by `preview-canvas.Playback rate and JKL shuttle` and `preview-canvas.Loop playback`; the timeline only follows the transport position. Auto-follow during playback is the preference `timeline.autoFollow` with three modes: `page` (default — when the playhead leaves the viewport, the timeline scrolls so the playhead sits at 10 % of the viewport width from the left edge), `smooth` (the timeline scrolls continuously so the playhead stays at the horizontal centre once it reaches it) and `off`; auto-follow is suspended while the user is scrubbing or scrolling manually and resumes 1 s after the last manual scroll. On mobile the playhead is a fixed vertical line at the horizontal centre of the timeline (`mobile-editor.Fixed-centre playhead timeline`): scrolling the timeline content seeks, the content start and end can be scrolled to the centre line, playback scrolls the content under the line, and the auto-follow preference does not apply. [PORT T-103, T-104, T-105, T-106, T-107, N-007] [CAPCUT CC-065, CC-066, CC-067]

#### Scenario: Next cut point
- **WHEN** clips end at 4 s and 9 s and the playhead is at 5 s
- **THEN** "Next cut point" moves the playhead to 9 s and "Previous cut point" from 5 s moves it to 4 s

#### Scenario: Multi-frame step
- **WHEN** the playhead is at frame 100 in a 30 fps project and "Step forward 10 frames" is invoked
- **THEN** the playhead is at frame 110

#### Scenario: Page auto-follow
- **WHEN** playback runs with `timeline.autoFollow = page` in a viewport 1000 px wide and the playhead crosses the right edge
- **THEN** the timeline scrolls once so the playhead is 100 px from the left edge

#### Scenario: Auto-follow off
- **WHEN** playback runs with `timeline.autoFollow = off` and the playhead leaves the viewport
- **THEN** the scroll position does not change

#### Scenario: Mobile fixed playhead
- **WHEN** the user drags the mobile timeline content left by a distance equal to 2 s at the current zoom
- **THEN** the current time increases by 2 s and the playhead line stays at the screen centre

### Requirement: In/out range
The scene SHALL hold an in point and an out point (`inPoint`, `outPoint` in ticks, each unset by default): the actions `range.set-in` and `range.set-out` set them at the playhead (setting an in point at or after the out point clears the out point, and the reverse), `range.set-to-selection` sets the in point to the earliest start and the out point to the latest end of the selected elements (one undo step; disabled with the reason "Select a clip first" when nothing is selected), and `range.clear` removes both; the range is drawn as a band in the `timeline/range` token on the ruler with draggable ends that snap per `timeline-editing.Snapping`. Setting, moving and clearing points is undoable and persisted with the scene. The range is consumed by its owners: it is the default export range of `export-share.Range export`, and it bounds looped playback per `preview-canvas.Loop playback`. On mobile the same four actions are invoked from the entry listed in `timeline-editing.Timeline actions for mobile toolbars`. The registry actions are `range.set-in`, `range.set-out`, `range.set-to-selection` and `range.clear`. [CAPCUT CC-057]

#### Scenario: Set a range
- **WHEN** the in point is set at 2 s and the out point at 6 s
- **THEN** the ruler shows the band from 2 s to 6 s and one undo removes the out point

#### Scenario: In after out
- **WHEN** out is 6 s and the user sets the in point at 8 s
- **THEN** the in point is 8 s and the out point is unset

#### Scenario: Drag an end
- **WHEN** the out end is dragged to within the snap threshold of a clip end at 9 s
- **THEN** the out point is exactly 9 s after release, recorded as one undo step

#### Scenario: Range from the selection
- **WHEN** two clips at 2–5 s and 7–9 s are selected and `range.set-to-selection` is invoked
- **THEN** the in point is 2 s and the out point is 9 s, and one undo restores the previous range

### Requirement: Timeline toolbar
The desktop and web timeline toolbar SHALL contain exactly the tools listed here, in this order; this requirement owns the content and order, and `app-shell-navigation.Editor timeline toolbar frame` owns only the frame (height, icon-button style). Left group, 16 tools in this order: cursor-mode dropdown, Undo, Redo, Split, Delete left, Delete right, Delete, Add/Remove marker, Freeze frame, Reverse, Mirror, Rotate 90°, Crop, Extract/Recover audio, Duplicate, Graph editor (`keyframe-animation.Graph editor availability`). After the left group, a context group shows quick-access tools for the current single selection, in this order — video or image clip: Transcript (`captions-subtitles.Transcript panel`), Split scenes (`timeline-editing.Automatic scene-cut detection`; video only), Remove background (`ai-editing-tools.Background removal for video` / `ai-editing-tools.Background removal for images`), Auto adjust (`color-adjustment`), Enhance (`ai-editing-tools.Upscale and enhance`); audio clip: Mark beats (`audio-editing.Beat markers on audio`), Enhance voice (`audio-editing.Enhance voice`); no selection or any other selection: empty. Centre: the current scene name as a split button that opens the Scenes sheet. Right group, 10 controls in this order: Record voiceover (`audio-editing.Voiceover recording`), Main track magnet, Auto snapping, Linkage, Preview axis, Ripple editing, zoom out, zoom slider, zoom in, Zoom to fit. Every button has a tooltip with the action name and its current binding from `keyboard-shortcuts.Active binding lookup`, an accessible name, a disabled state with a reason tooltip when not applicable, and toggle buttons expose their pressed state. Overflow: when the toolbar is narrower than its content, the context group collapses first, then the left-group tools after Delete collapse from the right end into a "⋯" menu that lists them in toolbar order; the tools up to and including Delete, the centre button and the right group never overflow. The mobile equivalents are the transport row and toolbars owned by `mobile-editor`. [PORT T-108, SC-009]

#### Scenario: Tool order
- **WHEN** the toolbar is wide enough for all tools and nothing is selected
- **THEN** the left group shows its 16 tools in the listed order, the context group is empty, and the right group shows its 10 controls in the listed order

#### Scenario: Context group for a video clip
- **WHEN** one video clip is selected
- **THEN** the context group shows Transcript, Split scenes, Remove background, Auto adjust and Enhance in that order

#### Scenario: Overflow
- **WHEN** the toolbar is narrowed until only seven left tools fit
- **THEN** the cursor-mode dropdown through Delete stay visible, the other nine left tools are in the "⋯" menu in toolbar order, and all 10 right-group controls stay visible

#### Scenario: Disabled with reason
- **WHEN** nothing is selected and no clip is under the playhead
- **THEN** Split is disabled and its tooltip reads "Select a clip or move the playhead onto one"

#### Scenario: Scene name
- **WHEN** the active scene is renamed to "Intro"
- **THEN** the centre split button reads "Intro"

### Requirement: Clip rendering
Timeline clips SHALL render by type, with every fill, stroke and opacity taken from tokens of `design-system.Editor colour tokens` and atoms of `design-system.Timeline atoms` (no literal colour is defined here): video, image and compound clips show a filmstrip of frames at their source times (per `media-library.Filmstrip thumbnails`; an image repeats its thumbnail), tile width = row height × asset aspect ratio, with a name header over a gradient, on `clip/video`, `clip/image` and `clip/compound`; text clips show their content on `clip/text`; graphic and sticker clips show a 16 px preview and name on `clip/sticker`; effect clips show an icon and name on `clip/effect`, and effect elements of kind `filter` on `clip/filter`; audio clips use `clip/audio`; adjustment clips use `clip/adjustment`; caption clips show their text on `clip/caption`; clip text uses `clip/label`. Badges, in this order from the left of the header: provenance chip (`timeline-editing.Element provenance link`), speed and reverse (`speed-retime.Speed badges on clips`), effects (`visual-effects-filters.Timeline affordances for effects and filters`), muted, keyframes, linked, group marker, "Trim adjusted", and "Media offline" in the destructive colour token when the asset is missing. Selected clips show the 2 px `timeline/selection` outline, trim handles and, on mobile, the duration badge of `mobile-editor.Selection, trim handles and clip badges`. Hidden clips are drawn at 50 % opacity. Clips narrower than 24 px omit header and badges. While a filmstrip frame is not yet available the clip shows the asset thumbnail tiled. Slate clips (`media-library.Slate media`) render as image clips with a "Slate" badge. [PORT T-120, T-127, T-128, T-129, T-130, T-131, T-132] [NEW]

#### Scenario: Filmstrip reflects trim
- **WHEN** a video clip is left-trimmed by 5 s
- **THEN** the first filmstrip tile shows the source frame at 5 s (±1 filmstrip interval)

#### Scenario: Fills come from tokens
- **WHEN** the theme is switched between light and dark
- **THEN** every clip fill equals the value of its `clip/*` token in the active theme

#### Scenario: Narrow clip
- **WHEN** a clip is 20 px wide at the current zoom
- **THEN** it shows no header and no badges

#### Scenario: Offline media
- **WHEN** a clip's asset file is missing
- **THEN** the clip is drawn with a hatched background and the badge "Media offline"

### Requirement: Audio clip rendering and volume line
The timeline SHALL reserve the areas in which audio is drawn and delegate the drawing: audio clips fill their row with the waveform, and video or compound clips whose source audio is enabled show it in a 16 px strip at the bottom of the clip. The waveform drawing (bar geometry, height mapping, gain, fade and retime reflection, clipping indication, placeholder while computing and failure presentation) is owned by `audio-editing.Waveform rendering`, drawing from the stored summaries of `media-library.Waveform summaries`; only the portion inside the viewport is drawn. The on-clip volume line — which clips show it, its hit area, drag mapping, 0 dB snapping, reset, and its replacement by the automation envelope when volume has keyframes — is owned by `audio-editing.Volume line on clips`, and fade handles by `audio-editing.Fade handles on clips`. The timeline's part is the gesture contract: a volume-line or fade drag selects the element on pointer down, previews through the preview layer, commits one undo step on release, is rippled as a gesture commit, and is refused on a locked track. [PORT T-122, T-123, T-124, T-125, T-126]

#### Scenario: Waveform strip on a video clip
- **WHEN** a video clip with enabled source audio is shown on a 65 px row
- **THEN** a 16 px waveform strip is drawn at the bottom of the clip

#### Scenario: Volume drag is one undo step
- **WHEN** the volume line of an audio clip is dragged and released at a different value
- **THEN** the clip is selected, exactly one undo step is recorded and undo restores the previous volume

#### Scenario: Locked track
- **WHEN** the user drags the volume line of a clip on a locked track
- **THEN** the volume does not change and no undo step is recorded

### Requirement: Markers
Each scene SHALL hold its own list of markers in the field `markers` of `project-document.Markers` (stable ids, at most one marker per frame time, sorted by time); the user-facing term, the action names, the agent tool (`jc_marker_edit`) and the stored field all say "marker" (the classic `bookmarks` key is renamed by the migration, `project-document.Classic v31 mapping`). "Toggle marker" (`marker.toggle`) at the playhead adds a marker or removes the one at that frame; the toolbar button shows the active state when the playhead is on a marker. "Add marker with new colour" adds a marker using the next colour of the eight-colour palette `marker/1` … `marker/8` of `design-system.Editor colour tokens`; `marker/1` is the default colour, and `color` stores the token index 1–8 or a custom lowercase `#rrggbb`. Markers render in the marker row under the ruler as flags (row and flag sizes in `timeline-editing.Track header column and row dimensions`), with a translucent range bar when the duration is wider than 2 px. A marker moved or added onto a time already holding a marker is rejected with the message "A marker already exists at this time". A scene holds at most 1 000 markers; adding beyond that is refused with "Marker limit reached (1000)". Every marker operation (add, remove, move, edit note, colour, duration) is undoable; note edits are coalesced into one undo step per editing session (focus to blur). On mobile, markers are drawn as flags on the ruler and are added, edited and listed through `mobile-editor.Markers on mobile`, which invokes the actions listed in `timeline-editing.Timeline actions for mobile toolbars`. The registry actions are `marker.toggle`, `marker.add-next-color`, `marker.next` and `marker.previous`. [PORT B-001, B-002, B-011, SC-010] [CAPCUT CC-055]

#### Scenario: Toggle
- **WHEN** the playhead is at 3 s with no marker and Toggle marker is invoked twice
- **THEN** a marker exists at 3 s after the first invocation and none after the second

#### Scenario: Stable id
- **WHEN** a marker is dragged from 3 s to 5 s
- **THEN** its `id` is unchanged

#### Scenario: Colour cycle
- **WHEN** "Add marker with new colour" is invoked nine times at nine different times in a scene without markers
- **THEN** the markers use `marker/1` through `marker/8` in order and the ninth uses `marker/1`

#### Scenario: Markers are per scene
- **WHEN** scene A has a marker at 3 s and the user switches to scene B
- **THEN** the marker row of scene B does not show that marker

#### Scenario: Collision
- **WHEN** a marker is dragged onto the exact frame of another marker and released
- **THEN** it returns to its original time and the collision message is shown

### Requirement: Marker interaction
A single click (tap) on a marker SHALL seek to it; activating a focused marker seeks; double-click (mobile: tap the selected marker again, or "Edit" in the marker list) opens a popover with a note field (0–500 characters), a colour picker offering the eight palette colours, a custom colour and reset-to-default, a duration field in seconds (step 0.1, min 0, max = scene duration − marker time) and a Delete button; a secondary click opens a context menu with Edit, Change colour, Delete, Delete all markers ("Delete all markers" asks for confirmation when the scene has more than one marker and is one undo step). Dragging a marker (5 px threshold on desktop and web) moves it, frame-rounded, clamped to `[0, duration]`, with snapping and edge auto-scroll, committing on release. "Next marker" and "Previous marker" (`marker.next`, `marker.previous`) move the playhead to the nearest marker strictly after or before it, and do nothing when none exists. [PORT B-003, B-004, B-005, B-006, B-007, B-008, B-009] [CAPCUT CC-056]

#### Scenario: Edit a note
- **WHEN** the user double-clicks a marker, types "Cut here" and closes the popover
- **THEN** the marker's note is "Cut here" and a single undo clears the note

#### Scenario: Note length
- **WHEN** a 600-character note is pasted
- **THEN** the field holds the first 500 characters

#### Scenario: Next marker
- **WHEN** markers exist at 2 s and 8 s and the playhead is at 5 s
- **THEN** "Next marker" moves the playhead to 8 s and a second invocation leaves it at 8 s

#### Scenario: Duration bound
- **WHEN** a marker at 50 s in a 60 s scene has duration 25 entered
- **THEN** the duration is clamped to 10 s

### Requirement: Marker notes overlay
The player SHALL offer an overlay toggle "Show marker notes", default on, persisted with the preview settings of `preview-canvas.Persist preview settings` and listed among the overlays of `preview-canvas.Overlay system` under the same name. While on, a heads-up list at the top-left of the player shows the notes of every marker of the active scene whose range `[time, time + duration]` contains the current time (a marker without duration is active on its own frame only). The overlay is never included in exports or snapshots. [PORT B-010]

#### Scenario: Note visible inside the range
- **WHEN** a marker at 4 s with duration 2 s and note "B-roll" exists and the playhead is at 5 s
- **THEN** the player overlay lists "B-roll"

#### Scenario: Overlay off
- **WHEN** "Show marker notes" is off
- **THEN** no marker note is drawn over the player

### Requirement: Scenes model and switching
A project SHALL contain one or more scenes with the fields of `project-document.Scene fields`; exactly one scene is the main scene, named "Main scene" on creation and recreated automatically when missing on load. The Scenes sheet (desktop and web: opened from the toolbar scene button; mobile: a bottom sheet opened by the action `timeline.scenes.open` from the entry listed in `timeline-editing.Timeline actions for mobile toolbars`) lists scenes in project order with name, duration, a thumbnail of the scene's first frame and a check mark on the active one; scenes of `kind` `compound` and `multicam` are marked with the compound and multi-camera icons. Activating a row switches the active scene by writing the device-local `local.currentSceneId` and restores that scene's playhead from `local.timelineViewState.scenePlayheads` (`project-document.Device-local section`); switching is not undoable, emits no state patch, clears the selection, and is per device — another device viewing or editing the same project keeps its own scene. [PORT SC-001, SC-002, SC-003]

#### Scenario: Switch scene
- **WHEN** the user chooses "Scene 2" in the Scenes sheet
- **THEN** the timeline and player show Scene 2, its row shows the check mark, and the undo stack is unchanged

#### Scenario: Missing main scene is repaired
- **WHEN** a stored project without a main scene is loaded
- **THEN** a scene named "Main scene" with `isMain = true` exists after load

#### Scenario: Scenes on a phone
- **WHEN** `timeline.scenes.open` is invoked on a phone in a project with two scenes
- **THEN** a bottom sheet lists both scenes and tapping the second switches to it

### Requirement: Scene create, rename, reorder and duplicate
The Scenes sheet SHALL provide: "New scene" (creates an empty scene named "Scene N" with N the next unused integer and switches to it), rename (double-click, the rename action or row menu; trimmed, 1–64 characters, empty reverts), reorder by dragging rows or "Move up"/"Move down" (the main scene can be reordered but stays main), and "Duplicate" (deep copy with new scene id, element ids, keyframe ids and marker ids, named "<name> (copy)", inserted after the source, never main). Create, rename, reorder and duplicate are each one undoable command. A project holds at most 200 scenes, compound scenes included; "New scene", "Duplicate" and "Create compound clip" are disabled at the limit with the tooltip "Scene limit reached (200)". [PORT SC-007, SC-008] [NEW]

#### Scenario: Create a scene
- **WHEN** a project with scenes "Main scene" and "Scene 2" has "New scene" invoked
- **THEN** an empty "Scene 3" exists, is active, and undo removes it and returns to the previously active scene

#### Scenario: Duplicate a scene
- **WHEN** "Scene 2" with 5 elements is duplicated
- **THEN** "Scene 2 (copy)" with 5 elements of new ids appears directly after it and editing the copy does not change "Scene 2"

#### Scenario: Rename to empty
- **WHEN** the user clears a scene name and commits
- **THEN** the previous name is kept

#### Scenario: Scene limit boundary
- **WHEN** a project has 199 scenes and "New scene" is invoked twice
- **THEN** the first invocation creates scene 200 and the second is unavailable because "New scene" is disabled with the tooltip "Scene limit reached (200)"

### Requirement: Scene deletion
The Scenes sheet SHALL offer a "Select" mode to multi-select scenes and delete them after a confirmation dialog "Delete N scenes?" stating that the action can be undone. The main scene cannot be deleted: Delete is disabled while the main scene is in the selection. A scene referenced by a compound element cannot be deleted from the sheet; the dialog lists the referencing scenes instead and offers no confirm button. Deleting the active scene switches to the main scene. Deletion is one undoable command that restores the scenes at their original positions. [PORT SC-004, SC-005, SC-006]

#### Scenario: Delete the active scene
- **WHEN** the active non-main scene is deleted and confirmed
- **THEN** the main scene becomes active and undo restores the deleted scene at its original index

#### Scenario: Main scene protected
- **WHEN** the main scene is part of the multi-selection
- **THEN** the Delete button is disabled

#### Scenario: Referenced scene
- **WHEN** the user tries to delete a scene used by a compound element in the main scene
- **THEN** the dialog reads that the scene is used by "Main scene" and nothing is deleted

### Requirement: Command system
Every change to project data SHALL be performed by a `Command` with `execute()`, `undo()` and `redo()` (default `redo` = `execute`), optionally returning a selection patch. `BatchCommand` executes its children in order and undoes them in reverse, the last selection result winning. Every command execution takes an explicit `EditContext {magnet: boolean, ripple: boolean, linkage: boolean, freeLayer: boolean}`, and `editor-core` reads no preference store: these four settings change what a command writes to the document, so they are inputs of the command, not ambient state. The caller supplies the context: the desktop and web UI passes the device preferences `timeline.magnet`, `timeline.ripple`, `timeline.linkage`, `timeline.freeLayer` (with `magnet` forced to `false` while `freeLayer` is true); the mobile UI (iOS and Android) passes `{magnet: !freeLayer, ripple: false, linkage: <timeline.linkage>, freeLayer: <timeline.freeLayer>}`; host principals — agent tools of `agent-editing-tools` executed against the host replica, workflow, film and automation writers — pass `{magnet: true, ripple: false, linkage: true, freeLayer: false}` unless the tool call or node configuration states other values through its optional `editContext` argument. Undo and redo re-apply the recorded result and do not re-evaluate the context. After each execute and redo the editor runs, in order: ripple (when `ripple`), the magnet rule of `timeline-editing.Magnetic main track` (when `magnet` and not `freeLayer`), linkage shift (when `linkage`), empty-track pruning — all inside the same undo step. Because the result, not the command, is what leaves the device (state patches), a follower or the Gateway never needs to know the context that produced a patch. User triggers (toolbar, menus, shortcuts, gestures, mobile toolbars, agent tools) invoke named actions from the single action registry of `keyboard-shortcuts.Action registry`; handlers never depend on the trigger. Commands execute in `packages/editor-core` without DOM access and behave identically on web, desktop and mobile. A command that fails validation (including the parameter coercion of `timeline-editing.Element parameter registry`) throws no partial change: the project state is identical to the state before the attempt and no history entry is added. The outcome of every executed, undone and redone step is published as one state patch over the canonical project document per `project-storage.State patch emission`; commands themselves are never serialised or sent to another device or to the Gateway. A project opened read-only (edit lease held elsewhere, or `viewer` role) rejects every command with the reason shown as a toast. A project whose `minReaderSchemaVersion` is above the app's schema is never opened in the editor (`project-storage.Schema versioning`), so no command reaches it. [PORT U-003, U-007]

#### Scenario: Batch undo order
- **WHEN** a batch of AddTrack then InsertElement is undone
- **THEN** the element is removed first and then the track, leaving the scene identical to the pre-batch state

#### Scenario: Failed command leaves no trace
- **WHEN** a move command targets a track of an incompatible type
- **THEN** the scene is unchanged and the undo stack length is unchanged

#### Scenario: Same action from two triggers
- **WHEN** Split is invoked from the toolbar and then from its shortcut on equivalent states
- **THEN** both produce identical project data

#### Scenario: One patch per step
- **WHEN** a split is executed and then undone
- **THEN** two state patches are published, and applying both to the pre-split document yields the pre-split document

#### Scenario: Read-only project
- **WHEN** a command is invoked in a project opened read-only
- **THEN** the project is unchanged, no history entry is added and a toast states why editing is unavailable

#### Scenario: Agent tool on the host uses the default context
- **WHEN** an agent tool deletes the first of three contiguous main-track clips on the host replica without an `editContext` argument, while the user's phone has Linkage off and their desktop has the magnet off
- **THEN** the command runs with `{magnet: true, ripple: false, linkage: true, freeLayer: false}`: the following clips shift left and attached elements follow, whatever any device's preferences are

#### Scenario: Same command, same context, same result on every platform
- **WHEN** the same delete is executed with the same `EditContext` on web, desktop and a phone from the same document
- **THEN** the three resulting documents have byte-identical canonical forms

#### Scenario: Tool call overrides the context
- **WHEN** an agent tool deletes a main-track clip with `editContext: {magnet: false}`
- **THEN** the gap is left open and no other element moves

### Requirement: Undo and redo
The editor SHALL keep one undo history per open project, in memory, limited to 200 steps: pushing step 201 discards the oldest step. Undo reverts the most recent step and moves it to the redo stack; redo re-applies it; executing any new command clears the redo stack. Undo and redo restore the selection for commands that returned a selection patch. The history is cleared when the project is closed and is not persisted; it spans all scenes of the project, and undoing a step that belongs to a non-active scene first switches to that scene. Coalescing: consecutive executions of the same discrete action (nudge, stepper press, shortcut-driven value step) on the same selection and the same property within 1 000 ms of each other are merged into the previous history entry, so holding a key produces one step; any other action, a selection change or a pause longer than 1 000 ms starts a new entry. Results of asynchronous jobs (cutout mattes, optical-flow data, tracking data, proxies, waveform summaries) are applied as non-history updates to derived-asset references: the command by which the user enabled the feature is the only undo step, a result does not clear the redo stack, and a result for an element that no longer exists is discarded. Changes applied to the open project from the host — an accepted agent proposal or a producer update, delivered per `cross-device-sync.Single-writer edit lease` — appear in the local history of the lease-holding device as one step labelled "Agent: {title}", undoable as any other step; reverting such a change when it is not on top of a local stack is owned by `agent-editing-tools.Proposal revert`. Undo and redo buttons (toolbar on desktop/web, transport row on mobile) are disabled when their stack is empty and show the name of the step in their tooltip (e.g. "Undo Split"). Undo and redo are unavailable while a gesture is in flight. [PORT U-001, U-002, U-004] [CAPCUT CC-068] [NEW]

#### Scenario: Undo restores selection
- **WHEN** a clip is split (selecting the right half) and the step is undone
- **THEN** the original clip is whole and the selection is what it was before the split

#### Scenario: Redo cleared by a new command
- **WHEN** the user undoes a delete and then moves another clip
- **THEN** redo is disabled

#### Scenario: History limit
- **WHEN** 201 commands have been executed, each more than 1 000 ms apart
- **THEN** exactly 200 undos are possible and the first command's effect remains applied

#### Scenario: Held nudge is one step
- **WHEN** "Nudge right one frame" is invoked 30 times at 50 ms intervals on the same clip
- **THEN** the clip has moved 30 frames, one history entry was added, and one undo returns the clip to its original start

#### Scenario: Coalescing window expires
- **WHEN** the same nudge is invoked twice 1 500 ms apart
- **THEN** two history entries exist

#### Scenario: Asynchronous result
- **WHEN** a cutout job completes 20 s after the user enabled cutout and undid an unrelated step in between
- **THEN** the matte is attached without adding a history entry and redo is still available

#### Scenario: Agent change in local history
- **WHEN** an accepted proposal titled "Tighten intro" is applied while this device holds the edit lease
- **THEN** the undo tooltip reads "Undo Agent: Tighten intro" and one undo reverts the whole proposal

#### Scenario: History does not leak between projects
- **WHEN** project A is closed and project B is opened
- **THEN** undo is disabled in project B

### Requirement: Non-undoable state
The following SHALL NOT create undo steps: selection changes; scene switching, entering and exiting compound and multi-camera scenes; track solo (`project-document.Track fields`); playback, seeking and shuttle; zoom and scroll; the snapping, ripple, magnet, linkage, preview-axis, Free layer, auto-follow and loop settings (turning the magnet on while the main track has gaps additionally executes the undoable "Close gaps" command of `timeline-editing.Magnetic main track`; the setting change itself is not a step); cursor mode; keyframe-lane expansion; saved easing presets; live preview updates before commit; results of asynchronous jobs. The automatic canvas-size and frame-rate adoption on first insert is part of the insert's undo step as defined in `projects.Canvas and frame rate adoption from first media`. [PORT U-005] [NEW]

#### Scenario: Toggling snapping
- **WHEN** the user toggles snapping and then invokes undo
- **THEN** the snapping toggle keeps its new value and the previous data command is undone instead

### Requirement: Preview and commit
Continuous gestures and live controls (trim, volume line, slider drags, colour pickers, menu hover previews, graph-editor handles, agent proposals) SHALL write per-element patches to a render-only preview layer (`previewElements`) that the timeline and player display without touching project data or history. `commitPreview` converts the layer into exactly one undo step when the result differs from the stored data; `discardPreview` drops it; any direct track update clears it. Escape, pointer cancel, loss of window focus during a gesture and closing the originating control discard the preview. Autosave never persists preview-layer data. [PORT U-005, T-050]

#### Scenario: One step per gesture
- **WHEN** a trim handle is dragged through 40 intermediate positions and released
- **THEN** exactly one undo step is added

#### Scenario: Discard on cancel
- **WHEN** a trim gesture receives a pointer-cancel event
- **THEN** the element shows its stored duration and no undo step exists for the gesture

#### Scenario: Unchanged gesture
- **WHEN** a handle is dragged and returned to its original position before release
- **THEN** no undo step is added

### Requirement: Multi-element editing
With more than one element selected, timeline actions SHALL apply to every applicable selected element as one undo step: move, trim (same delta), split, delete, ripple delete, duplicate, copy, cut, hide, mute, deactivate, group, compound, rotate 90°, mirror, reverse. Elements to which an action does not apply are skipped; when it applies to none the control is disabled. The inspector shows the shared-property editor defined in `preview-canvas.Multi-selection editing`; a property edited there is written to every selected element that has it, values that differ show a "Mixed" placeholder, and relative edits (drag on a mixed number field) apply the same delta to each element. [NEW]

#### Scenario: Mute a mixed selection
- **WHEN** a text element and two audio clips are selected and Mute is invoked
- **THEN** both audio clips are muted, the text element is unchanged, and one undo step is recorded

#### Scenario: Mixed value
- **WHEN** two clips with opacity 100 % and 50 % are selected
- **THEN** the opacity field shows "Mixed" and typing 80 sets both to 80 % in one undo step

### Requirement: Automatic scene-cut detection
"Split scenes" SHALL analyse the selected video element (visible source range only), detect shot changes and split the element at each detected cut as one undo step. Detection runs on-device on decoded frames downscaled to 64 × 36 at up to 10 samples per second: for each sample a 64-bin luma histogram normalised to sum 1 is computed, the difference between consecutive samples is half the L1 distance of their histograms (range 0–1), and a cut is marked where the difference exceeds `0.8 − 0.006 × sensitivity` (sensitivity slider 1–100, default 50, giving a threshold of 0.5); each cut is refined to the exact frame by decoding the frames between the two samples and taking the frame pair with the greatest difference; cuts closer than 0.5 s to the previous cut are discarded. A progress dialog shows percentage and a Cancel button; cancelling makes no change. When no cut is found the message "No scene changes detected" is shown and no undo step is recorded. On mobile the entry is "Split scenes" in the clip strip of `mobile-editor.Video clip tool strip`. Detection of silences and filler words is a different tool, owned by `ai-editing-tools.Auto cut by silence, fillers and script`. [CAPCUT CC-069] [NEW]

#### Scenario: Two shots
- **WHEN** a 20 s clip containing a hard cut at 8 s is analysed with default sensitivity
- **THEN** the clip is split into two clips meeting at the frame of the cut and one undo joins them

#### Scenario: Sensitivity bounds
- **WHEN** the sensitivity is 1 and then 100
- **THEN** the thresholds used are 0.794 and 0.2

#### Scenario: Near cuts
- **WHEN** two hard cuts are 0.3 s apart
- **THEN** only the first produces a split

#### Scenario: Cancel
- **WHEN** the user cancels during analysis
- **THEN** the clip is unchanged and the undo stack is unchanged

### Requirement: Transcript-driven cuts
The timeline SHALL own one range-removal command, `RemoveSourceRanges {elementId, ranges[] {sourceStart, sourceEnd}}`, and nothing else of transcript editing: for each range, in descending time order, the element is split at the range's boundaries rounded to frames, the part inside the range is removed, the gap is closed on that track, and linked and attached elements shift per `timeline-editing.Video and audio linking` and `timeline-editing.Linkage`; transitions on removed cuts are removed; the whole call is one undo step and returns `{removedCount, removedDuration}` for the caller's summary. Ranges that fall outside the element's visible source range are ignored, overlapping ranges are merged, and a call that would leave less than one frame of the element is rejected with no change. The callers own everything else: the word view and deleting words in the transcript — `captions-subtitles.Transcript panel`; detection of filler words and pauses, their thresholds, padding, language lists and the review list — `ai-editing-tools.Auto cut by silence, fillers and script`; both pass their ranges to this command. With no transcript, the callers' entry points are disabled by their owners. The command is available to agents through `jc_range_delete` (`agent-editing-tools`). [CAPCUT CC-070, CC-071] [NEW]

#### Scenario: Delete a sentence
- **WHEN** the transcript panel passes the source range 4.0–6.5 s of a clip starting at 0 s
- **THEN** the clip is split into two clips meeting at 4.0 s, total track duration decreases by 2.5 s, and one undo restores the original clip

#### Scenario: Several ranges in one step
- **WHEN** three non-overlapping ranges totalling 3.2 s are passed in one call
- **THEN** four clips remain, the result reports `removedCount` 3 and `removedDuration` 3.2 s, and one undo restores the original clip

#### Scenario: Linked audio follows
- **WHEN** the element is linked to an extracted audio element
- **THEN** the same ranges are removed from the audio element in the same undo step

#### Scenario: Whole element
- **WHEN** the passed range covers the element's entire visible source range
- **THEN** the call is rejected and the element is unchanged

### Requirement: Keyframe display in the timeline
Selected elements at least 40 px wide SHALL show inline keyframe diamonds (keyframes at the same time merge into one diamond), drawn per `keyframe-animation.Keyframe diamonds on clips`. "Expand keyframes" shows one lane per animated property path under the element, with labels in the header column and the row height growing by the tallest expanded element; the lane height and diamond hit size are those of `timeline-editing.Track header column and row dimensions`, and the lane order, the persistence of the expanded state and the keyframe panel are owned by `keyframe-animation.Expanded keyframe lanes and keyframe panel` in the group order of `keyframe-animation.Animatable property paths`. Selection, dragging, box-selecting, copying and editing of keyframes and the graph editor are defined in `keyframe-animation`. [PORT T-063] [NEW]

#### Scenario: Merged diamond
- **WHEN** a selected element has position and opacity keyframes at the same time
- **THEN** one inline diamond is shown at that time

#### Scenario: Narrow clip
- **WHEN** a selected element is 30 px wide at the current zoom
- **THEN** no inline diamonds are drawn

#### Scenario: Row grows with lanes
- **WHEN** keyframes are expanded on an element with three animated property paths on a 65 px row
- **THEN** the row is 125 px high

### Requirement: Mobile timeline gestures
Touch gestures, their timings, sizes and haptics are owned by `mobile-editor` (`mobile-editor.Touch gesture constants`, `mobile-editor.Fixed-centre playhead timeline`, `mobile-editor.Timeline pinch zoom and ruler`, `mobile-editor.Selection, trim handles and clip badges`, `mobile-editor.Trim by handle drag`, `mobile-editor.Long-press reorder and move`, `mobile-editor.Haptics`); this requirement defines what each gesture does to the timeline. On touch devices the timeline SHALL respond as follows: a tap on a clip performs the click selection of `timeline-editing.Click selection` and a tap on empty area deselects; a horizontal drag scrolls content under the fixed-centre playhead and seeks; a pinch zooms anchored at the playhead per `timeline-editing.Timeline zoom`; dragging a trim handle performs `timeline-editing.Trimming elements` with the player showing the frame at the trimmed edge; the long-press on a main-track clip enters reorder mode, in which a drag reorders the clip by the magnet rules of `timeline-editing.Magnetic main track`; the long-press on a non-main clip starts `timeline-editing.Moving elements` in time and between tracks; a double-tap on a text or caption clip opens its content for editing; a vertical drag scrolls tracks. Every gesture commits through the same commands as desktop and yields the same undo steps and state patches. There are no two-finger-tap or three-finger-tap gestures for undo and redo: undo and redo on touch are the transport-row buttons. Context actions are presented in the toolbars and bottom sheets of `mobile-editor`, never in hover menus. [NEW]

#### Scenario: Reorder on mobile
- **WHEN** the user long-presses the first main-track clip, drags it after the second and lifts
- **THEN** the main track order is second, first, contiguous from 0, in one undo step

#### Scenario: Pinch zoom keeps the playhead time
- **WHEN** the user pinches out with the current time at 12 s
- **THEN** the zoom increases and the time under the centre playhead remains 12 s

#### Scenario: Trim preview
- **WHEN** the user drags a clip's right handle
- **THEN** the player shows the frame at the clip's new last frame while dragging and returns to the playhead frame on release

#### Scenario: Same result as desktop
- **WHEN** the same trim is performed by a touch drag on a phone and by a pointer drag on desktop on equivalent states
- **THEN** both produce identical project data and one undo step each

### Requirement: Timeline actions for mobile toolbars
The mobile toolbars, strips and sheets are owned by `mobile-editor` (`mobile-editor.Root toolbar`, `mobile-editor.Video clip tool strip`, `mobile-editor.Two-level bottom toolbar`); this requirement defines the timeline actions they invoke. Every timeline function SHALL have a mobile entry in the table below or be in the declared-unavailable list after it. Each row is an action of the action registry with the same behaviour as on desktop:

| Function | Action ids | Mobile entry that invokes it | Behaviour on mobile |
|---|---|---|---|
| Split, Delete, Duplicate, Freeze, Replace | `timeline.split`, `timeline.delete`, `timeline.duplicate`, `timeline.freeze`, `timeline.replace-media` | `mobile-editor.Video clip tool strip` (and the audio, text, sticker and effect strips for the actions that apply to those types) | as on desktop; Split acts at the fixed-centre playhead; Delete on the main track closes the gap through the magnet rule |
| Track controls | `timeline.track.rename`, `timeline.track-lock.toggle`, `timeline.track.hide.toggle`, `timeline.track.mute.toggle`, `timeline.track.solo.toggle`, `timeline.track.move-up`, `timeline.track.move-down`, `timeline.track.delete`, `timeline.track.add` | "Tracks" tab of `mobile-editor.Layers sheet` | one row per track of the active scene in stack order with inline rename, Hide, Lock and, on audio-capable tracks, Mute, Solo, Volume and Pan (`audio-editing.Track volume, pan and solo`); the drag handle reorders within the overlay or audio group |
| Multi-camera angle | `timeline.multicam.switch-angle-1` … `timeline.multicam.switch-angle-8` | "Angle" item of `mobile-editor.Compound clip tool strip`, shown for a multi-camera part | lists the angles by name; choosing one switches at the playhead per `timeline-editing.Multi-camera clip` |
| Multi-camera creation, source editing, audio and flatten | `timeline.multicam.create`, `timeline.multicam.flatten` (and the strip tools `multi.multicam`, `multicam.edit-source`, `multicam.audio`, `multicam.flatten` of `mobile-editor`) | "Multi-camera" of `mobile-editor.Multi-select tool strip`; "Edit source", "Audio" and "Flatten" of `mobile-editor.Compound clip tool strip` | the same commands, sync methods, limits and undo steps as on desktop, on iPhone, iPad and Android phones and tablets (decision E5) |
| Markers | `marker.toggle`, `timeline.marker.edit`, `timeline.marker.delete`, `timeline.marker.delete-all`, `marker.next`, `marker.previous` | `mobile-editor.Markers on mobile` | add or remove at the playhead, navigate, list, and edit note, colour and duration with the fields and limits of `timeline-editing.Marker interaction` |
| Scenes | `timeline.scenes.open` | `mobile-editor.More sheet` | opens the Scenes sheet with switch, create, rename, reorder, duplicate and delete |
| Compound clips | `timeline.compound.create`, `timeline.compound.edit`, `timeline.compound.exit`, `timeline.compound.dissolve` | `mobile-editor.Multi-select tool strip` and `mobile-editor.Video clip tool strip` (create), `mobile-editor.Compound clip tool strip` (edit, exit, dissolve) | Create for the selection; on a compound clip "Edit compound" and "Undo compound"; inside a compound scene the breadcrumb above the ruler and the exit control invoke exit |
| Paste | `timeline.paste` | `mobile-editor.Root toolbar` (shown first while the editor clipboard is non-empty) | pastes at the playhead per `timeline-editing.Clipboard` |
| Copy, Cut, Group, Ungroup, Link, Unlink, Hide, Deactivate | `timeline.copy`, `timeline.cut`, `timeline.group`, `timeline.ungroup`, `timeline.link`, `timeline.unlink`, `timeline.toggle-hidden`, `timeline.activate.toggle` | `mobile-editor.Video clip tool strip`, `mobile-editor.Multi-select tool strip` | as on desktop |
| To overlay / To main track | `timeline.to-overlay`, `timeline.to-main` | `mobile-editor.Video clip tool strip` | as defined in `timeline-editing.Moving elements` |
| Auto snapping | `timeline.snapping.toggle` | `mobile-editor.More sheet` switch | same stored preference as desktop |
| Linkage | `timeline.linkage.toggle` | `mobile-editor.More sheet` switch | same stored preference as desktop |
| Free layer | `timeline.toggle-free-layer` | `mobile-editor.More sheet` switch | `timeline-editing.Free layer mode` |
| Multi-selection | `timeline.select-mode` | `mobile-editor.More sheet` ("Select") | taps toggle elements of unlocked tracks in the selection |
| In/out range | `range.set-in`, `range.set-out`, `range.set-to-selection`, `range.clear` | `mobile-editor.More sheet` | sets or clears at the playhead, or from the selection |
| Split scenes | `timeline.split-scenes` | `mobile-editor.Video clip tool strip` | `timeline-editing.Automatic scene-cut detection` |
| Per-clip background | `timeline.background.edit` | `mobile-editor.Root toolbar` ("Background") | `timeline-editing.Per-clip canvas background` |

Declared unavailable on mobile (iOS and Android), with no entry, listed by action id: `timeline.magnet.toggle` (the magnet is on whenever Free layer is off; `timeline-editing.Magnetic main track`), `timeline.ripple.toggle` (`timeline-editing.Ripple mode`), `timeline.preview-axis.toggle`, `tools.select`, `tools.blade`, `timeline.cursor.select-left`, `timeline.cursor.select-right`, `timeline.split-all`, `timeline.delete-left`, `timeline.delete-right`, `timeline.ripple-delete`, `timeline.nudge-left`, `timeline.nudge-right`, `timeline.nudge-left-10`, `timeline.nudge-right-10`, `timeline.trim-start-to-playhead`, `timeline.trim-end-to-playhead`, `timeline.zoom-in`, `timeline.zoom-out`, `timeline.zoom-fit` (zoom is the pinch gesture of `timeline-editing.Mobile timeline gestures`), `timeline.multicam.create`, `timeline.multicam.flatten`; and, as functions without an action id, box selection by marquee (multi-select uses the tool of `mobile-editor.Selection, trim handles and clip badges`) and the desktop track header column (its controls are the "Tracks" tab above). Actions owned by other capabilities that share the `timeline.` prefix (for example `timeline.reverse` of `speed-retime`) are accounted for by their owner's mobile table. An action invoked on mobile with nothing to act on is disabled in its entry with the same reason text as on desktop. [CAPCUT CC-048, CC-049, CC-052, CC-053, CC-055] [NEW]

#### Scenario: Add a marker on a phone
- **WHEN** `marker.toggle` is invoked from the mobile Markers group with the playhead at 3 s
- **THEN** a marker flag appears on the ruler at 3 s and one undo removes it

#### Scenario: Paste on a phone
- **WHEN** a clip was copied and `timeline.paste` is invoked with the playhead at 10 s
- **THEN** a copy starts at 10 s, is selected, and one undo removes it

#### Scenario: Create a compound clip on a phone
- **WHEN** two clips are multi-selected and `timeline.compound.create` is invoked
- **THEN** one compound element replaces them, and its strip offers "Edit compound" and "Undo compound"

#### Scenario: Linkage switch is the same preference
- **WHEN** Linkage is switched off on a phone and the first main-track clip is deleted
- **THEN** elements on other tracks keep their start times, and the `timeline.linkage` preference reads off

#### Scenario: Every registered timeline action is accounted for
- **WHEN** the list of `timeline.*` actions in the action registry is compared with this requirement
- **THEN** every action whose owner is this capability either has a mobile entry in the table (by its exact id, or by the listed range `switch-angle-1` … `-8`) or appears by id in the declared-unavailable list, and the comparison is a CI test that fails on an unlisted id

#### Scenario: Track controls on a phone
- **WHEN** the "Tracks" tab of the Layers sheet is opened in a scene with one overlay text track, the main track and one audio track
- **THEN** it lists three rows; the audio row offers Mute, Solo, Volume, Pan, Lock and rename and no Hide; locking the text track there makes its clips refuse edits exactly as `timeline-editing.Track lock` defines

### Requirement: Timeline accessibility and keyboard operation
The timeline SHALL be operable without a pointer on desktop and web: focus moves between toolbar, track headers, track rows and ruler with the focus-navigation keys of `i18n-accessibility.Keyboard access to the timeline and player`, and focus can always leave the timeline; within a track row focus moves between elements and between tracks; the activate key selects the focused element (toggling with the platform modifier); with an element selected, the actions `timeline.nudge-left`, `timeline.nudge-right` (one frame), `timeline.nudge-left-10`, `timeline.nudge-right-10` (10 frames), `timeline.trim-start-to-playhead`, `timeline.trim-end-to-playhead`, `timeline.move-track-up` and `timeline.move-track-down` are available and obey the same overlap, lock and clamp rules as pointer edits, without snapping. All bindings are stated only in `keyboard-shortcuts`. Each track row is exposed as a list with its name; each element exposes role, name, start and duration as text (for example "Video clip, beach.mp4, starts 00:00:04:00, duration 00:00:06:15") and its selected, hidden, muted and locked states. Focus indicators meet the 3:1 contrast requirement of `i18n-accessibility.Focus visibility and management`. [NEW]

#### Scenario: Nudge
- **WHEN** a selected overlay clip starting at frame 30 with free space on both sides is nudged right one frame
- **THEN** it starts at frame 31 and one undo step is recorded

#### Scenario: Nudge blocked by a neighbour
- **WHEN** the clip's end touches the next clip on the same track and it is nudged right with ripple off
- **THEN** the clip does not move and no undo step is recorded

#### Scenario: Trim end to playhead
- **WHEN** a 10 s clip starting at 0 s is selected, the playhead is at 6 s and `timeline.trim-end-to-playhead` is invoked
- **THEN** the clip lasts 6 s, recorded as one undo step

#### Scenario: Screen-reader description
- **WHEN** focus lands on a muted audio clip
- **THEN** its accessible description includes its name, start, duration and the state "muted"
