## ADDED Requirements

### Requirement: Mobile entry from home
On phones and tablets the home layout, the project grid and the Templates entry SHALL be those of `app-shell-navigation.Mobile home with project grid`, and project creation ("New project" with the ordered multi-select picker, "Add (N)" disabled at N = 0, "Blank project", default canvas and frame rate, canvas adoption from the first item) SHALL be that of `projects.Create project` and `projects.Canvas and frame rate adoption from first media`; this capability adds no creation rule of its own. Items confirmed in the picker SHALL be placed on the main track in selection order by strategy `mainInsert` of `timeline-editing.Placement strategies`, and the editor SHALL open on the new project. Tapping a project tile SHALL open it in the editor at the playhead position stored for this device in `local.timelineViewState.playheadTime` (`project-document.Device-local section`); a project whose `template.locked` is `true` (`project-document.Template mode model`) opens in `mobile-editor.Template editor variant` instead. [CAPCUT CC-286]

#### Scenario: New project from three clips
- **WHEN** the user taps New project, selects clips B, A and C in that order and confirms
- **THEN** the editor opens with B, A and C edge to edge on the main track

#### Scenario: Reopen
- **WHEN** the user taps an existing project last left at 12 s
- **THEN** the editor opens with the playhead at 12 s

#### Scenario: Nothing picked
- **WHEN** the picker is open with no item selected
- **THEN** "Add (0)" is disabled and "Blank project" is enabled

### Requirement: Portrait screen structure
On phones in portrait the editor SHALL be laid out top to bottom as: (1) top bar, 44 pt high below the top safe-area inset; (2) preview region, flexible, never less than 35 % of the screen height; (3) transport row, 40 pt; (4) timeline region (ruler 20 pt, marker flags on the ruler, main track, secondary lanes); (5) bottom toolbar, 64 pt plus the bottom safe-area inset. No region SHALL overlap another, and content SHALL NOT be placed under the notch, the home indicator or the Android gesture bar. The editor SHALL use the colour, type, radius and motion tokens of `design-system.Token source and theming contract` in both light and dark themes, with the preview and timeline regions always drawn on the editor surface token `bg/editor` of `design-system.Editor colour tokens`. The structure, every toolbar, strip and sheet of this capability and every gesture SHALL be identical on iOS and Android; the only platform differences are the ones this capability names explicitly (system back, safe-area insets and the native mechanisms behind the product-owned modules); sizes are the same number of pt on iOS and dp on Android. The 35 % minimum preview height holds for the editor and for every tool sheet; the closed list of exceptions is in `mobile-editor.Tool sheets never cover the preview`. [CAPCUT CC-287] [NEW]

#### Scenario: Region order
- **WHEN** the editor is opened on a 390×844 pt phone
- **THEN** the five regions appear in the stated order and the preview region is at least 295 pt high

#### Scenario: Small phone
- **WHEN** the editor is opened on a 320×568 pt phone
- **THEN** the preview is at least 199 pt high and the timeline region shrinks to keep the toolbar fully visible

### Requirement: Top bar
The top bar SHALL contain, left to right: Close (flushes the pending save and returns to home); Help (opens gesture tips); a flexible gap showing the save-state indicator of `projects.Autosave and unsaved-work protection` (its five states and its failed-save actions, unchanged); an overflow menu with Project settings (`projects.Project settings surface`), Save as template (`templates.Create a template from a project`), Rename (`projects.Rename project`), Version history (`project-storage.Version snapshots`) and Connection status (`cross-device-sync.Sync status and activity`); an Agent button; the export settings chip showing the current resolution (for example "1080P ▾") or format ("GIF ▾"); and the primary Export button. The Agent button SHALL open `app-shell-navigation.Editor agent panel` as an overlay sheet (`mobile-editor.Tool sheets never cover the preview`) covering the editor; with no host connected it SHALL open the requires-host sheet of `mobile-editor.Two-level bottom toolbar` instead. Close SHALL NOT leave the editor while the save state is "Save failed" without the confirmation defined by `projects.Autosave and unsaved-work protection`. [CAPCUT CC-287] [NEW]

#### Scenario: Close saves
- **WHEN** the user taps Close 200 ms after an edit
- **THEN** the edit is persisted before the home screen is shown

#### Scenario: Export chip
- **WHEN** the export resolution is 1080p
- **THEN** the chip reads "1080P ▾" and tapping it opens the export quick sheet

#### Scenario: Agent without a host
- **WHEN** no host is connected and the user taps Agent
- **THEN** the requires-host sheet is shown and the project is unchanged

#### Scenario: Agent with a host
- **WHEN** a host is connected and the user taps Agent
- **THEN** an overlay sheet covering the editor shows the chat pane for the most recent session bound to this project

### Requirement: Transport row
The transport row SHALL contain: Fullscreen (left); current time and total duration as `MM:SS / MM:SS` (`H:MM:SS` from one hour), not editable; Play/Pause (centre, 44×44 pt hit area); and at the right the keyframe button, Undo and Redo. Undo and Redo SHALL be disabled when their history is empty and SHALL show a toast naming the undone or redone action (for example "Undo: Split"). Undo and redo on touch SHALL be available only through these two buttons and a hardware keyboard; no multi-finger tap gesture is assigned to them. The keyframe button's behaviour (property group, add and remove states, disabled states, one batch command per tap) SHALL be that of `keyframe-animation.Mobile keyframe button`. Playback behaviour SHALL be that of `preview-canvas.Play, pause and stop`, `preview-canvas.End-of-timeline behaviour` and `preview-canvas.Loop playback`. [CAPCUT CC-068, CC-287] [NEW]

#### Scenario: Undo toast
- **WHEN** the user splits a clip and taps Undo
- **THEN** the split is reverted and a toast reads "Undo: Split"

#### Scenario: Empty history
- **WHEN** a project is opened and no edit has been made
- **THEN** Undo and Redo are disabled

#### Scenario: Two-finger tap does nothing to history
- **WHEN** the user taps the preview with two fingers after an edit
- **THEN** the undo history is unchanged

### Requirement: Touch gesture constants
This requirement is the single source of touch values for the mobile timeline and canvas; other capabilities reference it and SHALL NOT state competing values. The mobile editor SHALL use: long press — 400 ms without more than 8 pt of travel, after which a drag starts once the finger has travelled 8 pt; timeline snap threshold — 12 pt; trim handle — 20 pt visible width with a 44 pt hit width; transition junction button — 24×24 pt visible with a 44×44 pt hit area; canvas handle hit area — 44×44 pt; edge auto-scroll zone — 40 pt from the left or right screen edge, scrolling at 200–1 200 pt/s proportional to proximity; double-tap interval — 300 ms; minimum interactive target — 44×44 pt on iOS and 44×44 dp on Android (one number on both systems, as `i18n-accessibility.Touch target size and gesture alternatives` requires); minimum interval between two haptics — 60 ms. [NEW]

#### Scenario: Long press threshold
- **WHEN** the user holds a main-track clip for 390 ms and lifts
- **THEN** the clip is selected by tap and reorder mode is not entered

#### Scenario: Long press reached
- **WHEN** the user holds a main-track clip for 400 ms without moving more than 8 pt
- **THEN** reorder mode is entered

### Requirement: Fixed-centre playhead timeline
The playhead SHALL be a fixed vertical line at the horizontal centre of the timeline region; the timeline content SHALL scroll underneath it, with empty padding of half the viewport width before time 0 and after the scene end so that both ends can reach the playhead. Horizontal dragging SHALL scroll with inertia (deceleration 0.998 per ms) and SHALL seek continuously: the playhead time SHALL be the content time under the centre line, snapped to a frame, and the preview SHALL show that frame. Touching the timeline during playback SHALL pause playback. During playback the content SHALL scroll so that the centre line stays at the current time. Vertical dragging SHALL scroll the lanes when they exceed the region height. Tapping empty timeline SHALL clear the selection and SHALL NOT seek. [CAPCUT CC-287] [NEW]

#### Scenario: Scroll seeks
- **WHEN** the user drags the timeline left by a distance equal to 2 s at the current zoom
- **THEN** the playhead time increases by 2 s and the preview shows the new frame

#### Scenario: Touch pauses
- **WHEN** playback is running and the user touches the timeline
- **THEN** playback pauses at the current frame

#### Scenario: Ends reachable
- **WHEN** the user scrolls fully right
- **THEN** the playhead is exactly at time 0 and cannot go before it

### Requirement: Timeline pinch zoom and ruler
A two-finger pinch on the timeline SHALL zoom horizontally about the playhead (the time under the centre line stays fixed). The zoom range SHALL be from the scale at which the whole scene fits within the viewport width (not below 2 pt per second) up to 24 pt per frame. The ruler SHALL show tick labels in seconds (`MM:SS`) with an interval chosen from 1 frame, 5 frames, 1 s, 2 s, 5 s, 10 s, 30 s, 1 min, 5 min so that labels are at least 56 pt apart, and frame labels (`Nf`) when zoomed beyond 8 pt per frame. The zoom level SHALL be stored per project per device in `local.timelineViewState.zoomLevel` (`project-document.Device-local section`). [CAPCUT CC-063] [NEW]

#### Scenario: Zoom keeps the playhead time
- **WHEN** the playhead is at 5 s and the user pinches out
- **THEN** the playhead is still at 5 s and clips are wider

#### Scenario: Maximum zoom
- **WHEN** the user keeps pinching out
- **THEN** zoom stops at 24 pt per frame and the ruler shows frame labels

### Requirement: Main track filmstrip and magnetism
The main track SHALL be a continuous filmstrip at the mobile main-row height of `timeline-editing.Track header column and row dimensions` (56 pt) in which each clip shows frame thumbnails sampled across its own time range (one thumbnail per 56 pt of width, not one repeated image), with clips placed edge to edge. The main track SHALL be magnetic on mobile at all times unless Free layer is on (`mobile-editor.More sheet`): deleting, trimming, inserting or reordering a main-track clip SHALL ripple the following main-track clips as defined by `timeline-editing.Magnetic main track`; whether linked overlay items ripple follows `timeline-editing.Linkage`. A transition junction button with the size of `mobile-editor.Touch gesture constants` SHALL be shown on every eligible cut of the main track always, and on every eligible cut of an overlay lane while that lane is expanded; its appearance and the sheet it opens are defined by `transitions.Apply a transition on mobile` (see `mobile-editor.Transition slot sheet`). [CAPCUT CC-018, CC-047, CC-099] [NEW]

#### Scenario: Delete closes the gap
- **WHEN** the user deletes the second of three main-track clips
- **THEN** the third clip moves left to touch the first

#### Scenario: Filmstrip thumbnails
- **WHEN** a 20 s clip is 560 pt wide
- **THEN** it shows 10 thumbnails taken at 2 s intervals

#### Scenario: Junction on a collapsed overlay lane
- **WHEN** two overlay clips share a cut and the overlay lanes are collapsed
- **THEN** no junction button is drawn on that cut, and entering the Overlay group shows it

### Requirement: Add-clip button
A 36×36 pt "+" button SHALL be shown immediately after the last main-track clip and SHALL also stay pinned at the right edge of the timeline region (above the lanes, vertically centred on the main track) while the end of the track is scrolled out of view. Tapping it SHALL open the ordered multi-select media picker of `media-library.Media library on mobile`; confirmed video, image and compound items SHALL be inserted in selection order by strategy `mainInsert` of `timeline-editing.Placement strategies` as one undo step (with Free layer on, by `timeline-editing.Free layer mode`). In an empty project the main track SHALL show a full-width "Add media" button instead. [CAPCUT CC-018] [NEW]

#### Scenario: Append
- **WHEN** the playhead is at the end of the timeline and the user adds two clips
- **THEN** both are appended in selection order

#### Scenario: Insert at nearest cut
- **WHEN** the playhead is 1 s into a 10 s clip and the user adds a clip
- **THEN** the new clip is inserted before that clip and following clips ripple right

#### Scenario: Empty project
- **WHEN** the project has no element
- **THEN** the main track shows the full-width "Add media" button and no "+" button

### Requirement: Mute-all and cover entries
At the left of the main track (fixed, not scrolling) there SHALL be two 56×56 pt buttons: "Mute clip audio", which toggles the mute state of every main-track video clip's source audio (`audio-editing.Video source audio`) as one undo step and shows the label "Unmute clip audio" when all are muted; and "Cover", which opens `projects.Cover editor` and shows the current cover thumbnail. [CAPCUT CC-013, CC-214] [NEW]

#### Scenario: Mute all
- **WHEN** the user taps "Mute clip audio" with three unmuted clips on the main track
- **THEN** all three show the mute icon, playback has no clip audio, and one undo restores them

#### Scenario: Cover
- **WHEN** the user taps Cover
- **THEN** the cover editor opens and, after a cover is chosen, the button shows its thumbnail

### Requirement: Secondary lanes
Below the main track the timeline SHALL show: an "Add audio" row (visible while the scene has no audio element; tapping opens the Audio group); and lanes for audio, text, caption, sticker and shape, overlay (picture-in-picture), effect (including standalone filters, which are effect elements with one filter entry) and adjustment elements. Outside its tool group each element type SHALL be drawn collapsed as 4 pt high coloured strips (at most 3 strips per type, the rest merged into the last). Inside the corresponding group (or when an element of that type is selected) its lanes SHALL expand to the mobile row heights of `timeline-editing.Track header column and row dimensions` with an icon and label; audio bars SHALL show the waveform of `audio-editing.Waveform rendering`; overlay bars SHALL show thumbnails. Fill colours SHALL be the `clip/*` tokens of `design-system.Editor colour tokens` (including `clip/overlay`); no colour value is defined here. Tapping a collapsed strip SHALL enter its group and select the element.

Mobile has no track header column. Its replacement is the **lane label**: every expanded lane and the main track SHALL show, fixed at the left edge of the timeline region (not scrolling), a 44×44 pt button with the track-type icon and up to four 10 pt state badges for the track fields of `project-document.Track fields` — locked, hidden, muted, solo — drawn only while the state is on. Tapping a lane label SHALL open `mobile-editor.Layers sheet` on its Tracks tab with that track's row scrolled into view and highlighted for 1 s. A long press (`mobile-editor.Touch gesture constants`) on the lane label of a caption track SHALL select every caption of that track and show the batch strip of `mobile-editor.Caption tool strips`; a long press on any other lane label SHALL select every element of that track and show `mobile-editor.Multi-select tool strip`. Elements of a locked track SHALL be drawn at 50 % opacity and SHALL NOT be selectable, trimmable or draggable (a tap shows the toast "Track is locked" with the action "Unlock"); elements of a hidden track SHALL be drawn hatched. Every track-level control — rename, lock, hide, mute, solo, volume, pan, reorder, delete — lives in the Tracks tab of `mobile-editor.Layers sheet`; this requirement and that sheet are the mobile owners of the controls that `timeline-editing.Track state flags`, `timeline-editing.Track header column and row dimensions` and `audio-editing.Track volume, pan and solo` place in the header column on desktop and web. [CAPCUT CC-027, CC-058] [NEW]

#### Scenario: Collapsed strips
- **WHEN** the root toolbar is shown and the scene has 2 text elements and 1 music clip
- **THEN** text and audio are drawn as 4 pt coloured strips under the main track

#### Scenario: Expand in group
- **WHEN** the user taps Text
- **THEN** the text lanes expand to labelled bars and other types stay collapsed

