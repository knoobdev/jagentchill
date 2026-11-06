## ADDED Requirements

### Requirement: Transition data model
The stored shape of a transition is defined only by `project-document.Track transition records`: a record of `kind: "transition"` in the `transitions[]` array of the `video` track that holds the two clips it joins, with the fields `{id, kind, fromElementId, toElementId, duration, type, params, easing, audioCrossfade, shape}`, mirrored by the outgoing element's `transitionOut` and the incoming element's `transitionIn`, both holding the record's `id`. This capability restates no field shape; it defines the behaviour on that record. `duration` is frame-aligned (`Transition duration limits`); `type` is a registered transition id of `Bundled transition library`; `easing` is one of `linear`, `ease-in`, `ease-out`, `ease-in-out` (default `ease-in-out`); `audioCrossfade` defaults to `true` and `shape` (the curve of the paired audio crossfade, see `Audio crossfade pairing`) to `equal-power`. A cut SHALL hold at most one record; an audio crossfade (`kind: "crossfade"`, owned by `audio-editing.Crossfades`) lives in the `transitions[]` array of an `audio` track and never on a cut of a `video` track. A command that deletes either element or breaks their adjacency SHALL remove the record and clear both element references in the same undo step, so the mirror rule of `project-document.Track transition records` always holds. Projects migrated from OpenCut classic have no transitions and SHALL load with empty `transitions[]` arrays and every `transitionIn`/`transitionOut` absent. Colour params are stored as lowercase hex strings. [PORT X-001, N-001] [CAPCUT CC-099]

#### Scenario: Both clips reference the transition
- **WHEN** a Cross Dissolve is added between clip A and clip B on the main track
- **THEN** the main track's `transitions` array holds one record with `kind: "transition"`, `fromElementId` = A's id and `toElementId` = B's id, `A.transitionOut` and `B.transitionIn` equal the record's `id`, and its `duration` equals 60 000 ticks (0.5 s) on a 30 fps project

#### Scenario: Unknown transition type
- **WHEN** a project contains a transition whose `type` is not registered
- **THEN** it is preserved on save, rendered as a Cross Dissolve of the same duration, and its inspector shows "Unavailable transition" with Replace and Remove buttons

#### Scenario: Record removed with its clip
- **WHEN** clip B is deleted
- **THEN** the record is removed from the track's `transitions` array and `A.transitionOut` is absent, in the same undo step as the deletion

### Requirement: Eligible cuts
A transition SHALL be allowed only between two elements that are on the same track, are each of type video, image or compound, and are exactly adjacent (the outgoing element's end tick equals the incoming element's start tick). Freeze elements (`type: "video"` with `freeze` set, see `speed-retime.Freeze frame`) are eligible like any video element. Both the main track and overlay video tracks SHALL be eligible. Text, sticker, graphic, effect (effect or filter kind), adjustment, caption and audio elements SHALL NOT take transitions; audio elements use `audio-editing.Crossfades`. A gap of 1 tick or more SHALL make the cut ineligible. [CAPCUT CC-099] [NEW]

#### Scenario: Gap prevents a transition
- **WHEN** two clips on an overlay track are separated by 1 frame and the user drags a transition between them
- **THEN** no drop target is shown and nothing is added

#### Scenario: Image-to-video cut is eligible
- **WHEN** an image element is immediately followed by a video element on the main track
- **THEN** the cut accepts a transition

#### Scenario: Freeze element is eligible
- **WHEN** a freeze element is immediately followed by the second part of the clip it was made from
- **THEN** the cut between them accepts a transition

### Requirement: Centred overlap using source handles
This requirement is the single definition of the transition overlap model; `render-engine.Transition nodes` implements it and no other requirement restates it. A transition of duration D SHALL be centred on the cut and occupy the window `[cut − floorToFrame(D/2), cut − floorToFrame(D/2) + D)`. Adding, resizing or removing a transition SHALL NOT change the start time, duration or trim of any element, and SHALL NOT change the total timeline duration. During the window the outgoing clip SHALL continue past its out-point using its source handle (media after its trim-out point, mapped through its retime) and the incoming clip SHALL start before its in-point using its handle (media before its trim-in point). Where a video clip's handle is shorter than its half of the window, the missing frames SHALL be filled by holding the clip's last (outgoing) or first (incoming) available frame. Image elements, freeze elements and compound elements SHALL be treated as having unlimited handles (a compound element holds its boundary frame). When a hold is in use the transition marker SHALL show a warning dot and the inspector SHALL state "Not enough extra footage: {x.x}s of the outgoing clip and {y.y}s of the incoming clip are held frames."; on mobile the same state SHALL be shown as a dot on the junction button and as that sentence in the Transitions sheet. [CAPCUT CC-099] [NEW]

#### Scenario: Timeline duration is unchanged
- **WHEN** a 1.0 s transition is added between two 5 s clips
- **THEN** each clip still starts and ends at the same ticks and the scene duration is still 10 s