#### Scenario: Add audio row
- **WHEN** the scene has no audio element
- **THEN** the "Add audio" row is shown and tapping it opens the Audio group

#### Scenario: Lane label opens the Tracks tab
- **WHEN** the Audio group is open and the user taps the lane label of the second audio track
- **THEN** the Layers sheet opens on the Tracks tab with the row of that track highlighted

#### Scenario: Badges show track state
- **WHEN** an audio track has `muted: true` and `locked: true`
- **THEN** its lane label shows the muted and the locked badge and no other badge

#### Scenario: Locked track refuses a tap
- **WHEN** the user taps a clip on a locked overlay track
- **THEN** the clip is not selected and the toast "Track is locked" with "Unlock" is shown

#### Scenario: Long press on a caption lane label
- **WHEN** the user long-presses the lane label of a caption track with 40 captions
- **THEN** the 40 captions are selected and the batch caption strip is shown

### Requirement: Selection, trim handles and clip badges
Tapping a clip or bar SHALL select it (tapping it again SHALL keep it selected; tapping empty space SHALL deselect) and switch the bottom toolbar to that element type's tool strip. A selected element SHALL show the selection outline token `timeline/selection`, trim handles at both ends with the size of `mobile-editor.Touch gesture constants`, and a duration badge to one decimal ("22.1s"). Clips SHALL also show, when applicable: the speed badge of `speed-retime.Speed badges on clips`, a mute icon, the keyframe diamonds of `keyframe-animation.Keyframe diamonds on clips`, a reversed icon, an effect, filter or adjustment indicator, the provenance chip of `timeline-editing.Element provenance link`, and a missing-media warning. Multi-selection SHALL be entered by long-pressing empty lane space and dragging a selection rectangle, or through "Select" in `mobile-editor.More sheet`; with two or more elements selected the toolbar SHALL show `mobile-editor.Multi-select tool strip`. [CAPCUT CC-028, CC-289] [NEW]

#### Scenario: Select a clip
- **WHEN** the user taps a 22.1 s clip
- **THEN** trim handles and a "22.1s" badge appear and the toolbar shows the video clip strip

#### Scenario: Speed badge
- **WHEN** a clip plays at 5×
- **THEN** it shows the badge "5.0x"

#### Scenario: Rectangle multi-selection
- **WHEN** the user long-presses empty lane space for 400 ms and drags a rectangle across three bars
- **THEN** the three bars are selected and the toolbar shows the multi-select strip

### Requirement: Trim by handle drag
Dragging a trim handle SHALL trim that edge through `timeline-editing.Trimming elements`, limited by the source media, by a minimum duration of 1 frame and, for secondary lanes, by the neighbouring element. While trimming, the preview SHALL show the frame at the dragged edge and the duration badge SHALL update live. The edge SHALL snap, within the snap threshold of `mobile-editor.Touch gesture constants`, to the candidates of `timeline-editing.Snapping` (playhead, element edges, markers, beat markers) while "Auto snapping" is on, with a light haptic on each snap. Holding the finger inside the edge auto-scroll zone SHALL auto-scroll the timeline. Trimming a main-track clip SHALL ripple following clips; trimming its start SHALL keep the clip's left edge visually under the finger while the content after it shifts. Each trim SHALL be one undo step. [CAPCUT CC-028] [NEW]

#### Scenario: Trim the end
- **WHEN** the user drags the right handle of a 10 s main-track clip left by 3 s
- **THEN** the clip is 7 s long and the following clips move 3 s earlier

#### Scenario: Source limit
- **WHEN** the user drags the right handle beyond the end of the source media
- **THEN** the handle stops at the source end with a rigid haptic

#### Scenario: Snap to playhead
- **WHEN** the dragged edge comes within 12 pt of the playhead with Auto snapping on
- **THEN** it snaps to the playhead time and a light haptic fires

#### Scenario: Snapping off
- **WHEN** Auto snapping is off and the dragged edge passes within 5 pt of the playhead
- **THEN** the edge follows the finger without snapping and no haptic fires

### Requirement: Long-press reorder and move
A long press (`mobile-editor.Touch gesture constants`) on a main-track clip SHALL enter reorder mode: a medium haptic fires, all main-track clips collapse to 56×56 pt tiles, and the pressed tile follows the finger; tiles shift to show the drop position and the timeline auto-scrolls near the edges; releasing drops the clip at that position as one undo step. A long press on a secondary bar SHALL pick it up for free movement in time and between lanes of a compatible type through `timeline-editing.Moving elements`, with the snapping of `mobile-editor.Trim by handle drag` and overlap resolution by `timeline-editing.Overlap rule`. Dragging an overlay clip onto the main track, or a main-track clip downward out of it, SHALL convert between main and overlay placement exactly as the tools "To main track" and "To overlay" of `mobile-editor.Video clip tool strip` do. Releasing outside a valid target SHALL return the element to its origin. [CAPCUT CC-038, CC-059] [NEW]

#### Scenario: Reorder
- **WHEN** the user long-presses the first clip and drops it after the third
- **THEN** the order becomes 2, 3, 1 and one undo restores 1, 2, 3

#### Scenario: Move a text bar
- **WHEN** the user long-presses a text bar and drags it 2 s to the right
- **THEN** the text starts 2 s after its previous start and its duration is unchanged

#### Scenario: Cancelled drop
- **WHEN** the user releases a picked-up bar over the ruler
- **THEN** the bar returns to its original position and no undo step is added

### Requirement: On-canvas element handles
A selected visual element SHALL show a bounding box in the preview. Text, caption, sticker, shape and overlay elements SHALL additionally show four 28 pt corner buttons with 44 pt touch targets: Delete (top-left), Edit (top-right; opens the text sheet, or Replace for stickers and overlays), Duplicate (bottom-left) and Scale/Rotate (bottom-right; dragging scales uniformly about the centre and rotates by the angle of the drag about the centre). One-finger drag on the element SHALL move it; two-finger pinch and twist SHALL scale and rotate it; double-tap on a text or caption element SHALL open the text sheet. Movement, scale and rotation semantics, keyframe handling and snapping SHALL be those of `preview-canvas.Move elements on the canvas`, `preview-canvas.Scale with handles`, `preview-canvas.Rotate with the handle` and `preview-canvas.Preview snapping`, with a light haptic on each snap. With no element selected, two-finger gestures SHALL zoom and pan the preview (`preview-canvas.Zoom by wheel, pinch and commands`, `preview-canvas.Preview pan`). Each gesture SHALL be one undo step. [CAPCUT CC-046] [NEW]

#### Scenario: Scale and rotate from the corner
- **WHEN** the user drags the Scale/Rotate button outward and around
- **THEN** the element grows about its centre and rotates with the drag

#### Scenario: Delete from the canvas
- **WHEN** the user taps the Delete corner button
- **THEN** the element is removed and one undo restores it

### Requirement: Two-level bottom toolbar
The bottom toolbar SHALL be a horizontally scrollable strip of tool items (icon 22 pt above a 10 pt label, each item at least 60 pt wide with a 44 pt touch target). This capability is the only place where mobile toolbars, per-context tool strips and their order and labels are defined; every other capability contributes the content of the panel a tool opens and references the strip here. With nothing selected the strip SHALL show the root toolbar. Tapping a group SHALL replace the strip with that group's sub-toolbar preceded by a fixed back button ("«") at the far left; selecting an element SHALL replace the strip with that element type's tool strip, also with the back button, which deselects and returns to the level the user came from. The system back action — the back gesture or button on Android and the edge swipe from the leading screen edge on iOS — SHALL act as the back button, then close the editor only from the root level. Strip changes SHALL animate with a 140 ms ease-out slide and SHALL be instant when "reduce motion" is on. Every tool SHALL have a stable `toolId` (listed in the strip tables) used for its locale key `mobile.tool.<toolId>`, its accessibility identifier and tests. A `toolId` names a toolbar entry and is not an action id: a tool that runs an action of `keyboard-shortcuts.Action registry` runs the registry action that the requirement in its row names, with the registry's spelling — for example the tools `clip.split`, `clip.delete`, `clip.duplicate`, `clip.reverse` and `clip.freeze` run `timeline.split`, `timeline.delete`, `timeline.duplicate`, `timeline.reverse` and `timeline.freeze` — and no `toolId` is ever registered as an action. Tools whose feature is listed as requiring a host in `app-shell-navigation.Features that require a host` SHALL show a small link badge and, while no host is connected, SHALL open a sheet titled "Requires a host" with the action "Connect a host" instead of the tool. Tools that do not apply to the selected element SHALL be omitted, never shown disabled. [CAPCUT CC-287] [NEW]

#### Scenario: Enter and leave a group
- **WHEN** the user taps Audio and then the back button
- **THEN** the audio sub-toolbar is shown, then the root toolbar

#### Scenario: Selection swaps the strip
- **WHEN** the user taps a video clip while the root toolbar is shown
- **THEN** the video clip strip is shown with a back button, and tapping back deselects the clip and shows the root toolbar

#### Scenario: Host-dependent tool offline
- **WHEN** the user taps a tool that carries the link badge while no host is connected
- **THEN** the "Requires a host" sheet is shown with "Connect a host" and the project is unchanged

#### Scenario: System back at root
- **WHEN** the root toolbar is shown and the user performs the system back action (Android back, or the iOS edge swipe)
- **THEN** the pending save is flushed and the editor closes

### Requirement: Root toolbar
With nothing selected the strip SHALL contain these items in this order:

| # | Label | `toolId` | Opens |
|---|---|---|---|
| 0 | Paste (shown only while the editor clipboard is non-empty) | `root.paste` | pastes at the playhead through `timeline-editing.Clipboard` |
| 1 | Edit | `root.edit` | selects the main-track clip under the playhead and shows `mobile-editor.Video clip tool strip` |
| 2 | Audio | `root.audio` | `mobile-editor.Audio group and audio clip strips` |
| 3 | Text | `root.text` | `mobile-editor.Text group, text clip and sticker strips` |
| 4 | Stickers | `root.stickers` | sheet of `stickers-shapes.Stickers panel and categories` |
| 5 | Overlay | `root.overlay` | `mobile-editor.Overlay group` |
| 6 | Effects | `root.effects` | Effects group of `mobile-editor.Effect, filter and adjustment bar strips` |
| 7 | Filters | `root.filters` | combined sheet of `mobile-editor.Effect, filter and adjustment bar strips`, tab Filters |
| 8 | Adjust | `root.adjust` | the same combined sheet, tab Adjust |
| 9 | Captions | `root.captions` | Captions group of `mobile-editor.Captions, Stickers, Templates and AI tools groups` |
| 10 | Templates | `root.templates` | Templates sheet of the same requirement |
| 11 | Aspect ratio | `root.ratio` | canvas ratio sheet of `projects.Canvas size presets and custom size` |
| 12 | Background | `root.background` | background sheet for the main-track clip under the playhead (`timeline-editing.Per-clip canvas background`, values of `projects.Background colour and gradient` and `projects.Background blur and image`) with "Apply to all"; with an empty main track it edits the project default |
| 13 | Media | `root.media` | `media-library.Media library on mobile` |
| 14 | AI tools | `root.ai` | AI tools sheet of `mobile-editor.Captions, Stickers, Templates and AI tools groups` |
| 15 | Markers | `root.markers` | `mobile-editor.Markers on mobile` |
| 16 | More | `root.more` | `mobile-editor.More sheet` |

Items 1–16 SHALL always be present. Edit with an empty main track SHALL show a toast "Add media first". [CAPCUT CC-288]

#### Scenario: Root order
- **WHEN** the editor opens with nothing selected and an empty clipboard
- **THEN** the toolbar lists the 16 items Edit through More in the stated order, scrollable horizontally

#### Scenario: Edit
- **WHEN** the user taps Edit with the playhead over the second main-track clip
- **THEN** that clip is selected and the video clip strip is shown

#### Scenario: Paste appears
- **WHEN** the user copies a clip and returns to the root toolbar
- **THEN** Paste is the first item, and tapping it inserts a copy at the playhead as one undo step

#### Scenario: Background applies to the clip under the playhead
- **WHEN** the playhead is over the second main-track clip and the user picks a blur background
- **THEN** only that clip's background changes, and "Apply to all" then sets the project default and clears every per-clip override as one undo step

### Requirement: Video clip tool strip
With a video, image or compound element selected (main track or overlay) the strip SHALL contain the tools below in this order; a tool is present only when its "Applies to" condition holds. Compound elements additionally follow `mobile-editor.Compound clip tool strip`.