#### Scenario: Full handles available
- **WHEN** the outgoing clip has 2 s of unused media after its out-point and the incoming clip has 2 s before its in-point, and D = 1.0 s
- **THEN** frames in the second half of the window show the outgoing clip's source media from 0–0.5 s past its out-point, with no held frames and no warning dot

#### Scenario: No handle on the incoming clip
- **WHEN** the incoming clip is trimmed to the very first frame of its source and D = 1.0 s
- **THEN** during the first half of the window the incoming side shows its first frame held
- **AND** the marker shows a warning dot and the inspector reports 0.5 s of held frames for the incoming clip

#### Scenario: Odd frame count
- **WHEN** a transition of 5 frames is placed on a cut at frame 100 of a 30 fps project
- **THEN** the window covers frames 98 to 102 inclusive

### Requirement: Transition duration limits
Duration SHALL be adjustable from 0.1 s to 5.0 s in steps of 0.1 s, rounded to whole frames with a minimum of 2 frames. The default SHALL be the user's "Default transition duration" preference (`settings-preferences.Editing default preferences`, initially 0.5 s). The maximum SHALL additionally be limited so that, for each of the two clips, the part of its in-transition window and the part of its out-transition window that lie inside the clip together do not exceed the clip's duration. A value above the limit that a person enters or drags in the UI SHALL be clamped and the inspector SHALL show "Limited to {x.x}s by clip length". Agent tools use the same limits through `jc_transition_set` but are never clamped: a tool call whose `duration` lies outside the limits of that cut is rejected with `OUT_OF_RANGE` and `details {field: "duration", min, max, value}` computed for that cut, and nothing is stored (`agent-editing-tools.Validation`). [CAPCUT CC-101] [NEW]

#### Scenario: Clamp by short clip
- **WHEN** the incoming clip lasts 0.6 s, has no out-transition, and the user sets the duration to 3.0 s
- **THEN** the duration is clamped to 1.2 s and the limit message is shown

#### Scenario: Two transitions on one clip
- **WHEN** a 2 s clip has a 2.0 s in-transition (1.0 s inside the clip) and the user adds an out-transition with default 0.5 s
- **THEN** the out-transition is created with duration 0.5 s (0.25 s inside the clip) because 1.0 + 0.25 ≤ 2.0
- **AND** attempting to raise it to 3.0 s clamps it to 2.0 s

#### Scenario: Minimum
- **WHEN** the user types 0 in the duration field on a 30 fps project
- **THEN** the stored duration is 0.1 s (3 frames)

#### Scenario: Maximum
- **WHEN** the user types 9 in the duration field for a cut between two 60 s clips
- **THEN** the stored duration is 5.0 s

#### Scenario: Tool call beyond the cut's limit
- **WHEN** `jc_transition_set` is called with `duration` 3.0 s on a cut whose incoming clip lasts 0.6 s
- **THEN** the call fails with `OUT_OF_RANGE` naming `duration` with `max` 1.2, and no transition is stored

### Requirement: Bundled transition library
The app SHALL ship exactly the following 55 transitions in 12 library categories, written for this project and available offline. The table below is normative for ids, names, categories, parameters, ranges and defaults; `catalog.md` next to this spec is normative for the `algorithm` and `keywords` of every id. Every transition also has the common `duration` and `easing` settings. "direction4" means select left / right / up / down; `seed` is an integer 0–9999 (default 0); ranges are inclusive with step 1 unless stated; "px" values follow `visual-effects-filters.Resolution-independent effect parameters`.