| # | Label (sub-tools) | `toolId` | Applies to | Opens / runs |
|---|---|---|---|---|
| 1 | Split | `clip.split` | all | `timeline-editing.Split` |
| 2 | Speed (Normal, Curve, Velocity) | `clip.speed` | video, compound | `speed-retime.Speed panel structure` |
| 3 | Volume | `clip.volume` | video or compound with audio | `audio-editing.Clip volume in decibels` (touch presentation 0–1000 % with the dB value beside it) |
| 4 | Animations (In, Out, Combo, Motion styles) | `clip.animation` | all (Motion styles: video, image) | `keyframe-animation.Clip animation panel`; the sub-tool "Motion styles" opens `keyframe-animation.Camera-motion styles entry point`, the same panel as item 41 |
| 5 | Delete | `clip.delete` | all | `timeline-editing.Delete and ripple delete` |
| 6 | Duplicate | `clip.duplicate` | all | `timeline-editing.Duplicate` |
| 7 | Replace | `clip.replace` | video, image | `timeline-editing.Replace media` |
| 8 | Transform (Mirror, Flip vertical, Rotate, Crop, Resize) | `clip.transform` | all | `preview-canvas.Flip, mirror and quarter-turn rotation`, `preview-canvas.Crop mode`, `preview-canvas.Basic tab fields` |
| 9 | Mask | `clip.mask` | all | `masks-blending-keying.Masks tab and mobile mask sheet` |
| 10 | Opacity | `clip.opacity` | all | `masks-blending-keying.Opacity` |
| 11 | Blend | `clip.blend` | all | `masks-blending-keying.Blend modes` |
| 12 | Filters | `clip.filter` | all | `visual-effects-filters.Effects and filters panels` |
| 13 | Adjust | `clip.adjust` | all | `color-adjustment.Adjustment tab layout` |
| 14 | Effects | `clip.effects` | all | `visual-effects-filters.Clip effects list` |
| 15 | Remove BG (Auto, Custom, Chroma key) | `clip.cutout` | video, image | `masks-blending-keying.Cutout model and auto cutout`, `masks-blending-keying.Custom cutout`, `masks-blending-keying.Chroma key` |
| 16 | Background | `clip.background` | main-track elements | the background sheet of `mobile-editor.Root toolbar` item 12 |
| 17 | Stabilise | `clip.stabilise` | video | `ai-editing-tools.Video stabilisation` |
| 18 | Reverse | `clip.reverse` | video, compound | `speed-retime.Reverse` |
| 19 | Freeze | `clip.freeze` | video, compound | `speed-retime.Freeze frame` |
| 20 | Extract audio / Recover audio | `clip.extract-audio` | video with audio | `audio-editing.Extract audio from video`, `audio-editing.Recover audio into video` |
| 21 | Enhance voice | `clip.enhance-voice` | video with audio | `audio-editing.Enhance voice` |
| 22 | Isolate vocals | `clip.isolate-vocals` | video with audio | `audio-editing.Vocal isolation` |
| 23 | Reduce noise | `clip.reduce-noise` | video with audio | `audio-editing.Noise reduction` |
| 24 | Voice effects | `clip.voice-effects` | video with audio | `audio-editing.Voice changer` |
| 25 | Beats | `clip.beats` | video with audio | `audio-editing.Beat markers on audio` |
| 26 | Unlink audio | `clip.unlink` | elements with a `linkId` (linking two elements is in `mobile-editor.Multi-select tool strip`) | `timeline-editing.Video and audio linking` |
| 27 | To overlay | `clip.to-overlay` | main-track elements | moves the element to a new overlay track at the same time through `timeline-editing.Moving elements` |
| 28 | To main track | `clip.to-main` | overlay video, image, compound | inserts the element by `mainInsert` of `timeline-editing.Placement strategies` |
| 29 | Tracking | `clip.track` | video | `ai-editing-tools.Motion tracking` |
| 30 | Auto reframe | `clip.reframe` | video | `ai-editing-tools.Auto reframe` |
| 31 | Relight | `clip.relight` | video, image | `ai-editing-tools.Relight` |
| 32 | Retouch (Face, Makeup, Reshape, Body) | `clip.retouch` | video, image | `ai-editing-tools.Face retouch`, `ai-editing-tools.Makeup presets`, `ai-editing-tools.Face reshape`, `ai-editing-tools.Body reshape` |
| 33 | Eye contact | `clip.eye-contact` | video | `ai-editing-tools.Eye contact correction` |
| 34 | Motion blur | `clip.motion-blur` | video, compound | `visual-effects-filters.Motion blur` |
| 35 | AI expand | `clip.expand` | image | `ai-editing-tools.AI expand` |
| 36 | Enhance | `clip.enhance` | video, image | `ai-editing-tools.Upscale and enhance` |
| 37 | Remove flicker | `clip.deflicker` | video | `ai-editing-tools.Flicker removal` |
| 38 | Remove object | `clip.remove-object` | video, image | `ai-editing-tools.Object and text removal` |
| 39 | Remove text | `clip.remove-text` | video, image | `ai-editing-tools.Object and text removal` |
| 40 | Lip sync | `clip.lipsync` | video | `audio-editing.AI lip sync entry point` |
| 41 | AI movement | `clip.motion-style` | video, image | `keyframe-animation.Camera-motion styles entry point` (`ai-editing-tools.AI movement`) |
| 42 | AI style | `clip.restyle` | video, image | `visual-effects-filters.AI style effects entry point` (`ai-editing-tools.Restyle`) |
| 43 | Split scenes | `clip.split-scenes` | video | `timeline-editing.Automatic scene-cut detection` |
| 44 | Group / Ungroup | `clip.group` | all (Ungroup when the element has a `groupId`) | `timeline-editing.Group and ungroup` |
| 45 | Compound | `clip.compound` | all | "Create compound clip" of `timeline-editing.Compound clips` |
| 46 | Copy | `clip.copy` | all | `timeline-editing.Clipboard` |
| 47 | Cut | `clip.cut` | all | `timeline-editing.Clipboard` (the element is removed; on the main track following clips close the gap) |
| 48 | Hide / Show | `clip.hide` | all | `timeline-editing.Element hide, mute and deactivate` |
| 49 | Deactivate / Activate | `clip.deactivate` | all | `timeline-editing.Element hide, mute and deactivate` |
| 50 | Layers | `clip.layers` | overlay elements | `mobile-editor.Layers sheet` |

Transform sub-tools: Mirror SHALL flip horizontally; Flip vertical SHALL flip vertically; Rotate SHALL apply "Rotate 90°"; Crop SHALL open crop mode with the ratio chips of `preview-canvas.Crop mode`; Resize SHALL open a sheet with Scale, Position X/Y and Rotation controls in the touch presentation of `preview-canvas.Number field behaviour`. A video element with `freeze` set SHALL omit every tool whose condition says "with audio" and the tools Speed, Reverse, Freeze, Stabilise, Tracking, Auto reframe, Eye contact, Remove flicker, Lip sync and Split scenes. [CAPCUT CC-289, CC-036, CC-037, CC-041, CC-042, CC-044, CC-059] [NEW]

#### Scenario: Main-track video with audio
- **WHEN** a main-track video clip with audio, no `linkId` and no group is selected
- **THEN** the strip lists tools 1–25, 27, 29–34 and 36–49 in table order (Unlink audio, To main track, AI expand and Layers are absent) and Group shows "Group"

#### Scenario: Image clip
- **WHEN** an image clip on the main track is selected
- **THEN** Speed, Volume, Stabilise, Reverse, Freeze, Extract audio, Enhance voice, Isolate vocals, Reduce noise, Voice effects, Beats, Tracking, Auto reframe, Eye contact, Motion blur, Remove flicker, Lip sync and Split scenes are not shown, and AI expand is shown

#### Scenario: Every tool opens its owner panel
- **WHEN** an automated test selects a fixture element that satisfies a row's "Applies to" condition and taps the tool with that row's `toolId`, for each of the 50 rows
- **THEN** the panel or action named in that row's last column is opened or executed, identified by its panel id

#### Scenario: Mirror
- **WHEN** the user taps Transform then Mirror
- **THEN** the clip is flipped horizontally as one undo step

#### Scenario: To overlay
- **WHEN** the user taps To overlay on the second of three main-track clips
- **THEN** the clip is on a new overlay track at the same start time, the third clip ripples left to touch the first, and one undo restores the main track

### Requirement: Compound clip tool strip
With a compound element selected the strip SHALL start with two tools before the applicable tools of `mobile-editor.Video clip tool strip`: "Edit compound" (`compound.edit`; enters the referenced scene as defined by `timeline-editing.Compound clips`, showing the breadcrumb above the ruler and an "Exit compound" button at the left of the transport row) and "Undo compound" (`compound.dissolve`; dissolves the compound as defined there). From the video clip table a compound element SHALL offer the rows whose "Applies to" is "all" or names compound, plus Volume when the referenced scene has audio. A compound inserted from a template (`templates.Apply a template to the open project`) SHALL additionally show "Slots" (`compound.slots`) as its third tool, opening the slot list of `templates.Replace and adjust slot media` as a sheet.