| Category | Type id | Name | Params (range, default) |
|---|---|---|---|
| Basic | `cross-dissolve` | Cross Dissolve | none |
| Basic | `dip-to-black` | Dip to Black | hold 0–50% of duration (0) |
| Basic | `dip-to-white` | Dip to White | hold 0–50% (0) |
| Basic | `dip-to-color` | Dip to Colour | color (#000000); hold 0–50% (0) |
| Basic | `additive-dissolve` | Additive Dissolve | none |
| Basic | `linear-wipe` | Linear Wipe | angle 0–360° (0); softness 0–100 (10) |
| Basic | `clock-wipe` | Clock Wipe | direction select clockwise/counter-clockwise (clockwise); startAngle 0–360° (0); softness 0–100 (5) |
| Basic | `barn-door` | Barn Door | orientation select horizontal/vertical (horizontal); mode select open/close (open); softness 0–100 (5) |
| Slide | `slide` | Slide | direction4 (left) |
| Slide | `push` | Push | direction4 (left) |
| Slide | `cover` | Cover | direction4 (left) |
| Slide | `uncover` | Uncover | direction4 (left) |
| Slide | `elastic-slide` | Elastic Slide | direction4 (left); bounce 0–100 (40) |
| Camera | `zoom-in` | Zoom In | scale 110–800% (300); blur 0–100 (40) |
| Camera | `zoom-out` | Zoom Out | scale 110–800% (300); blur 0–100 (40) |
| Camera | `whip-pan` | Whip Pan | direction4 (left); blur 0–100 (70) |
| Camera | `spin` | Spin | turns 0.25–4 step 0.25 (1); direction select clockwise/counter-clockwise (clockwise); blur 0–100 (50) |
| Camera | `roll` | Roll | direction select clockwise/counter-clockwise (clockwise) |
| Camera | `shake-cut` | Shake Cut | intensity 0–100 (50); seed |
| Camera | `pull-focus` | Pull Focus | blur 0–100 (60) |
| Blur | `blur-dissolve` | Blur Dissolve | blur 0–100 (50) |
| Blur | `directional-blur-wipe` | Directional Blur | angle 0–360° (0); blur 0–100 (60) |
| Blur | `zoom-blur-dissolve` | Zoom Blur | blur 0–100 (60) |
| Distortion | `ripple-dissolve` | Ripple Dissolve | amplitude 0–100 (40); frequency 1–50 (12) |
| Distortion | `swirl` | Swirl | angle 90–1080° (360) |
| Distortion | `liquid-warp` | Liquid Warp | strength 0–100 (50); scale 1–100 (30); seed |
| Distortion | `domain-warp` | Domain Warp | strength 0–100 (60); scale 1–100 (24); seed |
| Distortion | `stretch` | Stretch | direction4 (left); amount 0–100 (60) |
| Glitch | `glitch-cut` | Glitch Cut | intensity 0–100 (60); seed |
| Glitch | `rgb-split-cut` | RGB Split | amount 0–100 (40) |
| Glitch | `chromatic-split` | Chromatic Split | amount 0–100 (60); direction select horizontal/vertical (horizontal) |
| Glitch | `pixelate` | Pixelate | maxBlock 4–256 px (64) |
| Glitch | `signal-noise` | Signal Noise | intensity 0–100 (50); seed |
| Light Effect | `flash` | Flash | color (#ffffff); intensity 0–100 (100) |
| Light Effect | `light-sweep` | Light Sweep | color (#ffd8a8); angle 0–360° (20); width 1–100 (30) |
| Light Effect | `film-burn` | Film Burn | color (#ff6a1a); intensity 0–100 (70); seed |
| Light Effect | `glow-dissolve` | Glow Dissolve | intensity 0–100 (60) |
| Light Effect | `light-leak-transition` | Light Leak | color (#ff8a3d); intensity 0–100 (60); position −100…100 (−30) |
| Split | `split-horizontal` | Split Horizontal | softness 0–100 (0) |
| Split | `split-vertical` | Split Vertical | softness 0–100 (0) |
| Split | `diagonal-split` | Diagonal Split | angle 0–360° (45) |
| Split | `shutter-slices` | Shutter Slices | count 2–40 (8); orientation select horizontal/vertical (vertical) |
| Mask | `iris-circle` | Iris Circle | softness 0–100 (5); centerX −100…100 (0); centerY −100…100 (0) |
| Mask | `iris-shape` | Iris Shape | shape select rectangle/diamond/star/heart (star); softness 0–100 (5) |
| Mask | `luma-fade` | Luma Fade | softness 0–100 (20); invert boolean (false) |
| Mask | `noise-dissolve` | Noise Dissolve | scale 1–100 (20); softness 0–100 (10); seed |
| Mask | `checkerboard` | Checkerboard | rows 1–20 (6); columns 1–20 (8) |
| Overlay | `ink-spread` | Ink Spread | color (#000000); softness 0–100 (30); seed |
| Overlay | `paper-tear` | Paper Tear | direction4 (left); edgeColor (#ffffff) |
| MG | `color-bars` | Colour Bars | colorA (#7c5cff); colorB (#22d3ee); colorC (#f59e0b); direction4 (left) |
| MG | `circle-burst` | Circle Burst | color (#7c5cff); rings 1–5 (3) |
| Social Media | `swipe-up` | Swipe Up | bounce 0–100 (30) |
| Social Media | `flip` | Flip | axis select horizontal/vertical (horizontal) |
| Social Media | `page-turn` | Page Turn | direction4 (left); shadow 0–100 (50) |
| Social Media | `cube-rotate` | Cube Rotate | direction4 (left); perspective 0–100 (50) |

Category counts: Basic 8, Slide 5, Camera 7, Blur 3, Distortion 4, Glitch 4, Light Effect 4, Split 4, Mask 5, Overlay 2, MG 2, Social Media 4. The library panel SHALL present the 13 library categories Featured, Basic, Camera, Overlay, Light Effect, Split, Distortion, Glitch, Blur, Social Media, Slide, MG and Mask, in that order. "Featured" SHALL be a fixed curated list of 10 existing transitions shipped with the app, in this order: Cross Dissolve, Dip to Black, Slide, Push, Zoom In, Whip Pan, Blur Dissolve, Glitch Cut, Flash, Luma Fade; the app SHALL NOT compute popularity from usage. Transition params are not keyframable. Each transition id SHALL have three golden-frame cases (progress 0.25, 0.5 and 0.75) under `render-engine.Golden-frame determinism`; one of the three cases of each id SHALL use two half-size overlay clips with transparent surroundings so the alpha rule of `Transition rendering` is exercised. A golden frame of a transition becomes normative only after a visual review against the `algorithm` text has been recorded in `docs/product/GOLDEN-REVIEW.md` with the reviewer, the commit and the SHA-256 of the shader source that produced it, and CI SHALL fail when a catalogue id has no golden cases, no review record, or a shader source whose hash differs from the recorded one. Every catalogue row states every constant that decides the picture; no row leaves a shape to the golden frame. [PORT N-001] [CAPCUT CC-100] [NEW]

#### Scenario: Cross dissolve midpoint
- **WHEN** a Cross Dissolve with `easing: linear` is at 50% progress
- **THEN** each output pixel is the average of the outgoing and incoming frames within 1/255 per channel

#### Scenario: Dip to black midpoint
- **WHEN** a Dip to Black with `hold = 0` between two main-track clips is at 50% progress
- **THEN** the frame is opaque black across the whole canvas

#### Scenario: Dip to black on a small overlay pair
- **WHEN** the same transition joins two overlay clips that each cover the left half of the canvas and is at 50% progress
- **THEN** the left half of the canvas is black and the right half shows the layers beneath unchanged

#### Scenario: Cross dissolve of partly transparent clips has no dark fringe
- **WHEN** a Cross Dissolve at 50% progress joins overlay clip A (opaque white in the left half, transparent elsewhere) and overlay clip B (opaque white in the right half, transparent elsewhere) over a white background
- **THEN** every canvas pixel is white within 1/255 per channel

#### Scenario: Library is complete offline
- **WHEN** the app starts with no network
- **THEN** the Transitions tab lists the 13 library categories plus Favourites and Recent, the 12 non-Featured library categories contain exactly 52 distinct tiles in total, and Featured contains exactly 10 tiles

#### Scenario: Progress end points
- **WHEN** any of the 52 transitions is evaluated at progress 0 and at progress 1 with default params
- **THEN** the output equals the outgoing frame at 0 and the incoming frame at 1, within 1/255 per channel

### Requirement: Transition library panel
The assets panel "Transitions" tab (tab list owned by `app-shell-navigation.Editor asset panel tabs`) SHALL show the category strip of `Bundled transition library`, with "Favourites", "Recent" and "My presets" inserted after "Featured". Tiles SHALL be 96×64 px on desktop/web and 72×48 px on mobile, each rendering the transition between two bundled sample frames (labelled A and B) authored for this project and recorded in `docs/product/ASSET-PROVENANCE.md`; hovering a tile for 300 ms on desktop/web SHALL play it once per second at the default duration, and on mobile the selected tile SHALL loop. Tiles SHALL be keyboard navigable: arrow keys move focus, Enter applies to the selected cut or the cut nearest the playhead, and the action `library.toggle-favourite` toggles the focused tile's favourite (default binding in `keyboard-shortcuts`). Favourites and Recent SHALL behave as in `visual-effects-filters.Favourites and recents`. With `backend: "none"` (`render-engine.Behaviour without a GPU backend`) tiles SHALL show a static category icon and name and remain applicable. [PORT X-001] [CAPCUT CC-100]

#### Scenario: Tab is functional
- **WHEN** the user opens the Transitions tab
- **THEN** a tile grid is shown (no "coming soon" notice) and hovering a tile animates A-to-B

#### Scenario: Thumbnail rendering unavailable
- **WHEN** the engine reported `backend: "none"` for the session
- **THEN** tiles show a static category icon and name and are still applicable

### Requirement: Search transitions
The Transitions tab SHALL have a search field matching case-insensitively and diacritic-insensitively on the localised name, English name and keywords across all categories, updating within 100 ms of the last keystroke. No match SHALL show "No results for "{query}"" with a "Clear search" button. [CAPCUT CC-102]

#### Scenario: Search by keyword
- **WHEN** the user types "wipe"
- **THEN** Linear Wipe, Clock Wipe and Directional Blur (keyword "wipe") are listed and no other category filter applies

#### Scenario: No results
- **WHEN** the user types "qqq"
- **THEN** the empty state with "Clear search" is shown

### Requirement: Apply a transition on desktop and web
The user SHALL be able to add a transition by (a) dragging a tile onto an eligible cut, where every eligible cut within 24 px of the pointer highlights as a 16 px-wide drop zone, (b) clicking the "+" button on a tile, which applies to the selected cut, or with no cut selected to the eligible cut nearest the playhead on the main track, or (c) invoking the action `transition.add-default` ("Add default transition"; its default binding is defined only in `keyboard-shortcuts`), which applies the user's default transition type (initially Cross Dissolve) and default duration to every eligible cut touching the selection, or to the cut nearest the playhead when nothing is selected. Applying SHALL be one undo step and SHALL select the new transition and open its inspector. [CAPCUT CC-099]

#### Scenario: Drag onto a cut
- **WHEN** the user drags "Push" and drops it within 24 px of an eligible cut
- **THEN** a Push transition with the default duration is created on that cut and selected

#### Scenario: No eligible cut
- **WHEN** the scene has a single clip and the user clicks "+" on a tile
- **THEN** nothing is added and a toast reads "Place two clips next to each other to add a transition"

#### Scenario: Default transition on a selection
- **WHEN** three adjacent clips are selected and the user invokes `transition.add-default`
- **THEN** two Cross Dissolve transitions are created, one on each cut between them, as a single undo step

### Requirement: Apply a transition on mobile
On mobile the entry point is the junction button drawn on eligible cuts; which lanes show junction buttons, and the button's visible and touch sizes, are owned by `mobile-editor.Main track filmstrip and magnetism` and `design-system.Timeline atoms`. This capability defines the Transitions sheet the button opens: the category strip, the tile grid with a leading "None" tile, a duration slider (0.1–5.0 s, limited by `Transition duration limits`), an "Apply to all" button, the held-frame notice of `Centred overlap using source handles`, and the header controls ✕ and ✓. Tapping a tile or moving the slider SHALL preview live through the render-only preview layer and loop the cut from 1 s before to 1 s after; nothing is written to the project until ✓, which commits every change made in the sheet (add, replace, duration, remove through "None", or "Apply to all") as one undo step. ✕ SHALL discard the previewed changes and add no undo step; the sheet's other closing gestures behave as defined by `mobile-editor.Tool sheets never cover the preview`. A junction that has a transition SHALL render its button filled with the transition icon. [CAPCUT CC-099, CC-101]

#### Scenario: Add from the junction button
- **WHEN** the user taps the junction button between two main-track clips, taps "Zoom In" and taps ✓
- **THEN** a Zoom In transition exists on that cut, the button is filled, and one undo removes it

#### Scenario: None removes
- **WHEN** the user taps "None" in the sheet for a cut that has a transition and taps ✓
- **THEN** the transition is removed and the button returns to its empty style

#### Scenario: Discard
- **WHEN** the user taps "Spin", drags the duration slider to 2.0 s and then taps ✕
- **THEN** the cut is as it was before the sheet opened and no undo step was recorded

#### Scenario: Held-frame notice on mobile
- **WHEN** the previewed transition needs 0.5 s of held frames on the incoming clip
- **THEN** the sheet shows the held-frame sentence and the junction button shows a dot

### Requirement: Timeline affordance
On desktop/web a transition SHALL render as a rounded bar spanning its window (`Centred overlap using source handles`) overlaid on the two clips, 20 px high, vertically centred on the track, with a two-triangle icon when at least 24 px wide and a 12 px-wide minimum hit area. Clicking it SHALL select it (drawn with the `timeline/selection` outline of `design-system.Timeline atoms`) and deselect elements; its left and right edges SHALL be draggable to change the duration symmetrically about the cut, frame-snapped, with a tooltip showing the duration to 0.1 s. The clip regions under the bar SHALL be drawn with a diagonal hatch. A selected transition SHALL respond to Delete/Backspace (remove) and Enter (focus the duration field). [CAPCUT CC-099, CC-101] [NEW]

#### Scenario: Resize by edge drag
- **WHEN** the user drags the right edge of a 0.5 s transition outward by the width of 0.25 s
- **THEN** the duration becomes 1.0 s (both edges move), the tooltip reads "1.0s", and one undo step is recorded on release

#### Scenario: Delete key
- **WHEN** a transition is selected and the user presses Delete
- **THEN** the transition is removed and neither clip changes

### Requirement: Transition inspector
Selecting a transition SHALL show in the inspector: its name and thumbnail, a "Replace" button, the duration slider and number field, the easing select, the type's params as defined in `Bundled transition library`, the "Audio crossfade" switch with its curve select (the five shapes of `audio-editing.Fade curve shapes`, stored as the record's `shape`), "Apply to all", "Set as default", "Save as preset" and "Remove". Param edits SHALL preview live while the preview loops the cut (from 1 s before to 1 s after) and commit as one undo step on release. "Set as default" SHALL store the type and duration as the user's default transition preference. [CAPCUT CC-101] [NEW]

#### Scenario: Edit a param
- **WHEN** the user changes Linear Wipe `angle` from 0 to 90
- **THEN** the wipe travels top-to-bottom in the looping preview and undo restores 0

#### Scenario: Set as default
- **WHEN** the user presses "Set as default" on a 0.8 s Whip Pan
- **THEN** the next `transition.add-default` creates a Whip Pan of 0.8 s

### Requirement: Replace a transition
Dropping a tile on a cut that already has a transition, clicking "+" with that transition selected, or choosing a tile after "Replace" SHALL change the transition's `type`, reset its params to the new type's defaults and keep its `id`, `duration`, `easing`, `audioCrossfade` and `shape`, as one undo step. [CAPCUT CC-099] [NEW]

#### Scenario: Replace keeps duration
- **WHEN** a 1.2 s Cross Dissolve is replaced by Spin
- **THEN** the cut has one transition of type `spin` with duration 1.2 s and Spin's default params

### Requirement: Remove a transition
The user SHALL be able to remove a transition with Delete/Backspace, the inspector's "Remove" button, the context-menu item "Remove transition", or the mobile "None" tile. Removal SHALL delete the record from the track's `transitions[]` and clear `transitionOut` and `transitionIn` on the two elements in one undo step and SHALL NOT move or trim either clip. The timeline context menu SHALL also offer "Remove all transitions" for the current scene, with a confirm dialog stating the count. [CAPCUT CC-099] [NEW]

#### Scenario: Remove restores a hard cut
- **WHEN** a transition is removed
- **THEN** the frame at the cut tick shows only the incoming clip and the frame before shows only the outgoing clip

#### Scenario: Remove all
- **WHEN** the scene has 7 transitions and the user confirms "Remove all transitions"
- **THEN** no transitions remain and a single undo restores all 7

### Requirement: Apply to all cuts
"Apply to all" SHALL copy the selected transition's type, params, easing, duration, audio-crossfade setting and crossfade shape to every eligible cut on the same track, replacing existing transitions, as a single undo step. Each copy's duration SHALL be clamped independently by `Transition duration limits`. Cuts on locked tracks SHALL be skipped. A toast SHALL report "Applied to {n} cuts" and, when any were clamped, "({m} shortened to fit)". [CAPCUT CC-103] [NEW]

#### Scenario: Apply to all on the main track
- **WHEN** the main track has 6 clips edge to edge and the user presses "Apply to all" on a 0.5 s Slide
- **THEN** all 5 cuts carry a Slide of 0.5 s with the same params

#### Scenario: Short clip clamps one copy
- **WHEN** one of those clips lasts 0.4 s
- **THEN** the transitions on its two cuts are clamped so their inside halves total at most 0.4 s, and the toast reports them as shortened

### Requirement: Audio crossfade pairing
The transition field `audioCrossfade` pairs the picture transition with an audio crossfade whose curve and level behaviour are owned by `audio-editing.Crossfades` and `audio-editing.Fade curve shapes`; this requirement defines only the pairing. When `audioCrossfade` is true and both clips have enabled source audio, the outgoing clip's source audio SHALL fade out and the incoming clip's source audio SHALL fade in over the transition window with the record's `shape` (default `equal-power`; the inspector shows it as a select beside the "Audio crossfade" switch), each side extending into its source handle exactly as the picture does; where a handle is missing, that side contributes silence beyond its boundary. The paired crossfade is not a separate record: it is the `audioCrossfade` and `shape` fields of the transition record and is removed with the transition. Interaction with the clips' own fades: while a transition with `audioCrossfade: true` exists, the paired crossfade REPLACES the outgoing clip's `fadeOut` and the incoming clip's `fadeIn` in the mix (they are not multiplied); the stored `fadeOut` and `fadeIn` values are kept unchanged in the document, their handles on those two clip ends are drawn dimmed with the tooltip "Replaced by the transition's audio crossfade", and they apply again as soon as the transition is removed or its switch is turned off. When `audioCrossfade` is false, audio SHALL cut hard at the cut tick and each clip's own fade at that end applies. If either clip's source audio has been extracted to a linked audio element (`audio-editing.Extract audio from video`), the pairing SHALL NOT apply and the switch SHALL be disabled with the tooltip "Audio was extracted. Add a crossfade on the audio track." [NEW]

#### Scenario: Equal-power crossfade
- **WHEN** both clips contain a constant tone at the same level and `audioCrossfade` is true
- **THEN** the mixed level at the midpoint of the window is within 0.5 dB of the level outside the window

#### Scenario: Switch off
- **WHEN** the user turns "Audio crossfade" off
- **THEN** the outgoing audio is silent from the cut tick onward and the incoming audio is silent before it

#### Scenario: Extracted audio
- **WHEN** the outgoing clip's audio was extracted to a linked audio element
- **THEN** the "Audio crossfade" switch is disabled with the stated tooltip and the clips' audio is not faded by the transition

#### Scenario: Clip fade is replaced, not lost
- **WHEN** the outgoing clip has a 1 s `fadeOut` and a 0.5 s Cross Dissolve with `audioCrossfade: true` is added at its end
- **THEN** the outgoing audio follows only the 0.5 s equal-power crossfade, the stored `fadeOut.duration` is still 1 s, and removing the transition makes the 1 s fade audible again

### Requirement: Interaction with trim
Trimming the edge of a clip at a cut that carries a transition SHALL keep the transition centred on the moved cut, provided the two clips remain adjacent (ripple trim or roll trim as defined by `timeline-editing.Trimming elements`). A trim that opens a gap at the cut SHALL remove the transition in the same undo step. Trimming either clip so that `Transition duration limits` is violated SHALL shorten the transition to the new maximum; if the maximum falls below 2 frames the transition SHALL be removed. The handle warning of `Centred overlap using source handles` SHALL be re-evaluated after every trim. [NEW]

#### Scenario: Ripple trim keeps the transition
- **WHEN** ripple editing is on and the user trims the outgoing clip's end 1 s earlier
- **THEN** the incoming clip moves 1 s earlier, the transition stays on the cut with the same duration, and one undo restores everything

#### Scenario: Trim opens a gap
- **WHEN** ripple editing is off and the user trims the outgoing clip's end 1 s earlier
- **THEN** the transition is removed, and undo restores both the trim and the transition

### Requirement: Interaction with split, move, delete and ripple
Splitting a clip SHALL NOT create a transition at the new cut; the left part keeps `transitionIn` and the right part keeps `transitionOut`. A split positioned inside a transition's range SHALL be allowed and SHALL then shorten that transition under `Transition duration limits`. Moving a clip so that it is no longer adjacent to its transition partner SHALL remove the affected transitions; moving two adjacent clips together SHALL keep the transition between them. Deleting a clip SHALL remove its transitions; when ripple closes the gap, no transition is created on the newly formed cut. Duplicating or copy/pasting a group of clips SHALL copy the transitions whose two clips are both in the group. All of these SHALL be part of the triggering command's single undo step. [NEW]

#### Scenario: Move breaks adjacency
- **WHEN** the user drags clip B, which has an in-transition from clip A, to another track
- **THEN** the transition is removed and undo restores clip B's position and the transition

#### Scenario: Copy a pair
- **WHEN** clips A and B with a transition between them are copied and pasted
- **THEN** the pasted copies have a transition of the same type, params and duration with a new id

#### Scenario: Delete with ripple
- **WHEN** clip B between A and C is deleted with ripple on, and B had transitions on both cuts
- **THEN** both transitions are removed and the new A–C cut has no transition

### Requirement: Interaction with speed, reverse and freeze
Handle availability SHALL be computed in source time with the functions of `speed-retime.Retime time map`: a clip at 2× needs twice the source media for the same half-window, and a reversed clip takes its outgoing handle from media before its source in-point and its incoming handle from media after its source out-point. Freeze elements and images SHALL be treated as unlimited handles. Changing a clip's speed, curve or reverse flag SHALL re-run `Transition duration limits` and the handle warning for its transitions in the same undo step. [NEW]

#### Scenario: Speed change shortens a transition
- **WHEN** a clip with a 2.0 s in-transition is sped up so that its duration becomes 0.8 s
- **THEN** the transition is clamped to 1.6 s and the speed change plus clamp undo together

#### Scenario: Reversed outgoing clip
- **WHEN** the outgoing clip shows source 2 s–6 s, is reversed, and has a 1.0 s out-transition
- **THEN** the second half of the window shows its source media from 2.0 s down to 1.5 s, and when the clip's source in-point is 0 s instead the frame at source 0 s is held and the warning dot is shown

#### Scenario: Freeze element has unlimited handles
- **WHEN** a 3 s freeze element is the incoming side of a 1.0 s transition
- **THEN** the incoming side shows the frozen frame for the whole window and no warning dot is shown

### Requirement: Transition rendering
Rendering order of a transition is defined by `render-engine.Transition nodes` and `render-engine.Per-layer stage order`; this requirement states what the two inputs are, the alpha rule and the blend rule as the transition formulas need them, and `render-engine.Transition alpha and blend rule` is their engine-side definition (descriptor fields `transition.blendModeFrom`, `transition.blendModeTo`, `transition.progress`). **Inputs.** Each of the two clips is rendered through its per-layer stage chain up to and including the `opacity` stage (its own crop, transform, keying, colour, filter, effects, masks and opacity are applied; its `blend` stage is not), into a canvas-size texture: `A` for the outgoing clip and `B` for the incoming clip. For a transition on the main track each input texture is first filled with that side's resolved canvas background (`render-engine.Background nodes`), so the whole picture of each side takes part and no separate background is drawn under the window; on overlay tracks the inputs start transparent. **Alpha.** `A` and `B` are converted to premultiplied alpha on entry to the transition shader, every formula of `catalog.md` operates on premultiplied RGBA (so `mix`, wipes and displacements never darken an edge next to a transparent area), and the result is converted back to straight alpha on exit. A colour that a transition introduces (black, white, `color`, a bar, a rim, a flash) is drawn with alpha `max(A.a, B.a)` of the pixel, so it appears only where the clips' picture is. **Blend.** The shader's output replaces the two layers at their track position and is composited onto the layers beneath with the outgoing clip's `blendMode` while the eased progress is below 0.5 and with the incoming clip's `blendMode` from 0.5 on (identical throughout when both clips use the same mode). **Progress.** The eased progress `p ∈ [0, 1)` passed to the shader SHALL be `ease((frameTime − windowStart) / D)` evaluated at the frame start time, with `ease` being the transition's `easing` (`linear` = identity, `ease-in` = cubic-bezier(0.42, 0, 1, 1), `ease-out` = cubic-bezier(0, 0, 0.58, 1), `ease-in-out` = cubic-bezier(0.42, 0, 0.58, 1)); the shader, its params and its `algorithm` are those of `Bundled transition library`. Preview and export SHALL use the same shaders within the tolerance of `render-engine.Golden-frame determinism`. With `backend: "none"` nothing renders (see `render-engine.Behaviour without a GPU backend`); transitions stay fully editable. [NEW]

#### Scenario: Frame-exact boundaries
- **WHEN** a transition spans 30 frames
- **THEN** the frame before the first window frame shows only the outgoing clip, the first window frame has progress 0, and the frame after the last window frame shows only the incoming clip

#### Scenario: Clip effects are included
- **WHEN** the outgoing clip has a Sepia filter and the incoming clip has none
- **THEN** during the transition the outgoing side is sepia-toned and the incoming side is not

#### Scenario: Easing changes progress
- **WHEN** a 30-frame Cross Dissolve uses `ease-in` and frame 15 of the window is rendered
- **THEN** the incoming clip's weight is `cubic-bezier(0.42, 0, 1, 1)` evaluated at 0.5 (0.315 ± 0.01), not 0.5

#### Scenario: Blend mode of an overlay pair is kept
- **WHEN** two adjacent overlay clips both use the Screen blend mode and a Cross Dissolve joins them
- **THEN** every frame of the window is composited onto the layers beneath with Screen, as before and after the window

#### Scenario: Different blend modes switch at the midpoint
- **WHEN** the outgoing clip uses Multiply and the incoming clip uses Normal with `easing: linear` on a 30-frame transition
- **THEN** window frames 0–14 are composited with Multiply and frames 15–29 with Normal

#### Scenario: Main-track backgrounds take part
- **WHEN** a Push joins a main-track clip with a blue background and one with a blurred background, both letterboxed
- **THEN** each clip's own background moves with it during the push and no third background is visible behind them

### Requirement: Transition persistence and agent access
Transitions are part of the project document (`project-document.Track transition records`) and are therefore saved with the project and included in autosave, version snapshots and cross-device sync; they SHALL be exposed to agents through the tools `jc_transition_set` and `jc_transition_remove` listed in `agent-editing-tools.Tool naming and families`, which execute the same commands the UI uses (add, replace, set duration, set params, remove, apply to all) with the limits of `Transition duration limits`. Every mutation SHALL go through an undoable command; redo SHALL restore the exact transition id. [NEW]

#### Scenario: Reload
- **WHEN** a project with 3 transitions is saved, closed and reopened
- **THEN** the same 3 transitions exist with identical ids, types, durations and params

#### Scenario: Redo keeps identity
- **WHEN** the user adds a transition, undoes and redoes
- **THEN** the transition has the same id as when first added

#### Scenario: Agent request above the limit
- **WHEN** `jc_transition_set` requests 3.0 s on a cut whose incoming clip lasts 0.6 s
- **THEN** the transition is created with 1.2 s and the tool result reports the clamped duration

### Requirement: Transition presets
The transition inspector's "Save as preset" SHALL store `{name, type, params, easing, duration, audioCrossfade, shape}` (parameter values only), with `name` 1–60 characters, unique, auto-suffixed " (2)" on collision, in user preferences on the device, synchronised through `cross-device-sync.Library item sync` and exportable in a preset pack (`templates.Preset packs`). At most 200 transition presets SHALL be stored; saving beyond that SHALL be refused with "Preset limit reached (200)". Presets SHALL be listed in the "My presets" category of the Transitions tab with the base transition's animated thumbnail; applying one behaves as applying its base tile and then writing its params, easing and duration (clamped by `Transition duration limits`) as one undo step. A preset whose `type` is not registered SHALL be listed disabled with "Unavailable transition". Rename and delete (with confirm) SHALL be offered from the tile menu. [NEW]

#### Scenario: Save and apply
- **WHEN** the user saves a 0.8 s Linear Wipe with angle 90 and softness 40 as "Soft drop" and applies it to another cut
- **THEN** that cut has a Linear Wipe of 0.8 s with angle 90 and softness 40, as one undo step

#### Scenario: Limit
- **WHEN** 200 transition presets exist and the user chooses "Save as preset"
- **THEN** nothing is saved and the message "Preset limit reached (200)" is shown