Multi-camera editing is complete on phones and tablets, iOS and Android alike (decision E5: creation, source editing and flatten are not desktop-only). A multi-camera clip (`project-document.Multi-camera clip`) SHALL show, in place of "Edit compound" and "Undo compound", these tools in this order: "Angle" (`multicam.angle`; a `canvasPassive` sheet showing the grid of `preview-canvas.Multi-camera angle viewer` — the angles of `project-document.Multi-camera definition` in angle order, a live thumbnail each, the active angle ticked and the audio angle marked — where tapping an angle switches at the playhead exactly as `timeline-editing.Multi-camera clip` defines, also during playback, one undo step per switch); "Audio" (`multicam.audio`; the audio angle picker and the "Audio follows video" switch); "Edit source" (`multicam.edit-source`; enters the multi-camera scene with the breadcrumb and "Exit" button of a compound, where each angle is a lane whose clip can be slid to correct sync and whose lane label opens a sheet with Rename, Move up, Move down, Remove angle, and where an "Add angle" tool opens the media picker while fewer than 8 angles exist); and "Flatten" (`multicam.flatten`; disabled with the owner's hint when the audio condition does not hold). Creation is the tool "Multi-camera" of `mobile-editor.Multi-select tool strip`: it opens a sheet with the sync methods Audio, Start and Keep current positions and a Create button, shows the analysis progress with Cancel, and runs the same command as on desktop. Rules, limits, messages and undo are those of `timeline-editing.Multi-camera clip`; this capability defines only the entries. [CAPCUT CC-289, CC-072] [NEW]

#### Scenario: Compound strip
- **WHEN** a compound element is selected
- **THEN** the strip starts with Edit compound, Undo compound, Split, Speed

#### Scenario: Enter and exit
- **WHEN** the user taps Edit compound and then Exit compound
- **THEN** the timeline shows the compound's scene with the breadcrumb, then the parent scene with the playhead at the corresponding parent time

#### Scenario: Self-reference refused
- **WHEN** the user tries to create a compound that would contain itself
- **THEN** the toast "A compound clip cannot contain itself" is shown and nothing changes

#### Scenario: Switch angle on a phone
- **WHEN** a multi-camera clip showing angle 1 is selected with the playhead 5 s into it and the user taps Angle and then angle 2
- **THEN** the clip is split at the playhead, the part after it shows angle 2, and one undo restores the single clip

#### Scenario: Create a multi-camera clip on a phone
- **WHEN** the user selects three video clips, taps Multi-camera, chooses Audio and taps Create on an iPhone and on an Android phone
- **THEN** on both one multi-camera clip replaces the three clips, showing angle 1, and one undo restores them

#### Scenario: Edit source and flatten on a tablet
- **WHEN** the user taps Edit source, slides angle 2 by 4 frames, exits, and taps Flatten with "Audio follows video" on
- **THEN** angle 2's `syncOffset` changed by 4 frames and the part is replaced by the active angle's clip as one undo step

#### Scenario: Template compound shows Slots
- **WHEN** a compound inserted from a template with 3 slots is selected
- **THEN** the strip starts with Edit compound, Undo compound, Slots, and Slots lists the 3 slots

### Requirement: Audio group and audio clip strips
The Audio group sub-toolbar SHALL contain, in this order:

| # | Label | `toolId` | Opens |
|---|---|---|---|
| 1 | Sounds | `audio.sounds` | `audio-editing.Sounds library panel` (music; source "Bundled" first; device files through the folder button) |
| 2 | Sound FX | `audio.sfx` | `audio-editing.Sounds library panel` filtered to sound effects |
| 3 | Extract | `audio.extract` | media picker, then `audio-editing.Extract audio from video` for the picked video |
| 4 | Voiceover | `audio.voiceover` | `audio-editing.Voiceover recording` |
| 5 | Text to audio | `audio.tts` | `ai-editing-tools.Text to speech with voice selection` |
| 6 | Copyright | `audio.copyright` | `audio-editing.Audio licence check` |

With an audio element selected the strip SHALL contain, in this order:

| # | Label | `toolId` | Opens / runs |
|---|---|---|---|
| 1 | Split | `aclip.split` | `timeline-editing.Split` |
| 2 | Volume | `aclip.volume` | `audio-editing.Clip volume in decibels` |
| 3 | Fade | `aclip.fade` | `audio-editing.Audio fades` |
| 4 | Speed | `aclip.speed` | `speed-retime.Audio clip speed` |
| 5 | Reverse | `aclip.reverse` | `speed-retime.Reverse` |
| 6 | Beats | `aclip.beats` | `audio-editing.Beat markers on audio`, `audio-editing.Automatic beat detection` |
| 7 | Voice effects | `aclip.voice-effects` | `audio-editing.Voice changer` |
| 8 | Reduce noise | `aclip.reduce-noise` | `audio-editing.Noise reduction` |
| 9 | Enhance voice | `aclip.enhance-voice` | `audio-editing.Enhance voice` |
| 10 | Isolate vocals | `aclip.isolate-vocals` | `audio-editing.Vocal isolation` |
| 11 | Normalise | `aclip.normalise` | `audio-editing.Loudness normalisation` |
| 12 | Pitch | `aclip.pitch` | `audio-editing.Audio pitch shift` |
| 13 | Pan | `aclip.pan` | a sheet with the single slider of `audio-editing.Clip pan` |
| 14 | Equaliser | `aclip.eq` | a sheet with the tabs Equaliser, Compressor and Ducking of `audio-editing.Equaliser, compressor and ducking` |
| 15 | Unlink video | `aclip.unlink` | `timeline-editing.Video and audio linking` (present when the element has a `linkId`) |
| 16 | Recover audio | `aclip.recover` | `audio-editing.Recover audio into video` (present for extracted audio whose source video is on the timeline) |
| 17 | Duplicate | `aclip.duplicate` | `timeline-editing.Duplicate` |
| 18 | Copy | `aclip.copy` | `timeline-editing.Clipboard` |
| 19 | Cut | `aclip.cut` | `timeline-editing.Clipboard` (the element is removed) |
| 20 | Replace | `aclip.replace` | `timeline-editing.Replace media` |
| 21 | Deactivate / Activate | `aclip.deactivate` | `timeline-editing.Element hide, mute and deactivate` |
| 22 | Delete | `aclip.delete` | `timeline-editing.Delete and ripple delete` |
| 23 | Tracks | `aclip.layers` | `mobile-editor.Layers sheet`, Tracks tab, with the element's track row highlighted |

Panels with a single control group (for example Enhance voice) SHALL use the sheet layout of `mobile-editor.Tool sheets never cover the preview`. [CAPCUT CC-287] [NEW]

#### Scenario: Audio group
- **WHEN** the user taps Audio
- **THEN** the sub-toolbar shows Sounds, Sound FX, Extract, Voiceover, Text to audio and Copyright in that order

#### Scenario: Audio clip strip
- **WHEN** a music bar that has no linked video is selected
- **THEN** the strip lists Split, Volume, Fade, Speed, Reverse, Beats, Voice effects, Reduce noise, Enhance voice, Isolate vocals, Normalise, Pitch, Pan, Equaliser, Duplicate, Copy, Cut, Replace, Deactivate, Delete, Tracks

#### Scenario: Reverse an audio clip
- **WHEN** a music bar is selected and the user taps Reverse
- **THEN** `retime.reverse` of that element is true as one undo step and the bar shows the reversed icon

#### Scenario: Equaliser sheet
- **WHEN** the user taps Equaliser on an audio clip
- **THEN** a sheet opens with the tabs Equaliser, Compressor and Ducking

#### Scenario: Sounds without a host
- **WHEN** no host is connected and the user taps Sounds
- **THEN** the panel opens on the source "Bundled" and its items can be added to the timeline

### Requirement: Text group, text clip and sticker strips
The Text group sub-toolbar SHALL contain, in this order: Add text (`text.add`; `text-and-titles.Add a text element`), Text templates (`text.templates`; `text-and-titles.Text templates`), Text effects (`text.effects`; `text-and-titles.Text effect presets`), My presets (`text.presets`; `text-and-titles.Save a text preset`), Draw (`text.draw`; `stickers-shapes.Freehand drawing`). Caption tools SHALL NOT appear in the Text group; they live in the Captions group.

With a text element selected the strip SHALL contain, in this order: Edit (`tclip.edit`), Style (`tclip.style`), Effects (`tclip.effects`), Bubble (`tclip.bubble`), Animation (`tclip.animation`) — these five open the text sheet of `text-and-titles.Text on touch devices` on the tab of the same name (Edit opens the Keyboard tab); Templates (`tclip.templates`; `text-and-titles.Text templates`, applied to the selection); Split (`tclip.split`; `timeline-editing.Split`); Duplicate (`tclip.duplicate`); Copy (`tclip.copy`); Text to speech (`tclip.tts`; `text-and-titles.Text-to-speech hand-off`); Tracking (`tclip.tracking`; `text-and-titles.Text tracking`); Opacity (`tclip.opacity`; `masks-blending-keying.Opacity`); Blend (`tclip.blend`; `masks-blending-keying.Blend modes`); Copy style / Paste style (`tclip.style-copy`, `tclip.style-paste`; `text-and-titles.Copy, paste and apply text style`); Save preset (`tclip.save-preset`; `text-and-titles.Save a text preset`); Hide / Show (`tclip.hide`); Layers (`tclip.layers`; `mobile-editor.Layers sheet`); Delete (`tclip.delete`).

With a sticker, shape or drawing selected the strip SHALL contain, in this order: Split (`sclip.split`); Animation (`sclip.animation`; `keyframe-animation.Clip animation panel`); Tracking (`sclip.tracking`; `stickers-shapes.Sticker and shape animation and tracking`); Replace (`sclip.replace`; stickers only; `stickers-shapes.Sticker transform, timing and inspector`); Shape (`sclip.shape`; shapes only; `stickers-shapes.Shape parameter table`, `stickers-shapes.Shape stroke`); Edit drawing (`sclip.draw`; drawings only; `stickers-shapes.Freehand drawing`); Playback (`sclip.playback`; animated stickers only; `stickers-shapes.Animated stickers`); Opacity (`sclip.opacity`); Blend (`sclip.blend`); Mask (`sclip.mask`; `masks-blending-keying.Masks tab and mobile mask sheet`); Effects (`sclip.effects`; `visual-effects-filters.Clip effects list`); Mirror (`sclip.mirror`; `preview-canvas.Flip, mirror and quarter-turn rotation`); Duplicate (`sclip.duplicate`); Copy (`sclip.copy`); Hide / Show (`sclip.hide`); Layers (`sclip.layers`); Delete (`sclip.delete`). [CAPCUT CC-287] [NEW]

#### Scenario: Text group
- **WHEN** the user taps Text
- **THEN** the sub-toolbar lists Add text, Text templates, Text effects, My presets and Draw in that order and no caption tool

#### Scenario: Text style
- **WHEN** a text element is selected and the user taps Style
- **THEN** the text sheet opens on the Style tab with the preview still visible

#### Scenario: Shape strip
- **WHEN** a star shape is selected
- **THEN** the strip contains Shape and does not contain Replace, Edit drawing or Playback

### Requirement: Captions, Stickers, Templates and AI tools groups
The Captions group sub-toolbar SHALL contain, in this order: Auto captions (`cap.auto`; sheet of `captions-subtitles.Captions on touch devices` for `captions-subtitles.Auto captions on device`), Add caption (`cap.add`; "Add caption" of `captions-subtitles.Edit caption text and timing`), Import captions (`cap.import`; `captions-subtitles.Subtitle import flow and errors`), Auto lyrics (`cap.lyrics`; `captions-subtitles.Auto lyrics`), Caption templates (`cap.styles`; `captions-subtitles.Caption style templates`), Translate (`cap.translate`; `captions-subtitles.Translate captions`), Transcript (`cap.transcript`; `captions-subtitles.Transcript panel`), Export (`cap.export`; `captions-subtitles.Export captions`). In the Captions group the caption lanes SHALL be expanded.

Stickers SHALL open a sheet (not a sub-toolbar) with the panel of `stickers-shapes.Stickers panel and categories`.

Templates SHALL open a sheet with the gallery of `templates.Template gallery`; a card SHALL offer "Insert into timeline" (`templates.Apply a template to the open project`) and "Use template" (`templates.Use a template`).

AI tools SHALL open a sheet with a 4-column grid listing, in this order, the project-level tools of `ai-editing-tools.AI tools catalogue and entry points`: `script-to-video`, `long-to-shorts`, `auto-cut`, `beat-sync`, `generate.image`, `generate.video`, `generate.music`, `generate.sfx`, `avatar`, `dialogue-scene`, `dub`, `smart-search`. Each tile SHALL open the tool's panel as a sheet as defined by `ai-editing-tools.AI tools on mobile`; clip-level AI tools are reached only from the clip strips. [CAPCUT CC-287, CC-288] [NEW]

#### Scenario: Captions group
- **WHEN** the user taps Captions
- **THEN** the sub-toolbar lists the eight tools in the stated order and the caption lanes are expanded

#### Scenario: Stickers sheet
- **WHEN** the user taps Stickers
- **THEN** the stickers panel opens as a sheet and the toolbar level does not change

#### Scenario: AI tools grid
- **WHEN** the user taps AI tools
- **THEN** a sheet shows exactly the 12 tiles in the stated order, 4 per row

#### Scenario: Template card on a phone
- **WHEN** the user taps a template card in the Templates sheet
- **THEN** its preview plays and the actions "Insert into timeline" and "Use template" are offered

### Requirement: Caption tool strips
With one caption selected the strip SHALL contain, in this order: Split (`ccap.split`), Style (`ccap.style`; the caption style sheet of `captions-subtitles.Captions on touch devices`, which holds the template gallery and every style, layout, highlight and bilingual control), Edit captions (`ccap.edit`; the list editor of `captions-subtitles.Captions on touch devices`), Animation (`ccap.animation`; `text-and-titles.Text animations in, out and loop`), Duplicate (`ccap.duplicate`), Delete (`ccap.delete`), Text to speech (`ccap.tts`; `text-and-titles.Text-to-speech hand-off`), Translate (`ccap.translate`; `captions-subtitles.Translate captions`), Convert to text (`ccap.to-text`; `captions-subtitles.Caption track and caption elements`), Tracks (`ccap.layers`; `mobile-editor.Layers sheet`, Tracks tab).

The batch strip SHALL be shown when several captions are selected — by "Select all captions" in the caption row of the Tracks tab of `mobile-editor.Layers sheet`, by a long press on the caption lane label (`mobile-editor.Secondary lanes`), by multi-selection in the list editor, or by the rectangle selection of `mobile-editor.Selection, trim handles and clip badges`; mobile has no track header to tap. It SHALL contain: Batch edit (`bcap.edit`; `captions-subtitles.Batch caption editing`), Style (`bcap.style`; the same caption style sheet, with "Apply to all" on), Highlight (`bcap.highlight`; the Highlight tab of that sheet, `captions-subtitles.Word-level highlight`), Voice (`bcap.voice`; text-to-speech for all, `text-and-titles.Text-to-speech hand-off`), Volume (`bcap.volume`; of the generated voice clips, `audio-editing.Clip volume in decibels`), Translate (`bcap.translate`), Burn-in (`bcap.burn-in`; the track field `caption.burnIn` of `captions-subtitles.Burn-in and sidecar captions at export`), Delete (`bcap.delete`), Separate (`bcap.separate`; moves the selection to a new caption track), Transcript (`bcap.transcript`), Export (`bcap.export`), Tracks (`bcap.layers`). [CAPCUT CC-287] [NEW]

#### Scenario: Single caption
- **WHEN** one caption bar is selected
- **THEN** the strip starts with Split, Style, Edit captions

#### Scenario: Batch from the Tracks tab
- **WHEN** the user opens the Tracks tab and taps "Select all captions" on a caption track row
- **THEN** every caption of that track is selected and the batch strip is shown starting with Batch edit

#### Scenario: Style opens the caption style sheet
- **WHEN** one caption is selected and the user taps Style
- **THEN** the caption style sheet opens on its Templates tab with the tabs Templates, Text, Layout, Highlight and Bilingual

### Requirement: Effect, filter and adjustment bar strips
The Effects group sub-toolbar SHALL contain exactly three fixed items, each opening the one Effects library of `visual-effects-filters.Effects and filters panels` as a sheet with a filter applied; the owner has a single Effects panel, and these items are views of it, not separate panels: (1) "Video effects" (`fx.video`) — the library filtered to effects that do not declare `requires: "person-matte"`; with no clip selected, a tile tap SHALL create a standalone effect layer at the playhead (`visual-effects-filters.Standalone effect layer`), and with a clip selected it adds the effect to that clip (`visual-effects-filters.Clip effects list`); for an image clip this is the only effects item CapCut's separate "Photo effects" entry maps to — there is no Photo effects item. (2) "Body effects" (`fx.body`) — the library filtered to effects that declare `requires: "person-matte"` (`visual-effects-filters.Body effects use the on-device person matte`); body effects are never created as effect layers: with no clip selected the item first selects the main-track video or image clip under the playhead and applies the tapped effect to it, and with an empty main track or no such clip under the playhead it shows the owner's toast "Select a video or image clip to use body effects" and changes nothing. (3) "AI style" (`fx.ai`; `visual-effects-filters.AI style effects entry point`).

Filters and Adjust in the root toolbar SHALL open one combined sheet with the tabs Filters (`visual-effects-filters.Effects and filters panels`), Adjust (`color-adjustment.Adjustment tab layout`) and Video quality (`ai-editing-tools.Upscale and enhance`, applied to the main-track clip under the playhead). With no clip selected, the first filter tile tap SHALL create a filter layer at the playhead (`visual-effects-filters.Filter layer and clip filter conversion`) and the first slider change on Adjust SHALL create an adjustment layer at the playhead (`color-adjustment.Adjustment layers`), each as one undo step when the sheet is confirmed.

With an effect bar selected the strip SHALL contain, in this order: Adjust (`fx.adjust`; `visual-effects-filters.Effect parameter editing`), Replace (`fx.replace`; opens the library and swaps the type while keeping the time range), Duplicate (`fx.duplicate`), Target (`fx.target`; the two target options of `visual-effects-filters.Standalone effect layer`: all layers beneath, or one clip), Split (`fx.split`), Delete (`fx.delete`), Layers (`fx.layers`). With a filter bar (an effect element whose single entry is a filter) selected it SHALL contain: Adjust, Replace, Target, Duplicate, Split, Delete, Layers, with the same behaviours. With an adjustment bar selected it SHALL contain: Adjust (`adj.adjust`; `color-adjustment.Adjustment tab layout`), Mask (`adj.mask`; `masks-blending-keying.Masks tab and mobile mask sheet`), Duplicate, Split, Delete, Layers. [CAPCUT CC-287] [NEW]

#### Scenario: Effects group items
- **WHEN** the user taps Effects in the root toolbar
- **THEN** the sub-toolbar lists Video effects, Body effects and AI style in that order

#### Scenario: Body effect with nothing selected
- **WHEN** nothing is selected, the playhead is over the second main-track video clip, and the user opens Body effects and taps a tile
- **THEN** that clip is selected, the effect is added to its effects list as one undo step, and no effect layer is created

#### Scenario: Body effect on an empty main track
- **WHEN** the main track is empty and the user taps a Body effects tile
- **THEN** the toast "Select a video or image clip to use body effects" is shown and the project is unchanged

#### Scenario: Effect bar
- **WHEN** an effect bar is selected
- **THEN** the strip lists Adjust, Replace, Duplicate, Target, Split, Delete, Layers

#### Scenario: Target a clip
- **WHEN** the user taps Target and chooses one overlay clip
- **THEN** the effect applies only to that overlay clip

#### Scenario: Filter with nothing selected
- **WHEN** nothing is selected, the user opens Filters, taps a filter tile and confirms the sheet
- **THEN** a filter layer exists at the playhead and one undo removes it

#### Scenario: Adjustment bar
- **WHEN** an adjustment bar is selected
- **THEN** the strip lists Adjust, Mask, Duplicate, Split, Delete, Layers

### Requirement: Overlay group
The Overlay group sub-toolbar SHALL contain "Add overlay" (`overlay.add`), which opens the media picker and adds the chosen item as an overlay (picture-in-picture) element at the playhead on a new or free overlay track, scaled so that its width is 50 % of the canvas width and centred. In the Overlay group the overlay lanes SHALL be expanded and the main track SHALL be shown at 28 pt height. A selected overlay element SHALL use `mobile-editor.Video clip tool strip` with "To main track" and Layers present and "To overlay" and Background absent. The fixed button at the far left SHALL be a double chevron and SHALL return to the root toolbar and the main timeline view. [CAPCUT CC-058, CC-059, CC-287] [NEW]

#### Scenario: Add overlay
- **WHEN** the user taps Overlay, Add overlay and picks a video
- **THEN** an overlay clip appears at the playhead on an overlay lane, shown at 50 % of the canvas width

#### Scenario: Return
- **WHEN** the user taps the double-chevron button
- **THEN** the root toolbar is shown and overlay lanes collapse to strips

#### Scenario: Overlay clip strip
- **WHEN** an overlay video clip is selected
- **THEN** the strip contains To main track and Layers and does not contain To overlay or Background

### Requirement: Transition slot sheet
Tapping a transition junction button SHALL select that cut and open the Transitions sheet defined by `transitions.Apply a transition on mobile` (category strip, tile grid, duration slider, "Apply to all", "None", ✓); no separate tool strip is shown for a transition. The sheet SHALL be `canvasPassive`. While it is open the compact timeline SHALL keep the selected junction under the playhead. A cut that is not eligible (`transitions.Eligible cuts`) SHALL show no junction button. [CAPCUT CC-099] [NEW]

#### Scenario: Open for a cut
- **WHEN** the user taps the junction between the first and second main-track clips
- **THEN** the Transitions sheet opens for that cut and the playhead is on the cut

#### Scenario: Remove
- **WHEN** the junction has a transition and the user taps the "None" tile and ✓
- **THEN** the transition is removed as one undo step and the junction button is drawn outlined

### Requirement: Markers on mobile
The Markers group sub-toolbar SHALL contain, in this order: Add marker (`marker.add`; adds a marker at the playhead through `timeline-editing.Markers`; shown as "Remove marker" while the playhead is on a marker), Previous (`marker.prev`) and Next (`marker.next`) (the navigation actions of `timeline-editing.Marker interaction`), and List (`marker.list`; a sheet listing every marker of the scene with time, colour swatch and note, where tapping a row seeks to it and a row swipe offers Edit and Delete, and a footer offers "Delete all markers" with confirmation). Markers SHALL be drawn as flags on the ruler with the geometry of `timeline-editing.Track header column and row dimensions` and the `marker/1…8` tokens of `design-system.Editor colour tokens`. Tapping a flag SHALL seek to it and select it; with a marker selected the strip SHALL contain: Edit note (`marker.note`; 0–500 characters), Colour (`marker.colour`; the 8 marker tokens), Duration (`marker.duration`), Delete (`marker.delete`). Long-pressing a flag SHALL pick it up for dragging with timeline snapping. Every marker edit SHALL be one undo step. [NEW]

#### Scenario: Add at the playhead
- **WHEN** the user opens Markers and taps Add marker with the playhead at 4 s
- **THEN** a flag is drawn on the ruler at 4 s, the tool reads "Remove marker", and one undo removes the marker

#### Scenario: Edit a marker
- **WHEN** the user taps a flag and then Edit note and types "Logo in"
- **THEN** the marker's note is "Logo in"

#### Scenario: No markers
- **WHEN** the scene has no marker and the user taps List
- **THEN** the sheet shows the empty state "No markers yet" with an "Add marker" button

### Requirement: Multi-select tool strip
With two or more elements selected the strip SHALL contain, in this order: Delete (`multi.delete`), Duplicate (`multi.duplicate`), Group (`multi.group`; "Ungroup" when the selection is exactly one group; `timeline-editing.Group and ungroup`), Compound (`multi.compound`; "Create compound clip" of `timeline-editing.Compound clips`), Multi-camera (`multi.multicam`; present when the selection is 2–8 video elements that `timeline-editing.Multi-camera clip` accepts; opens the creation sheet of `mobile-editor.Compound clip tool strip`), Copy (`multi.copy`), Cut (`multi.cut`), Link (`multi.link`; present when the selection is one video and one audio element that `timeline-editing.Video and audio linking` accepts), Hide / Show (`multi.hide`), Align (`multi.align`; `preview-canvas.Align and distribute`; present when at least two selected elements are visual), Select all on track (`multi.select-track`). The back button SHALL clear the selection. [CAPCUT CC-289] [NEW]

#### Scenario: Create a compound from three clips
- **WHEN** three clips are selected and the user taps Compound
- **THEN** one compound element replaces them and one undo restores the three clips

#### Scenario: Copy then paste
- **WHEN** two bars are selected, the user taps Copy, taps the back button and then Paste in the root toolbar
- **THEN** copies of both bars are inserted at the playhead as one undo step

### Requirement: More sheet
The More item of the root toolbar SHALL open a sheet with these rows, in this order:

| Row | `toolId` | Opens / sets |
|---|---|---|
| Scenes | `more.scenes` | the Scenes sheet of `timeline-editing.Scenes model and switching` (switch, create, rename, reorder, duplicate, delete) |
| Script | `more.script` | a sheet with "Open script" (shown when the project has a linked script; opens `scripts/[scriptId]` per `script-studio.Mobile presentation`), "New script for this project" and "Generate draft timeline from script" (`script-studio.Draft timeline from a script`), as listed in `script-studio.Entry points` |
| Tracks | `more.tracks` | `mobile-editor.Layers sheet` on its Tracks tab |
| Transcript | `more.transcript` | `captions-subtitles.Transcript panel` as a list sheet (`mobile-editor.Tool sheets never cover the preview`) |
| In/out range | `more.range` | a sheet with "Set in at playhead", "Set out at playhead" and "Clear range" (`timeline-editing.In/out range`) |
| Select | `more.select` | enters multi-selection mode (taps toggle elements; the strip is `mobile-editor.Multi-select tool strip`) |
| Auto snapping (switch) | `more.snapping` | the snapping toggle of `timeline-editing.Snapping` |
| Linkage (switch) | `more.linkage` | the toggle of `timeline-editing.Linkage` |
| Free layer (switch) | `more.free-layer` | `timeline-editing.Free layer mode` |
| Preview quality | `more.quality` | the menu of `preview-canvas.Preview quality` |
| Guides | `more.guides` | `preview-canvas.Guides popover` as a sheet |
| Brand kit | `more.brand` | `templates.Brand kit` as a sheet (logos, colours, fonts) |
| Project settings | `more.settings` | `projects.Project settings surface` |

On iOS and Android alike the main-track magnet has no switch and there is no separate ripple switch: the magnet is on whenever Free layer is off and off whenever Free layer is on; turning Free layer off (the magnet on) closes every existing gap of the main track immediately, as one undo step, exactly as CapCut does (decision E5) — there is no "Close gaps" tool, badge or menu entry on mobile; the main track ripples exactly when the magnet is on; overlay, audio and every other secondary lane never ripple (`timeline-editing.Ripple mode`, `timeline-editing.Magnetic main track`). Cursor modes and the preview axis of `timeline-editing.Cursor modes` and `timeline-editing.Preview axis` are desktop- and web-only and have no mobile entry. Switch states SHALL be the same stored settings the desktop toolbar edits. [NEW]

#### Scenario: Rows
- **WHEN** the user taps More
- **THEN** the sheet lists the 13 rows in the stated order

#### Scenario: Tracks row
- **WHEN** the user taps More and then Tracks
- **THEN** the Layers sheet opens on the Tracks tab listing every track of the active scene

#### Scenario: Switch a scene
- **WHEN** the project has two scenes and the user opens More, Scenes and taps the second scene
- **THEN** the timeline shows the second scene

#### Scenario: Draft timeline from a script
- **WHEN** the project has a linked approved script and the user chooses Script, "Generate draft timeline from script"
- **THEN** the draft-timeline flow of `script-studio.Draft timeline from a script` starts for this project

#### Scenario: Turning the magnet on closes gaps
- **WHEN** the main track has a 2 s gap made in Free layer mode and the user turns Free layer off
- **THEN** the following clips move left to close the gap at once, one undo restores the gap, and no "Close gaps" entry exists anywhere in the mobile editor

#### Scenario: Free layer turns the magnet off
- **WHEN** the user turns Free layer on and deletes the second of three main-track clips
- **THEN** a gap remains where the clip was

### Requirement: Layers sheet
The Layers tool SHALL open a sheet with two tabs, "Layers" (default when opened from a clip strip) and "Tracks" (default when opened from a lane label, from `more.tracks`, or from an audio or caption strip).

**Layers** SHALL list every visual element live at the playhead from topmost to lowest, each row with a thumbnail, name and a drag handle. Dragging a row SHALL change the stacking order through `preview-canvas.Layer order controls` as one undo step; tapping a row SHALL select that element. The main track row SHALL be fixed at the bottom and SHALL have no drag handle.

**Tracks** SHALL list every track of the active scene in stack order — overlay tracks top to bottom, the main track, then audio tracks — one 56 pt row per track with, left to right: a drag handle; the track-type icon; the track name (tap to rename inline, 1–60 characters, `timeline-editing.Track rename`); Hide (`track.hidden`; visual tracks and caption tracks); Lock (`track.locked`); and, for tracks that carry audio (audio tracks and video tracks, `project-document.Track fields`), Mute (`track.muted`) and Solo (`track.solo`). Tapping the row body SHALL expand it to show, for audio-capable tracks, a Volume slider (−60…+12 dB, default 0, with the touch presentation of `preview-canvas.Number field behaviour`) and a Pan slider (−100…+100, default 0), both with the semantics of `audio-editing.Track volume, pan and solo`; for a caption track, the switches "Burn-in" (`caption.burnIn`) and "Show speaker labels" (`caption.showSpeakerLabels`) and the button "Select all captions"; and for every track "Select all on track" and "Delete track" (confirmation when the track holds elements; `timeline-editing.Track creation and insert index`). Dragging a row by its handle SHALL reorder the track within its zone only (an overlay track among overlay tracks, an audio track among audio tracks; `project-document.Track and element ordering`); the main track row has no handle and cannot be hidden, deleted or reordered. A footer SHALL offer "Add track" with the types the scene allows, and the header of the Tracks tab SHALL show the master level meter of `audio-editing.Audio metering` during playback. Every change SHALL be one undo step, except `solo`, which follows `audio-editing.Track volume, pan and solo` (stored and synced, no undo step). Field names, ranges and defaults are those of `project-document.Track fields`; this sheet states the controls only. On tablets in the tablet layout the same two tabs are shown in the side panel (`mobile-editor.Tablet layout`). [NEW]

#### Scenario: Reorder layers
- **WHEN** the user drags the third row of the Layers tab to the first position
- **THEN** that element renders above the others and one undo restores the order

#### Scenario: Main track row
- **WHEN** the sheet is open on either tab
- **THEN** the main-track row is last among the visual rows and cannot be dragged

#### Scenario: Lock a track
- **WHEN** the user taps Lock on an overlay track row
- **THEN** `locked` is true for that track, its clips cannot be selected on the timeline or the canvas, and one undo unlocks it

#### Scenario: Mute and solo
- **WHEN** the scene has three audio tracks and the user taps Solo on the second
- **THEN** only the second audio track is audible in playback and its lane label shows the solo badge

#### Scenario: Track volume and pan
- **WHEN** the user expands an audio track row and sets Volume to −6 dB and Pan to −50
- **THEN** the track's `volume` is −6 and `pan` is −50 and playback reflects both

#### Scenario: Rename
- **WHEN** the user taps a track name, types "Voiceover" and confirms
- **THEN** the track is named "Voiceover" in the sheet and on the expanded lane

#### Scenario: Reorder stays inside the zone
- **WHEN** the user drags an audio track row above the main track row
- **THEN** the row snaps back to the top of the audio group and the overlay order is unchanged

#### Scenario: Hide a text track
- **WHEN** the user taps Hide on a text track
- **THEN** its elements are not rendered in the preview or in an export and are drawn hatched on the timeline

### Requirement: Tool sheets never cover the preview
A tool panel SHALL open as a non-modal bottom sheet that replaces the bottom toolbar and, as needed, the timeline region, but SHALL never overlap the preview region or the transport row: the sheet's maximum height SHALL be the screen height minus the top bar, the 35 % minimum preview height, the transport row and a 48 pt compact timeline, which stays visible above the sheet with the fixed playhead and is scrollable for seeking. A sheet SHALL have a header with the title centred; at the left Reset when the tool has a default state, otherwise Cancel (✕); and at the right a confirm (✓) or collapse (⌄) button. Changes made in a sheet SHALL be shown live in the preview through the preview layer (`timeline-editing.Preview and commit`). ✓, ⌄ and the back gesture SHALL close the sheet and commit the changes as one undo step; Cancel (✕) SHALL close the sheet, discard the preview-layer changes and add no undo step; Reset SHALL restore the tool's default values and keep the sheet open. Every sheet SHALL be flagged `canvasPassive` or `canvasInteractive`: tapping the preview SHALL close and commit a `canvasPassive` sheet, while a `canvasInteractive` sheet SHALL receive preview touches for its tool. The `canvasInteractive` sheets are: Mask, Crop, Text, the caption style sheet, Remove BG (Custom cutout), the colour picker (eyedropper) of Remove BG (Chroma key), Tracking, Relight, Retouch (face selection by tapping a face, `ai-editing-tools.AI tools on mobile`), Background (colour eyedropper), Remove object, Remove text, AI expand, Draw, Resize, Guides, the template slot Adjust sheet and the Curves eyedropper of Adjust; every other sheet is `canvasPassive`. Only one sheet SHALL be open at a time.

The rule "a sheet never overlaps the preview region or the transport row, and the preview keeps at least 35 % of the screen height" has exactly three exceptions, and no other capability defines a further one: (1) **List sheets** — Edit captions (`captions-subtitles.Captions on touch devices`), Transcript (`captions-subtitles.Transcript panel`) and the Markers list: full height below a pinned preview of exactly 35 % of the screen height; the transport row, the compact timeline and the bottom toolbar are hidden, and play/pause is a button overlaid on the pinned preview. (2) **Overlay sheets** — the Agent panel (`mobile-editor.Top bar`), the export progress view (`mobile-editor.Export sheet`), the requires-host sheet and the media picker: they cover the whole editor including the preview, are modal, and playback is paused while one is open. (3) **Keyboard open** — while the on-screen keyboard is shown for a sheet, the preview is allowed to shrink below 35 % but SHALL keep at least 120 pt visible, with the canvas scrolled so the edited element is in view; the 35 % rule applies again when the keyboard closes. [CAPCUT CC-287] [NEW]

#### Scenario: Preview stays visible
- **WHEN** the user opens the Adjust sheet on a 390×844 pt phone
- **THEN** the preview keeps at least 295 pt of height and the compact timeline is visible between the transport row and the sheet

#### Scenario: Single undo
- **WHEN** the user changes three sliders in a sheet, taps ✓ and then Undo once
- **THEN** all three values return to what they were before the sheet opened

#### Scenario: Reset
- **WHEN** the user changes a slider and taps Reset
- **THEN** the value returns to the tool's default and the sheet stays open

#### Scenario: Cancel discards
- **WHEN** the user moves a mask in the Mask sheet and taps ✕
- **THEN** the mask is where it was before the sheet opened and the undo history is unchanged

#### Scenario: Interactive sheet keeps canvas touches
- **WHEN** the Mask sheet is open and the user drags on the preview
- **THEN** the mask moves and the sheet stays open

#### Scenario: Retouch keeps canvas touches
- **WHEN** the Retouch sheet is open on a clip with two faces and the user taps the second face in the preview
- **THEN** that face becomes the edited face and the sheet stays open

#### Scenario: List sheet pins the preview at 35 %
- **WHEN** the user opens Edit captions on a 390×844 pt phone
- **THEN** the preview is pinned at 295 pt high, the list fills the rest, and the transport row and compact timeline are hidden

#### Scenario: Keyboard exception
- **WHEN** the text sheet is on its Keyboard tab with the on-screen keyboard shown on a 320×568 pt phone
- **THEN** at least 120 pt of preview stays visible with the edited text in view

#### Scenario: Passive sheet closes on preview tap
- **WHEN** the Opacity sheet is open and the user taps the preview
- **THEN** the sheet closes and the opacity change is committed as one undo step

### Requirement: Export sheet
This capability owns the layout of mobile export; option values, encoding behaviour, targets and errors are owned by `export-share`, in the requirements named below. Tapping the export settings chip SHALL open the export quick sheet with, top to bottom: three stepped sliders — Resolution, Frame rate and Bitrate — whose steps are the values of `export-share.Resolution options`, `export-share.Frame rate options` and the modes Lower, Recommended and Higher of `export-share.Bitrate modes` (steps the device cannot encode are disabled with the reason given by `export-share.Video codecs with capability detection and fallback`); the estimated size of `export-share.Estimated file size and duration`; a target selector with "This device" and the remote target row labelled and enabled as defined by `export-share.Gateway export hand-off`; and a "More settings" row. "More settings" SHALL open the full export sheet whose tabs are the six export types of `export-share.Export entry points and dialog`, in its order — Video, GIF, Audio, Image sequence, Still frame, Captions only — and, per tab, every remaining option of `export-share` (codec, container, "Smooth motion", Maximum and Custom bitrate, rate control, audio settings, captions, range, cover, provenance). Tapping Export SHALL show the export progress view, an overlay sheet of `mobile-editor.Tool sheets never cover the preview`, with percentage, estimated time remaining (`export-share.Progress and estimated time remaining`), Pause / Resume (`export-share.Pause and resume export`, on-device exports only), Cancel (`export-share.Cancel export`) and, for on-device exports, the notice "Keep the app open until the export finishes"; the screen SHALL be kept awake during an on-device export. Foreground, background, screen-lock and termination behaviour SHALL be exactly that of `export-share.Pause and resume export`, which is the single rule for iOS and Android: this capability adds none, the engine surface is not disposed and no sink is timed out while an on-device export is `running` or `paused` (`mobile-editor.Engine surface lifecycle`), and a job that cannot continue fails with `export/interrupted`. On completion the view SHALL show the actions of `export-share.Mobile share targets` plus Done. A failed export SHALL show the reason and the actions of `export-share.Failure diagnostics and retry`. [CAPCUT CC-245, CC-246, CC-247, CC-253, CC-255] [NEW]

#### Scenario: Quick sheet layout
- **WHEN** the user taps the export chip
- **THEN** the sheet shows the Resolution, Frame rate and Bitrate sliders, the estimated size, the target selector and "More settings", in that order

#### Scenario: Six export types
- **WHEN** the user opens "More settings"
- **THEN** the tabs are Video, GIF, Audio, Image sequence, Still frame and Captions only, in that order, on iOS and on Android

#### Scenario: Unsupported resolution
- **WHEN** the device cannot encode 4K
- **THEN** the 4K step is disabled and shows the reason supplied by `export-share`

#### Scenario: Cancel
- **WHEN** the user cancels at 40 %
- **THEN** no file is saved and the editor is shown unchanged

#### Scenario: App in the background for two minutes
- **WHEN** an on-device export is at 30 % and the app is in the background for 120 s and returns with the engine, encoder and GPU device intact
- **THEN** the progress view shows `paused` on return, the export resumes without user action from the frame after the last one written, and the finished file has the same frame count as an uninterrupted export

#### Scenario: Encoder lost in the background
- **WHEN** an on-device export is paused in the background for 120 s and the video encoder cannot be continued with the same configuration on return (`render-engine.Mobile export path`)
- **THEN** the progress view shows the failure `export/interrupted` with the retry actions of `export-share` and no partial file remains

#### Scenario: Engine terminated in the background
- **WHEN** the operating system terminates the engine while an on-device export is paused in the background
- **THEN** on return the progress view shows the failure `export/interrupted` with the retry actions of `export-share`

#### Scenario: User pause of one minute
- **WHEN** the user taps Pause at 50 %, waits 60 s with the app in the foreground and taps Resume
- **THEN** the export continues from 50 % and completes

#### Scenario: Remote target
- **WHEN** the target selector is set to the remote target
- **THEN** the progress view reflects the host job and the app does not need to stay in the foreground

### Requirement: Fullscreen preview and orientation
On phones the editor SHALL be locked to portrait. Fullscreen SHALL show only the preview: for a project wider than tall it SHALL rotate to landscape; otherwise it SHALL stay portrait. Fullscreen SHALL overlay a transport bar (play/pause, scrubber, time, the playback-rate menu of `preview-canvas.Playback rate and JKL shuttle`, exit) that hides after 3 s without touch and reappears on tap. Exiting SHALL restore the editor in portrait with the same playhead and selection. [CAPCUT CC-287] [NEW]

#### Scenario: Landscape project
- **WHEN** the user enters fullscreen in a 16:9 project on a phone
- **THEN** the preview fills the screen in landscape

#### Scenario: Controls auto-hide
- **WHEN** 3 s pass without touch in fullscreen
- **THEN** the transport bar is hidden and a tap shows it again

### Requirement: Tablet layout
This requirement is the single owner of the editor layout on iOS and Android tablets; `app-shell-navigation` defines none. On iOS, iPadOS and Android the editor route SHALL always present the editor of this capability, whatever shell breakpoint the window falls in: the phone layout (`mobile-editor.Portrait screen structure`) when the shortest side of the app window is below 600 dp, and the tablet layout of this requirement otherwise. The four-region layout of `app-shell-navigation.Editor four-region layout` is the editor of the web and desktop builds only and is never shown by the iOS or Android app. The 600 dp threshold selects the editor layout only; every other screen follows the breakpoints of `design-system.Breakpoints and layout constants`. The rule, the threshold and both layouts are identical on iPadOS and Android tablets, foldables and resizable windows.

The tablet layout SHALL support portrait and landscape with live rotation that preserves playhead, selection, zoom and any open tool. There is ONE tablet layout with two arrangements of the same regions (top bar, preview, transport row, timeline, toolbar strip, side panel):
- **Landscape (window width ≥ window height):** top bar across the top; preview at the top left with the transport row under it; a 340 pt side panel at the right, full height below the top bar, showing the selected element's tool panels (the sheets of the phone layout rendered in the panel, so that no bottom sheet is used) with the tab structure of `preview-canvas.Inspector structure per element type`, and — with nothing selected — the panel of the active root tool or the project details of `preview-canvas.Inspector empty state and project details`; the bottom toolbar as a single strip above the timeline; the timeline across the bottom at 38 % of the window height with all lanes expanded and lane labels (`mobile-editor.Secondary lanes`).
- **Portrait (window height > window width):** the same regions stacked — top bar, preview (at least 35 % of the window height), transport row, toolbar strip, timeline with all lanes expanded — and the side panel replaced by sheets limited to 45 % of the window height.

In both arrangements the toolbars, strips, tool ids, sheet contents, gestures and constants are those of the phone layout (`mobile-editor.Two-level bottom toolbar`, `mobile-editor.Touch gesture constants`); list sheets and overlay sheets (`mobile-editor.Tool sheets never cover the preview`) are presented as centred sheets 560 pt wide. Split-screen and resizable windows whose shortest side falls below 600 dp SHALL switch to the phone layout without losing state, and back. A hardware keyboard SHALL use the bindings of `keyboard-shortcuts.Platform coverage of shortcuts` delivered by `JagentchillKeyboard` (`mobile-editor.Native modules and app registration`), and a pointer device SHALL get hover states, right-click context menus and — for text — the in-place overlay of `preview-canvas.In-place text editing`. [CAPCUT CC-287] [NEW]

#### Scenario: Landscape tablet
- **WHEN** the editor is opened on a 1180×820 pt tablet in landscape and a clip is selected
- **THEN** the clip's tools appear in the 340 pt right side panel and no bottom sheet covers the timeline

#### Scenario: Wide tablet never shows the four-region editor
- **WHEN** the iPadOS or Android app opens the editor in a 1366×1024 pt window, which is a wide form factor for the shell
- **THEN** the tablet layout of this requirement is shown with the mobile toolbar strip, and the four-region desktop editor is not

#### Scenario: Rotation
- **WHEN** the tablet is rotated while a clip is selected at playhead 7 s
- **THEN** the arrangement changes between landscape and portrait and the clip is still selected at 7 s

#### Scenario: Split screen
- **WHEN** the app window is resized to 400 dp wide
- **THEN** the phone layout is used and the open project state is unchanged

#### Scenario: Same on both systems
- **WHEN** the layout test runs at 1024×768 and 768×1024 on iPadOS and on Android
- **THEN** the same regions with the same sizes are measured on both

### Requirement: Engine view native module
On iOS and Android the engine surface SHALL be hosted by a product-owned Expo native view module `JagentchillEngineView` in `apps/app` (design D4); the stock `react-native-webview` package SHALL NOT be used for the engine, because it exposes neither a custom scheme handler with responses on iOS nor request interception with responses and a binary channel on Android. The module SHALL wrap one platform WebView (`WKWebView` on iOS, Android System WebView on Android) that owns the preview canvas, wasm, decoders and audio; timeline, toolbars and panels remain React Native.

This requirement is the single definition of the module's JavaScript interface — identical on iOS and Android — and `render-engine` cites it; `render-engine` is the single owner of what crosses it (envelope, commands, events, size limits, sink chunking, acknowledgement, verification and timeouts: `render-engine.EngineSurface message envelope`, `render-engine.EngineSurface commands from app to engine`, `render-engine.EngineSurface events from engine to app`, `render-engine.Mobile WebView surface bridge`, `render-engine.Mobile binary return path`) and this capability restates none of it.

| Member | Kind | Contract |
|---|---|---|
| `surfaceId: string` | prop | identifies the surface in every event |
| `visible: boolean` | prop | `false` stops compositing to the screen without disposing the engine |
| `post(envelopeJson: string): void` | method | delivers one envelope to the engine page |
| `setResourceMap({media: {[assetId]: {[variant]: fileUri}}, fonts: {[fontId]: fileUri}, snapshots: {[snapshotId]: fileUri}, derived: {[sha256]: fileUri}}): Promise<void>` | method | replace-all map from the ids used in the local-origin paths `/media/<assetId>/<variant>`, `/font/<fontId>`, `/snapshot/<snapshotId>` and `/derived/<sha256>` (`render-engine.Derived asset delivery to the engine`) to files in the app file store; the native side serves exactly these files plus the engine bundle and nothing else; it resolves when the map is active and MUST be awaited before `media.setSources`, `fonts.set` or a `scene.set` by reference names a new id; `variant` is `original`, `preview` or `mezzanine` |
| `openSink(streamId: string, {kind: "export" \| "still" \| "thumbnail", destinationUri?: string}): Promise<void>` | method | declares where the bytes of a sink stream go before the engine opens it: `export` — `destinationUri` is required and names a file in the app's export directory; `still` and `thumbnail` — the native side creates a file in the app cache directory when `destinationUri` is absent; a stream the app did not open is refused with `onSinkAborted {code: "engine/sink-unknown"}` |
| `closeSink(streamId: string): Promise<void>` | method | aborts a stream from the app side and deletes its partial file |
| `beginBackgroundWork(): Promise<{grantId}>` / `endBackgroundWork(grantId)` | methods | obtain and release the operating system's background-execution grant used by `export-share.Pause and resume export` (iOS: a background task; Android: a media-processing foreground service with the ongoing notification "Exporting…", held until the export ends or is paused — decision E13, no product time cap); the grant's expiry is delivered as `onBackgroundExpiring` |
| `dispose(): Promise<void>` | method | destroys the WebView and every open sink; refused with `engine/export-active` while an `export` sink is open |
| `onMessage({surfaceId, envelopeJson})` | event | one envelope from the engine page |
| `onSinkClosed({streamId, uri, totalBytes, sha256})` | event | the stream ended, both values were verified and the file at `uri` (`file://`) is complete; React Native never receives the bytes |
| `onSinkAborted({streamId, code})` | event | the stream failed with a code of `render-engine.Engine error codes`; its partial file was deleted |
| `onBackgroundExpiring({grantId, remaining_ms})` | event | the operating system is about to end the grant |
| `onProcessGone({reason})` | event | the WebView content process ended (`crashed`, `killed`, `unresponsive`) |
| `onLowMemory()` | event | the operating system's memory warning |

There is no per-chunk event and no event that carries file bytes. On both systems the WebView SHALL be configured so that media playback and audio start need no user gesture inside the WebView (iOS: `mediaTypesRequiringUserActionForPlayback` empty and inline playback allowed; Android: `setMediaPlaybackRequiresUserGesture(false)`), because every touch is handled by React Native and `transport.play` arrives over the bridge. The WebView SHALL load only the app's bundled engine page, SHALL block navigation to any other origin, SHALL have no access to non-local origins, and SHALL ignore pointer input (touches are handled by the React Native layer above it). [NEW]

#### Scenario: Engine page loads from the bundle
- **WHEN** an editor opens on a phone in airplane mode
- **THEN** the engine page and wasm load from the app bundle and `engine.ready` is received

#### Scenario: External navigation blocked
- **WHEN** the engine page attempts to navigate to an https URL on another host
- **THEN** the navigation is cancelled and a diagnostic entry `surface/navigation-blocked` is recorded

#### Scenario: No stock WebView package
- **WHEN** the dependency check of the app package runs
- **THEN** it fails if `react-native-webview` is a dependency of the engine surface module

#### Scenario: Asset id resolves through the resource map
- **WHEN** the app calls `setResourceMap` with `media: {"a1": {"preview": "file:///…/a1-720.mp4"}}` and the engine then requests `/media/a1/preview`
- **THEN** the bytes of that file are served, and a request for `/media/a1/original`, which is not in the map, is answered 404

#### Scenario: Sink destination is declared by the app
- **WHEN** the app calls `openSink("s7", {kind: "export", destinationUri})` and the engine streams 100 MiB to stream `s7`
- **THEN** `onSinkClosed` reports that `uri`, `totalBytes` 104 857 600 and the SHA-256 of the file

#### Scenario: Unopened stream is refused
- **WHEN** the engine page opens a sink stream whose id the app never passed to `openSink`
- **THEN** no file is created and `onSinkAborted` reports `engine/sink-unknown`

#### Scenario: Dispose refused during an export
- **WHEN** `dispose()` is called while an `export` sink is open
- **THEN** it rejects with `engine/export-active` and the WebView keeps running

#### Scenario: Same interface on both systems
- **WHEN** the module contract test enumerates the members on iOS and on Android
- **THEN** both expose exactly the members of the table with the same parameter and event shapes

### Requirement: Canvas view native module
On iOS and Android the workflow canvas (the archify-derived canvas of design D12, package `packages/archify`) SHALL be hosted by a second product-owned Expo native view module, `JagentchillCanvasView`, in `apps/app`, built on the same native code path as `JagentchillEngineView` (one `WKWebView` on iOS, one Android System WebView on Android, no `react-native-webview`). This capability owns the module and its JavaScript interface — identical on iOS and Android; `workflow-diagram.Runtime hosting on each platform` owns the canvas page, its message protocol, touch and keyboard handling inside the page, pooling and start-up budgets, and cites this requirement instead of restating the interface.

| Member | Kind | Contract |
|---|---|---|
| `canvasId: string` | prop | identifies the instance in every event |
| `visible: boolean` | prop | `false` stops painting without disposing the page |
| `interactive: boolean` | prop | `true` (default): the WebView receives every touch that lands on it; `false`: user interaction is disabled on the native view so touches pass to the React Native parent (miniatures and thumbnails inside scrolling lists) |
| `post(envelopeJson: string): void` | method | delivers one envelope to the canvas page |
| `setResourceMap({assets: {[assetId]: fileUri}, fonts: {[fontId]: fileUri}}): Promise<void>` | method | replace-all map for the local-origin paths `/asset/<assetId>` and `/font/<fontId>`; nothing outside the canvas bundle and this map is served |
| `openSink(streamId: string, {kind: "export" \| "still" \| "thumbnail", destinationUri?: string}): Promise<void>` | method | as in `mobile-editor.Engine view native module`; used for PNG, SVG and WebM exports and node thumbnails |
| `closeSink(streamId: string): Promise<void>` | method | aborts a stream and deletes its partial file |
| `dispose(): Promise<void>` | method | destroys the WebView |
| `onMessage({canvasId, envelopeJson})`, `onSinkClosed({streamId, uri, totalBytes, sha256})`, `onSinkAborted({streamId, code})`, `onProcessGone({reason})`, `onLowMemory()` | events | as in `mobile-editor.Engine view native module` |

The canvas page SHALL be served only from the app bundle through the same local-origin mechanism as the engine — Android `https://canvas.jagentchill.localhost/` answered entirely by `shouldInterceptRequest`, iOS `jagentchill-canvas://app/` answered by a `WKURLSchemeHandler` — with single-range support, no cookies, no access to any non-local origin and navigation to any other origin cancelled. Sink streams use the wire protocol of `render-engine.Mobile binary return path` unchanged. The canvas view and the engine view are separate WebViews with separate origins and share no storage. Loss of the content process is reported by `onProcessGone` and handled by `workflow-diagram`; the engine counters of `mobile-editor.Engine surface lifecycle` do not count it. [NEW]

#### Scenario: Canvas page loads offline
- **WHEN** a workflow is opened on a phone in airplane mode
- **THEN** the canvas page loads from the app bundle and its `ready` message arrives through `onMessage`

#### Scenario: Non-interactive miniature lets the list scroll
- **WHEN** a canvas view with `interactive: false` sits inside a scrolling list and the user drags over it
- **THEN** the list scrolls and the canvas page receives no pointer event

#### Scenario: Separate origins
- **WHEN** the canvas page requests a path of the engine origin
- **THEN** the request is refused and nothing is returned

#### Scenario: Same interface on both systems
- **WHEN** the module contract test enumerates the members on iOS and on Android
- **THEN** both expose exactly the members of the table

#### Scenario: PNG export returns by reference
- **WHEN** the canvas exports a PNG of a 200-node workflow through a `still` sink
- **THEN** the app receives `onSinkClosed` with a `file://` URI and never the image bytes

### Requirement: Engine media serving path
The engine page, its wasm and worker files, fonts, proxies and media SHALL be served to the engine WebView only by the native module from the app bundle and the app's file store: on Android from the origin `https://engine.jagentchill.localhost/` answered entirely through `shouldInterceptRequest` (the host name is never resolved through DNS and no socket is opened); on iOS from `jagentchill-engine://app/` answered through a `WKURLSchemeHandler`. Both SHALL support single-range requests (`Range: bytes=a-b`, response 206 with `Content-Range`), SHALL answer only requests that originate from the engine WebView, SHALL answer only the engine bundle and the paths `/media/<assetId>/<variant>`, `/font/<fontId>`, `/snapshot/<snapshotId>` and `/derived/<sha256>` whose id is present in the resource map last set through `setResourceMap` (`mobile-editor.Engine view native module`) — the map, not a path convention, decides which file an id names — SHALL refuse every other path with 404, and SHALL send no cookies or credentials. The path grammar and the variants are owned by `render-engine.Mobile WebView surface bridge`. At `engine.init` the engine SHALL assert `isSecureContext === true`; when the assertion fails or wasm or workers cannot start, initialisation SHALL fail with `engine/unsupported-runtime` and the state "unsupported runtime" of `preview-canvas.Engine states` SHALL be shown. Media that lives only on the paired host is fetched by the native transport module (`mobile-editor.Native modules and app registration`) into the app file store before it is served; the engine WebView never contacts a host. [NEW]

#### Scenario: Range request
- **WHEN** the engine requests bytes 1 048 576–2 097 151 of a 200 MiB video asset
- **THEN** the response is 206 with exactly 1 048 576 bytes and a matching `Content-Range` header

#### Scenario: Secure context
- **WHEN** the engine initialises on a supported device
- **THEN** `isSecureContext` is true and a dedicated worker and a wasm module start

#### Scenario: Path outside the project
- **WHEN** the engine page requests a path that is neither in the engine bundle nor an id of the current resource map
- **THEN** the response is 404 and no file content is returned

#### Scenario: Font and snapshot paths are served
- **WHEN** the resource map lists font `f1` and snapshot `s1` and the engine requests `/font/f1` and `/snapshot/s1`
- **THEN** both are answered 200 with the mapped files

#### Scenario: Insecure context
- **WHEN** `isSecureContext` is false at `engine.init`
- **THEN** initialisation fails with `engine/unsupported-runtime` and the unsupported-runtime state is shown

### Requirement: Engine binary return path
Binary data produced by the engine (export files, stills, thumbnails) SHALL return to the app only through the sink streams of `render-engine.Mobile binary return path`, which is the single owner of the wire protocol on both systems (transport per platform, chunk size, sequence numbers, acknowledgement, in-flight limit, base64 fallback, final verification, the idle timeout and their error codes); this capability defines only where the bytes land and when a stream is allowed to exist, through `openSink`, `onSinkClosed` and `onSinkAborted` of `mobile-editor.Engine view native module`.

Export output (decision B5; engine side: `render-engine.Mobile export path`, which this requirement cites and does not restate): a sink carries no positioned write, so a non-fragmented MP4 or MOV cannot be assembled on the native side. On iOS and Android alike an on-device export SHALL therefore be muxed by the engine into a file in the engine's own origin-private storage inside the WebView, where positioned writes are available and the `moov` box is finalised as `export-share.Container formats` requires; only after finalisation SHALL the finished file be streamed out through one `export` sink into `destinationUri` and the private copy deleted when `onSinkClosed` has verified it. This is the normal path on both systems, not a fallback. Stills and thumbnails are streamed directly through `still` and `thumbnail` sinks into the app cache directory. While an export is being muxed no sink is open; the copy-out is the stage "Saving" of `export-share.Progress and estimated time remaining`.

Because the output exists twice during the copy-out, the mobile pre-flight of `export-share.Pre-flight validation` requires free space of at least 2 × the estimated size on the app's storage volume. The sink idle timeout of `render-engine.Mobile binary return path` SHALL NOT run while the owning export is `paused` (`export-share.Pause and resume export`). The native side SHALL hand React Native a `file://` URI, never the bytes. [NEW]

#### Scenario: Export is finalised before it leaves the WebView
- **WHEN** an MP4 export of 100 MiB runs on a phone
- **THEN** no `export` sink is open while frames are encoded, one `export` sink is opened after the file is finalised, and the destination file is 100 MiB with the SHA-256 reported in `onSinkClosed`

#### Scenario: The exported file is non-fragmented
- **WHEN** the destination MP4 of an on-device export is parsed on iOS and on Android
- **THEN** it contains one `moov` box and no `moof` box

#### Scenario: Thumbnail by reference
- **WHEN** the engine produces a thumbnail
- **THEN** the app receives a `file://` URI in the cache directory through `onSinkClosed` and renders it with a native image view

#### Scenario: Copy-out failure keeps nothing half-written
- **WHEN** the sink aborts with `engine/sink-sequence` during the copy-out
- **THEN** the partial destination file is deleted, the job fails with `export/write-failed`, and "Save again" repeats only the copy-out while the finalised private copy exists (kept 24 h by `render-engine.Mobile export path`)

#### Scenario: Not enough space for two copies
- **WHEN** the estimated size is 1.2 GB and the app's storage volume has 2.0 GB free
- **THEN** pre-flight blocks the on-device export with `export/insufficient-space` naming 2.4 GB as required

#### Scenario: Paused export does not time out
- **WHEN** the copy-out is paused for 90 s by `export-share.Pause and resume export`
- **THEN** the sink is not aborted and the copy-out continues on resume

### Requirement: Engine clock extrapolation
During playback the engine SHALL report time with the event `transport.time {time, rate, playing, hostMono_ms}` defined by `render-engine.EngineSurface events from engine to app`; the React Native timeline SHALL NOT wait for an event per displayed frame. For every displayed frame the app SHALL compute the playhead as `time + rate × (nowMono_ms − hostMono_ms)` (converted to ticks and clamped to `[0, duration]`) from the latest event using the native monotonic clock, and SHALL replace the extrapolation with the reported value whenever a new event arrives; a correction larger than one frame duration SHALL be applied immediately without animation. When `playing` is false the app SHALL show exactly `time`. [NEW]

#### Scenario: Smooth playhead between events
- **WHEN** events arrive 30 times per second during 1× playback on a 60 Hz display
- **THEN** the timeline scroll position changes on every displayed frame

#### Scenario: Pause is exact
- **WHEN** the engine reports `playing: false` at time 3.500 s
- **THEN** the playhead is at exactly 3.500 s

### Requirement: Engine surface lifecycle
Exactly one engine surface SHALL exist at a time: it SHALL be created when an editor opens and destroyed when it closes. The ready handshake of `render-engine.Engine capability probe and ready handshake` SHALL be shown as a preview spinner and SHALL fail at 8 000 ms with a visible error and a Retry action. Background: when the app goes to the background, playback SHALL pause immediately; with no on-device export active, `memory.trim` SHALL be sent immediately and decoders and GPU resources SHALL be fully released after 30 s in the background. While an on-device export is `running` or `paused` (`export-share.Pause and resume export`) the engine surface SHALL NOT be disposed, `memory.trim` SHALL NOT be sent, no release timer SHALL run, and `dispose()` is refused by the native module (`mobile-editor.Engine view native module`) — on iOS and on Android alike, for as long as the export is active, whether the app is in the foreground or the background; the 30 s release timer starts when the export reaches a terminal state while the app is still in the background. On return the surface SHALL be restored from editor-core state and show the playhead frame without user action, within 2 000 ms when the full release had not happened and within 5 000 ms when it had. Low-memory signal: frame and thumbnail caches SHALL be dropped. Termination: when the operating system terminates the WebView content process, or the engine reports a wasm panic, the app SHALL recreate the surface, resend the full scene and restore the playhead so that the playhead frame is visible within 5 000 ms; the transport SHALL be restored paused; a gesture in flight SHALL be discarded without an undo step; a running or paused on-device export SHALL fail with `export/interrupted` (`export-share.Pause and resume export`); and a toast "Preview restarted" SHALL be shown. A content-process termination or out-of-memory failure that happens while an on-device transcription job is running SHALL be reported as that job's failure (`captions-subtitles.Transcription progress and cancel`), SHALL NOT count toward the restart counter below and SHALL show no "Preview restarted" toast; the surface is restored in the same way. No project data SHALL be lost, because project state lives in editor-core outside the WebView. Terminations and panics SHALL share one counter: three within 60 s SHALL stop automatic restarts and show the screen "The preview keeps stopping" with the actions Retry, Lower preview quality and Open diagnostics; the "Reload engine" banner of `render-engine.Wasm panic capture and recovery` applies to web and desktop only. [NEW]

#### Scenario: Short background
- **WHEN** the app is in the background for 10 s and returns
- **THEN** the preview shows the frame at the playhead within 2 000 ms and the project is unchanged

#### Scenario: Long background
- **WHEN** the app is in the background for 2 minutes and returns
- **THEN** the preview shows the frame at the playhead within 5 000 ms, playback is paused and the project is unchanged

#### Scenario: Long background during an export
- **WHEN** an on-device export is paused and the app stays in the background for 120 s
- **THEN** the engine surface still exists on return, no `memory.trim` was sent, and the export resumes or fails only as `export-share.Pause and resume export` defines

#### Scenario: Release after an export ends in the background
- **WHEN** an on-device export completes while the app is in the background and the app stays there for another 30 s
- **THEN** decoders and GPU resources are released 30 s after the completion, not before

#### Scenario: Kill during transcription
- **WHEN** the content process is terminated while an on-device transcription job is running
- **THEN** the job shows "Transcription failed on this device", the restart counter is unchanged, and the surface is restored showing the playhead frame

#### Scenario: WebView process killed
- **WHEN** the WebView content process is terminated during playback
- **THEN** within 5 000 ms the surface is recreated and shows the same frame, playback is paused, a toast reads "Preview restarted", and no edit is lost

#### Scenario: Kill during a drag
- **WHEN** the content process is terminated while the user is dragging a trim handle
- **THEN** the trim is discarded and the undo history is unchanged

#### Scenario: Kill during export
- **WHEN** the content process is terminated during an on-device export
- **THEN** the export fails with `export/interrupted` and no partial file remains

#### Scenario: Handshake timeout
- **WHEN** `engine.ready` is not received within 8 000 ms
- **THEN** the preview shows an error with Retry, and the timeline remains usable

#### Scenario: Repeated crashes
- **WHEN** a termination, a wasm panic and another termination occur within 60 s
- **THEN** automatic restarts stop and "The preview keeps stopping" is shown with its three actions

### Requirement: WebView capability spike matrix
Before any render task, spike S6 (design D4) SHALL be run inside `JagentchillEngineView` on each reference mobile device of `diagnostics-quality.Performance budgets` (iPhone 12 on the minimum iOS version; Snapdragon 778G with 6 GB on the minimum Android version), and its result per row SHALL be recorded as pass or fail with the measured value in `docs/decisions/`. A failed row SHALL activate the stated consequence in the product:

| # | Criterion | Passes when | Consequence of failure |
|---|---|---|---|
| 1 | Secure context on the local origin or scheme | `isSecureContext === true`; wasm and workers run | blocking: the serving path changes to an in-app loopback HTTP server and the spike is rerun |
| 2 | WebGPU adapter | `requestAdapter()` returns an adapter and the compositor passes the golden set | rendering uses WebGL2 on that platform |
| 3 | `VideoDecoder` H.264 1080p30 | decode at ≥ 1× real time; seek p95 ≤ 150 ms | proxy editing (720p) is forced on that device class |
| 4 | HEVC 4K decode | frames decode | originals are replaced by an H.264 mezzanine made by the host (`cross-device-sync.Media variants and proxies`); with no host the asset shows "Format not supported on this device" |
| 5 | `AudioDecoder` with AAC | AAC-LC 48 kHz decodes | blocking for playback: the minimum OS version of that platform is raised |
| 6 | `VideoEncoder` H.264 1080p30 | encode at ≥ 0.5× real time | export on that device class is offered only on the paired host |
| 7 | Audio encode | AAC available; otherwise Opus | fallback order Opus in MP4, then 16-bit PCM in MOV, then export on the host; MP4 with PCM is never written |
| 8 | Engine memory | 600 MiB held for 10 minutes of 1080p playback without the content process being killed | cache pools are lowered and proxy editing is forced |
| 9 | Export storage and copy-out (`render-engine.Mobile export path`) | a 1 GiB file is written with positioned writes in the engine's origin-private storage and then copied out through an `export` sink at ≥ 40 MiB/s with a matching SHA-256 | platform binary channel absent: `constraints.binarySink: "base64"` and the "Saving" stage shows its own time estimate; positioned writes or 1 GiB of private storage unavailable: blocking for on-device video export on that platform, which is then offered only on the paired host until fixed |
| 10 | Bridge | seek round trip p95 ≤ 8 ms; `transport.time` ≥ 30 events per second | event rate is lowered and app-side extrapolation carries the playhead |
| 11 | Audio session | iOS: preview audio is audible with the silent switch on (`navigator.audioSession.type = "playback"` plus the native category); Android: audio focus is granted and preview audio plays on the media stream while the ringer is silenced | blocking for release on the failing platform (no runtime flag); a native audio path is the remedy to build before that platform ships |
| 12 | Bundled colour emoji font | a string of 20 emoji from Noto Color Emoji laid out by the engine's shaper renders in colour through the engine text path on both phones, SSIM ≥ 0.98 against the reference render | the bitmap fallback of decision E5: emoji stickers and emoji in text are drawn from the pre-rendered 512 px bitmaps shipped with the app (`stickers-shapes.Emoji stickers`) on the failing platform; release is not blocked |
| 13 | On-device inference | the models `seg-person` at ≥ 3 fps and `face-mesh` at ≥ 8 fps run in the engine WebView (`ai-editing-tools.On-device model management`), and the Whisper models' peak memory is measured for `captions-subtitles.Transcription model picker` | blocking for release on the failing platform: the model or the inference runtime is changed until the row passes, because the host is never a requirement for an on-device tool (decision E3) |

The three product fallbacks — WebGL2 rendering, forced proxy editing, export on the paired host only — SHALL be driven at run time by the capability probe of `render-engine.Engine capability probe and ready handshake`, not by a device list. The minimum OS versions (working values iOS and iPadOS 26.0, Android 12 with Android System WebView at or above the pinned Chromium version) are owned by `updates-distribution.Mobile store distribution` and fixed from this matrix. [NEW]

#### Scenario: Spike record exists
- **WHEN** the coverage gate of `diagnostics-quality.CI gates` runs
- **THEN** it fails unless `docs/decisions/` contains the S6 record with a pass or fail entry and a measured value for each of the 13 rows on both reference devices

#### Scenario: Encoder too slow
- **WHEN** the capability probe reports that H.264 1080p30 encoding is below 0.5× real time
- **THEN** the export target selector offers only the remote target and "This device" is disabled with the reason

#### Scenario: No WebGPU
- **WHEN** the probe finds no WebGPU adapter and WebGL2 is available
- **THEN** the preview renders with WebGL2 and the compatibility banner of `preview-canvas.Degraded graphics notice` is shown

### Requirement: Mobile runtime requirements screen
When the engine's web runtime is older than the version pinned in `docs/product/TOOLCHAIN.md`, opening an editor SHALL show a full-screen notice with the installed and required versions and one action, and the project list, settings and pairing SHALL remain usable: on Android, where the runtime is the separately updated Android System WebView, the notice reads "Update Android System WebView" and the action opens the system store page of the WebView package; on iOS and iPadOS, where the runtime ships with the operating system, the notice reads "Update iOS" ("Update iPadOS" on a tablet) and the action opens the system Software Update settings. The version comparison is made by the app before any engine surface is created. When instead a created surface reports `engine/unsupported-runtime` (the version check passed but a capability is missing), the state "unsupported runtime" of `preview-canvas.Engine states` SHALL be shown with the same Update action added to its actions, on both systems. When a device forces proxy editing (matrix rows 3 or 8), importing a video SHALL create its 720p proxy before the clip becomes playable (`media-library.Proxy media`) and the clip SHALL show the progress of that job. [NEW]

#### Scenario: Old WebView
- **WHEN** the installed Android System WebView is older than the pinned version and the user opens a project
- **THEN** the notice is shown with both version numbers and no engine surface is created

#### Scenario: Old system web runtime on an iPhone
- **WHEN** the iPhone's system version is below the pinned version and the user opens a project
- **THEN** the notice "Update iOS" is shown with both version numbers, its action opens Software Update, and no engine surface is created

#### Scenario: Surface reports an unsupported runtime
- **WHEN** the version check passes, the surface is created and the engine reports `engine/unsupported-runtime`
- **THEN** the unsupported-runtime state of `preview-canvas.Engine states` is shown naming the missing capability, with the Update action for that system

#### Scenario: Forced proxy
- **WHEN** proxy editing is forced and the user imports a 4K clip
- **THEN** the clip is placed on the timeline with a proxy progress indicator and plays from the proxy when the job completes

### Requirement: Native modules and app registration
The mobile app SHALL ship six product-owned Expo native modules and no other custom native code for editor, canvas, keyboard or connection features, each with one JavaScript interface and one behaviour on iOS and Android: `JagentchillEngineView` (`mobile-editor.Engine view native module`); `JagentchillCanvasView`, the WebView host of the workflow canvas (`mobile-editor.Canvas view native module`; the canvas page it loads is owned by `workflow-diagram.Runtime hosting on each platform`); `JagentchillKeyboard`, the hardware-keyboard module cited by `keyboard-shortcuts.Platform coverage of shortcuts` — events `onKeyDown` / `onKeyUp({code, key, modifiers, repeat})` where `code` is the physical key in the grammar of `keyboard-shortcuts.Key grammar and physical-key mapping` (from `UIKeyCommand` / `pressesBegan` HID usages on iOS and iPadOS and from `dispatchKeyEvent` on Android), `isHardwareKeyboardAttached()` with the change event `onHardwareKeyboardChange({attached})`, and `publishShortcuts([{title, combination}])`, which feeds the Command-key overlay on iPadOS and the system shortcuts helper on Android (`onProvideKeyboardShortcuts`); a key event consumed by a focused native text input is not forwarded; `JagentchillTransport`, which performs every connection to a paired host — the one client channel of design D7 (the channel-P WebSocket and the signed `/jagentchill/v1/*` HTTP routes; the app opens no other connection to a host and holds no host credential other than its device key and device token) — enforcing the transport, certificate pinning and request-signing rules of `security-privacy.Transport protection`, `device-pairing-signing.Reconnect handshake` and `device-pairing-signing.Per-request HTTP signature`, selects the address by `device-pairing-signing.Address kinds and selection order`, and downloads and uploads media straight to and from the app file store; `JagentchillCrypto`, the key store and signer of `device-pairing-signing.Per-platform device key storage` (Keychain on iOS, Android Keystore on Android) exposing only the structured signing of `device-pairing-signing.Structured signing interface`; and `JagentchillTailnet`, the embedded tailnet node of `device-pairing-signing.Embedded tailnet node on mobile` — a Swift wrapper on iOS and a Kotlin wrapper on Android over one gomobile-built Go bridge — with exactly the interface defined there (`getStatus()`, `startLogin({ mode, authKey? })`, `logout()`, `openProxy(target)`, `closeProxy(port)`). For a host whose selected address is of kind `tailnet`, `JagentchillTransport` SHALL call `openProxy` and dial the returned `127.0.0.1` port; the handshake, pin and signatures apply unchanged over that proxied stream. The node's state lives in the app's private storage excluded from device backup, the node runs only while a tailnet-addressed host is in use and stops 60 seconds after its last proxy closed, and an auth key is passed to it once and never stored or logged. Neither the Tailscale app nor the operating system's VPN needs to be installed or active on the phone or tablet. `JagentchillTailnet` is gated by the client part of spike S20 (`diagnostics-quality.Gating spikes`) and is present in both store builds or in neither: when S20 fails on either mobile operating system the module is omitted from the iOS and the Android build alike, the app then ships five modules, `JagentchillTransport` dials a `tailnet` address through the operating system's Tailscale client, and the "Sign in to Tailscale" step becomes the "Open Tailscale" screen on both, exactly as `device-pairing-signing.Embedded tailnet node on mobile` defines. The screens that use these modules — "Add a host", then "Sign in to Tailscale", then code entry — and their routes are owned by `app-shell-navigation.Pairing flow routes` with the behaviour of `device-pairing-signing.Pairing flow on the new device` and `device-pairing-signing.Tailnet login step`; the pending offer is persisted across the sign-in detour and an app restart as defined there, and "Sign out of Tailscale" is on Personal ▸ Connections (`settings-preferences.Connections and devices page`). The Expo app configuration SHALL register the URL scheme `jagentchill` on iOS and Android and route incoming links exactly as `app-shell-navigation.Deep links and file types` defines (including `jagentchill://pair#offer=…`), and SHALL register the document types `.jagentchill` (`projects.Project package import`), `.jctpl` and `.jcpack` (`templates.Import a package`), `.jcworkflow`, `.jcscript`, `.fountain` and `.jckeys` so that opening or sharing such a file to the app starts the owning import flow. [JAD] [NEW]

#### Scenario: Deep link opens a project
- **WHEN** the user opens `jagentchill://editor/<projectId>` for a project stored on the phone
- **THEN** the app opens the editor on that project

#### Scenario: Shared template file
- **WHEN** the user shares a `.jctpl` file to the app from the system share sheet
- **THEN** the import flow of `templates.Import a package` starts for that file

#### Scenario: Pinned certificate mismatch
- **WHEN** the host presents a certificate whose SHA-256 differs from the pin in the offer
- **THEN** `JagentchillTransport` refuses the connection and no request is sent

#### Scenario: Host reached through the embedded tailnet node
- **WHEN** a phone with no Tailscale app installed is signed in through `JagentchillTailnet` and opens a host whose only reachable address is of kind `tailnet`
- **THEN** `JagentchillTransport` connects to `127.0.0.1` on the port returned by `openProxy`, the signed handshake completes and the connection path reads "Tailnet"

#### Scenario: Same interface on both systems
- **WHEN** the module contract test runs on iOS and on Android
- **THEN** `JagentchillTailnet`, `JagentchillTransport`, `JagentchillCrypto`, `JagentchillKeyboard`, `JagentchillEngineView` and `JagentchillCanvasView` expose the same methods and events and pass the same test vectors on both

#### Scenario: Hardware key reaches the action registry
- **WHEN** a hardware keyboard is attached to a tablet and the user presses the key bound to `timeline.split` with no text input focused
- **THEN** `onKeyDown` reports the physical key code on iPadOS and on Android and the split runs once

#### Scenario: Text input keeps its keys
- **WHEN** a native text input is focused and the user types the key bound to `playback.toggle`
- **THEN** the character is typed and no `onKeyDown` event is forwarded

#### Scenario: Node stops when idle
- **WHEN** the last tailnet proxy has been closed for 60 seconds
- **THEN** `getStatus()` reports `stopped` and no tailnet traffic leaves the device

### Requirement: Mobile performance budgets
The mobile editor SHALL be measured on the reference mobile devices named by `diagnostics-quality.Performance budgets`, with the fixture project "mobile-reference" (1080p30, 10 main-track clips on 720p proxies, one overlay, one text element, one filter layer). Budget values are stated only in `diagnostics-quality.Performance budgets` (product level) and `render-engine.Performance budgets` (engine level); this capability states none. The mobile editor SHALL emit, through `diagnostics-quality.Performance instrumentation`, the six mobile metrics whose ids, budget values and percentiles are defined only by the rows of `diagnostics-quality.Performance budgets` — `mobile.editor-open-to-first-frame`, `mobile.tool-tap-to-sheet-shown`, `mobile.timeline-scroll-frame-time`, `mobile.trim-handle-response`, `mobile.scrub-to-frame` and `mobile.app-memory-editing` — on iOS and on Android with the same ids; playback dropped frames and engine memory are reported by the engine. Preview-quality levels and the automatic lowering rule are owned by `render-engine.Preview resolution scaling`; the editor SHALL show one chip "Reduced preview quality" above the preview whenever quality `auto` is below `full`, and SHALL show no toast for quality changes. [NEW]

#### Scenario: Metrics are reported
- **WHEN** the automated mobile performance run opens the fixture project, opens a tool sheet, scrolls, scrubs and trims
- **THEN** a sample exists for each of the six metric ids and the run fails when any sample exceeds its budget in `diagnostics-quality.Performance budgets`

#### Scenario: Reduced quality chip
- **WHEN** the engine lowers `auto` quality to `half` during playback
- **THEN** the chip "Reduced preview quality" is visible, and it disappears when quality returns to `full`

### Requirement: Offline behaviour
Every editing function that runs on the device (timeline editing, text, stickers, shapes, bundled effects, filters, transitions, colour adjustment, keyframes, speed, masks, the bundled sound pack and starter stickers, on-device captions with a cached model, on-device export) SHALL work with no network and no host. Which tools need a host is derived only from `app-shell-navigation.Features that require a host` and `ai-editing-tools.Execution location per tool`; such tools SHALL stay visible with the link badge and open the requires-host sheet when used. Edits made while disconnected SHALL be saved locally and reconciled by `cross-device-sync.Offline branches` on reconnection; the top bar SHALL show the "Offline changes" save state until then. Media available only as a remote original SHALL be edited through its local proxy, and elements whose media has neither proxy nor original on the device SHALL follow `cross-device-sync.Missing media presentation`. [NEW]

#### Scenario: Airplane mode editing
- **WHEN** the device is in airplane mode and the user splits, trims, adds text, adds a bundled music track and exports at 1080p
- **THEN** every action succeeds and the file is saved to the device

#### Scenario: Missing media offline
- **WHEN** a synced project references a clip that was never downloaded and the device is offline
- **THEN** the clip shows the missing-media presentation and the rest of the timeline plays

### Requirement: Haptics
The editor SHALL give haptic feedback: light impact when a dragged edge, element or rotation snaps and when the playhead crosses a clip boundary during manual scrolling; medium impact on long-press pick-up and on drop; rigid impact when a trim or zoom limit is reached; success notification when an export completes; warning notification when an action is refused. Haptics SHALL follow the system haptic setting and an in-app "Haptic feedback" preference (default on) in `settings-preferences.Editing default preferences`, and SHALL NOT fire more than once per 60 ms. The five feedback kinds map to the nearest system pattern on each platform — the impact and notification feedback generators on iOS, the corresponding haptic-feedback constants and vibration effects on Android — and a device without a haptic actuator produces none. [NEW]

#### Scenario: Snap haptic
- **WHEN** a trimmed edge snaps to the playhead
- **THEN** one light impact fires

#### Scenario: Disabled
- **WHEN** the in-app haptic preference is off
- **THEN** no haptic fires for any editor gesture

#### Scenario: Rate limit
- **WHEN** fast scrolling moves the playhead across 5 clip boundaries within 100 ms
- **THEN** at most 2 light impacts fire

### Requirement: Mobile accessibility
Every interactive control SHALL have a touch target of at least 44×44 pt on iOS and 44×44 dp on Android (`mobile-editor.Touch gesture constants`), an accessibility label, role and state, and SHALL be reachable by VoiceOver and TalkBack in this order: top bar, preview, transport, timeline, toolbar. The timeline SHALL be exposed as an adjustable element whose increment and decrement move the playhead by 1 s (and by 1 frame through a custom action). Each clip SHALL be an element announced as "{type}, {name}, starts {time}, duration {time}" whose custom actions are exactly the list of `i18n-accessibility.Screen reader semantics` (select, split at playhead, trim start to playhead, trim end to playhead, move one position toward the start, move one position toward the end, duplicate, delete). Every drag gesture (trim, reorder, move, transform, layer order) SHALL have a non-drag alternative through those custom actions or a tool sheet. Toolbar labels SHALL support dynamic type up to 130 % without truncating the icon. Contrast SHALL meet `i18n-accessibility.Colour contrast`. "Reduce motion" SHALL remove slide and scale animations. [NEW]

#### Scenario: Screen reader moves the playhead
- **WHEN** VoiceOver focus is on the timeline and the user swipes up
- **THEN** the playhead moves forward by 1 s and the new time is announced

#### Scenario: Reorder without dragging
- **WHEN** a screen-reader user invokes the action that moves the first main-track clip one position toward the end
- **THEN** the clip becomes the second clip and the change is announced

#### Scenario: Trim without dragging
- **WHEN** a screen-reader user invokes "trim end to playhead" on a 10 s clip with the playhead 6 s into it
- **THEN** the clip is 6 s long as one undo step

### Requirement: Interruptions and audio session
The editor SHALL play audio in the media playback category defined by `render-engine.Mobile audio session`, so that preview audio is audible with the iOS silent switch on and, on Android, plays on the media stream with audio focus requested for playback. An incoming call, alarm, another app taking audio focus, or unplugging headphones SHALL pause playback and voiceover recording; playback SHALL NOT resume automatically. An interrupted voiceover recording SHALL keep the audio recorded up to the interruption. The app state (open project, playhead, selection, open tool) SHALL be restored when the app is relaunched after being terminated in the background. [NEW]

#### Scenario: Incoming call
- **WHEN** a call arrives during playback
- **THEN** playback pauses and stays paused after the call ends

#### Scenario: Restore after termination
- **WHEN** the operating system terminates the backgrounded app and the user reopens it
- **THEN** the same project opens at the same playhead position with all saved edits

### Requirement: Template editor variant
A project in template mode — `template.locked: true` of `project-document.Template mode model` — SHALL use this layout on phones: a top bar with Back, an audio selector chip (the current music name; opens the Audio tab), an overflow menu and Export; the preview; a transport row with play/pause, the time, Undo and Redo (with the toasts and disabled states of `mobile-editor.Transport row`); a horizontally scrollable row of slot chips (56×56 pt thumbnails with index, duration and a "required" dot); and bottom tabs Media, Text and Audio. The overflow menu SHALL contain "Apply brand" (`templates.Brand kit`; disabled with the hint "Your brand kit is empty" when it is), "Brand kit" (opens `templates.Brand kit` as a sheet), "Rename" and "Edit in full editor" (`templates.Open a template project in the full editor`). The standard timeline, root toolbar and clip tool strips SHALL NOT be shown, and no control of this layout issues a change that `project-document.Template lock enforcement` rejects. Slot actions are those of `templates.Replace and adjust slot media`; text and audio actions those of `templates.Edit template text and audio`. On tablets in the tablet layout the three tabs are shown in the side panel and the slot chips under the preview. The layout is the same on iOS and Android. [CAPCUT CC-227, CC-228, CC-231] [NEW]

#### Scenario: Template layout
- **WHEN** the user opens a template with 6 slots on a phone
- **THEN** six slot chips are shown under the preview with the tabs Media, Text and Audio at the bottom and no multi-track timeline

#### Scenario: Tap a chip
- **WHEN** the user taps chip 3
- **THEN** the playhead moves to the start of slot 3 and the slot's Replace, Adjust, Volume and Remove actions are shown

#### Scenario: Undo in template mode
- **WHEN** the user replaces the media of slot 2 and taps Undo in the transport row
- **THEN** slot 2 shows its previous media and the toast reads "Undo: Replace"

#### Scenario: Apply brand from the overflow menu
- **WHEN** the brand kit has a Heading font and two colours and the user chooses "Apply brand"
- **THEN** the change of `templates.Brand kit` is applied as one undo step
