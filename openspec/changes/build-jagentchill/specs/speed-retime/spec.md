## ADDED Requirements

### Requirement: Retime data model
This capability is the single owner of retime data, retime maths, speed curves, reverse and freeze frame; `timeline-editing`, `render-engine`, `audio-editing`, `transitions` and `agent-editing-tools` reference it. The stored shape of `retime {rate, maintainPitch, reverse, smooth, curve?}` and of `freeze`, their ranges and the element types that carry them are defined only by `project-document.Retime and speed-curve fields` and `project-document.Freeze field`; this capability restates no field shape and defines their meaning. Video and audio elements (including extracted and voiceover audio) carry `retime`, absent by default: `rate` is the constant speed multiplier used when `curve` is absent; `curve` is described in `Speed curve model`; `reverse` is the only place a reversed state is stored (no top-level `reverse` field exists); `smooth` selects the slow-motion method of `Smooth slow motion`. No retime value is animatable through the `animations` store. An absent `retime` SHALL mean rate 1, forward, pitch unchanged. When rate is 1, there is no curve, `reverse` is false and `smooth` is `"none"`, the `retime` object SHALL be removed from the element. An invalid or non-finite rate SHALL be read as 1. The mapping between element-local time and source time is defined by `Retime time map`. Image, text, sticker, graphic, effect (effect or filter kind), adjustment and caption elements and freeze elements SHALL NOT be retimable; compound elements SHALL accept constant rate and reverse only. Agent tools write the same object through `jc_speed_set {rate, maintainPitch, reverse, smooth, curve: {preset} | {points: {u, rate}[]}}`. [PORT SP-001, SP-004]

#### Scenario: Constant rate mapping
- **WHEN** a clip has `trimStart` 2 s and rate 2
- **THEN** local time 1 s shows the source frame at 4 s

#### Scenario: Neutral retime is removed
- **WHEN** the user sets the rate back to 1 on a forward clip with no curve and smoothing off
- **THEN** the element has no `retime` object

#### Scenario: Non-retimable element
- **WHEN** an image element or a freeze element is selected
- **THEN** no Speed tab or Speed tool is shown

#### Scenario: Compound element
- **WHEN** a compound element is selected
- **THEN** the Speed tab offers constant speed and Reverse, and the Curve and Velocity sub-tabs are disabled with "Not available for compound clips"

### Requirement: Retime time map
The retime maths SHALL be three pure functions in `packages/editor-core` (TypeScript, integer ticks in and out, no DOM and no wasm), and the Rust `time` crate SHALL export the same three functions under the parity rule of `render-engine.Pure TypeScript time maths with wasm parity`; no other code computes a retime mapping. With `S0` = the first visible source tick, `sourceSpan` = the visible source length in ticks and `D` = the element duration:

- `retimedDuration(sourceSpan, retime) → D`: constant rate — `roundHalfAway(sourceSpan / rate)`; curve — `T[1024]` of the table below; then snapped to the nearest project frame with a minimum of 1 frame.
- `sourceTimeAt(element, clipTime) → sourceTick` for `0 ≤ clipTime ≤ D`: let `τ = clipTime` when `retime.reverse` is false and `τ = D − clipTime` when it is true. Constant rate — `S0 + roundHalfAway(τ × rate)`; curve — `S0 + roundHalfAway(sourceSpan × U(τ))`, where `U` is the inverse of the table; the result is clamped to `[S0, S0 + sourceSpan]`. A freeze element returns its `freeze.sourceTime` for every `clipTime`.
- `clipTimeAt(element, sourceTick) → clipTime`: the inverse of `sourceTimeAt`, clamped to `[0, D]`; used for keyframe, caption, beat-marker and trim conversion.

Curve table: `r(u)` is the rate from `Speed curve model`; the table has exactly 1 025 nodes `u_k = k / 1024` (1 024 intervals) with `T[0] = 0` and `T[k] = roundHalfAway(sourceSpan × Σ_{i<k} (1/r(u_i) + 1/r(u_{i+1})) / 2048)`; `U(τ)` is found by binary search for the interval with `T[k] ≤ τ ≤ T[k+1]` and linear interpolation inside it. `r(u)` and the sums SHALL be evaluated in IEEE-754 binary64 using only addition, subtraction, multiplication, division and square root in the order written, so TypeScript and Rust agree to the tick. Video frame selection: for a forward element the frame presented at `clipTime` is the source frame whose presentation interval contains `sourceTimeAt(clipTime)`; for a reversed element it is the source frame whose presentation interval contains `sourceTimeAt(clipTime + frameDuration)`, so the first output frame shows the last visible source frame and the last output frame shows the frame at `S0`. Audio uses `sourceTimeAt` per sample position without that one-frame offset. Preview, export, thumbnails, filmstrips, waveform drawing, trim, split, transition handles, audio and agent tools SHALL all use these functions. The shared parity vectors SHALL contain at least 500 retime cases covering the six presets, constant rates 0.1, 2 and 100, reverse, and 10 s and 1 h sources. [PORT SP-004] [NEW]

#### Scenario: Constant mapping in ticks
- **WHEN** an element has `S0` = 240 000 ticks (2 s), rate 2 and `clipTime` = 120 000 ticks (1 s)
- **THEN** `sourceTimeAt` returns 480 000 ticks (4 s)

#### Scenario: Inverse
- **WHEN** `clipTimeAt` is called with the result of `sourceTimeAt(element, t)` for any frame-aligned `t` of an element using the Hero preset on a 10 s source
- **THEN** it returns `t` within 1 tick

#### Scenario: TypeScript and Rust agree
- **WHEN** the shared retime vectors (at least 500 cases) are run against the TypeScript functions and the Rust `time` crate
- **THEN** every `retimedDuration`, `sourceTimeAt` and `clipTimeAt` result is identical to the tick

#### Scenario: Reverse frame selection
- **WHEN** a 30 fps element showing source 2 s–6 s at rate 1 is reversed
- **THEN** the frame at clip time 0 is the source frame starting at 6 s minus one frame and the last frame is the source frame starting at 2 s

#### Scenario: One-hour source
- **WHEN** `retimedDuration` is evaluated for a 3 600 s source with the Montage preset
- **THEN** the result is a whole number of frames and equals `T[1024]` snapped to the frame grid, with no loss of integer precision

### Requirement: Constant speed range
Constant speed SHALL be adjustable from 0.1× to 100× with a default of 1×. The number field SHALL accept two decimals (step 0.01) with an "x" suffix; the slider SHALL be logarithmic with labelled stops at 0.1×, 1×, 2×, 5×, 10× and 100×, SHALL snap to a stop within 4 px unless Shift is held, and double-clicking it SHALL reset to 1×. Values typed outside the range SHALL be clamped. A rate between 0.01× and 0.1× read from a migrated OpenCut classic project SHALL be preserved and rendered as stored, shown in the field as stored, and clamped to 0.1× only when the user next edits it. A change of rate SHALL be one undo step. [PORT SP-001] [CAPCUT CC-073]

#### Scenario: Upper bound
- **WHEN** the user types 250
- **THEN** the rate is stored as 100

#### Scenario: Lower bound
- **WHEN** the user types 0.03
- **THEN** the rate is stored as 0.1

#### Scenario: Migrated slow clip
- **WHEN** a classic project with a clip at 0.05× is opened
- **THEN** the clip plays at 0.05× and the field shows "0.05x" until the user edits the speed

### Requirement: Duration linked to speed
This requirement is the single definition of the Speed tab's Duration control (`preview-canvas.Audio and Speed tab fields` hosts it). The Speed panel SHALL show an editable Duration field beside the speed control. Element duration SHALL always equal the visible source span divided by the rate (or the integral defined in `Speed curve model`), rounded to the nearest frame with a minimum of 1 frame. Editing the Duration field (timecode or seconds) SHALL set `rate = source span / requested duration`, clamped to 0.1–100, and then show the resulting duration. Changing speed SHALL keep the element's start time and change its end; when ripple editing or the main-track magnet is on, following elements SHALL shift by the duration delta; otherwise, on a track where the longer result would overlap the next element, the change SHALL be refused with the toast "Not enough room to slow this clip. Turn on ripple or move the next clip." A resulting duration above 6 hours SHALL be refused with "Resulting clip would be longer than 6 hours". [PORT SP-002] [CAPCUT CC-073] [NEW]

#### Scenario: Rate changes duration
- **WHEN** a clip showing 10 s of source is set to 2×
- **THEN** its duration becomes 5 s and its start time is unchanged

#### Scenario: Duration sets rate
- **WHEN** the user types a duration of 4 s for a clip showing 10 s of source
- **THEN** the rate becomes 2.5× and the duration is 4 s

#### Scenario: Requested duration out of range
- **WHEN** the user types a duration of 0.01 s for that clip
- **THEN** the rate is clamped to 100× and the Duration field shows 0.1 s

#### Scenario: No room without ripple
- **WHEN** ripple is off, another clip starts immediately after, and the user sets 0.5×
- **THEN** the change is refused with the stated toast and nothing changes

### Requirement: Pitch preservation
The Speed panel SHALL have a "Keep pitch" switch bound to `maintainPitch`, defaulting to on the first time a clip's speed is changed in JAgentChill; migrated classic clips SHALL keep their stored value. With it on, audio SHALL be time-stretched without pitch change for effective rates from 0.25× to 4×; outside that range audio SHALL be resampled (pitch follows speed) and the switch SHALL show the note "Pitch is kept between 0.25x and 4x". The decision is made once per element, never per instant: a speed curve whose rate `r(u)` leaves 0.25–4 anywhere is resampled for the whole clip (so the sound never switches method mid-clip). The stretch engine's own factor is the product of the retime stretch and the pitch-shift stretch of `audio-editing.Audio pitch shift`; when that combined factor leaves 0.25–4, Keep pitch is dropped first (the retime is resampled and the pitch shift alone is stretched), with the same note. With it off, audio SHALL be resampled with a band-limited resampler so pitch follows speed. The stretch engine SHALL be a JAgentChill-owned WSOLA implementation in the Rust audio crate (compiled to wasm, run in the audio worker): sequence 40 ms, seek window 15 ms, overlap 8 ms, processing block 4 096 frames, at the 48 000 Hz internal rate; `soundtouchjs` and any other LGPL- or GPL-licensed stretch library MUST NOT be shipped (`platform-skeleton.Licence and third-party notices`). The same engine serves `audio-editing.Audio pitch shift`. The setting SHALL apply identically in preview and export. For a clip with no audio the switch SHALL be hidden. [PORT SP-003] [CAPCUT CC-074]

#### Scenario: Keep pitch at 2×
- **WHEN** a clip containing a 440 Hz tone plays at 2× with Keep pitch on
- **THEN** the dominant frequency of the output is 440 Hz ±2% and the audio lasts half as long (±1 ms)

#### Scenario: Pitch follows speed
- **WHEN** Keep pitch is off at 2×
- **THEN** the dominant frequency is 880 Hz ±2%

#### Scenario: Outside the stretch range
- **WHEN** the rate is 8× with Keep pitch on
- **THEN** audio is resampled, the note is shown and the switch stays on

#### Scenario: Stretch at the range boundary
- **WHEN** a 440 Hz tone plays at 0.25× with Keep pitch on
- **THEN** the dominant frequency is 440 Hz ±2% and the audio lasts four times as long (±1 ms)

#### Scenario: Curve crossing the range
- **WHEN** a clip with Keep pitch on uses the Bullet preset (rates 0.5× to 5.5×)
- **THEN** the whole clip's audio is resampled, the note is shown, and no part of the clip is time-stretched

#### Scenario: Speed and pitch shift together
- **WHEN** a clip plays at 4× with Keep pitch on and a pitch shift of +12 semitones (combined stretch factor 8)
- **THEN** the retime is resampled and the +12 semitone shift is applied by a stretch factor of 2, with the note shown

### Requirement: Speed curve model
A speed curve SHALL be `{preset, points[]}` where `preset` is `"custom"`, `"montage"`, `"hero"`, `"bullet"`, `"jump-cut"`, `"flash-in"` or `"flash-out"`, and `points` is a list of 2 to 32 entries `{u, rate}` with `u` in 0–1 (normalised position within the clip's visible source span), strictly increasing, the first at `u = 0` and the last at `u = 1`, and `rate` in 0.1–10. The rate between points `r(u)` SHALL be the monotone cubic Hermite interpolant with Fritsch–Carlson tangents (interior tangent = mean of the two adjacent secant slopes, 0 where they differ in sign or either is 0, end tangents = the end secant slope, then limited so `α² + β² ≤ 9`), clamped to 0.1–10. Element duration and the local-time-to-source-time map SHALL be computed from this `r(u)` by `Retime time map` (1 025-node table). When a curve is present, `rate` SHALL be ignored for mapping and stored as the average rate (`sourceSpan / duration`) for display. Curves SHALL be available for video and audio elements and SHALL be applied to audio with the same time map. [PORT N-014] [CAPCUT CC-081] [NEW]

#### Scenario: Flat curve equals constant speed
- **WHEN** a curve has every point at rate 2 on a clip with 10 s of source
- **THEN** the duration is 5 s and every local time t maps to source `trimStart + 2t`

#### Scenario: Duration from the integral
- **WHEN** a three-point curve has rate 1 at u = 0, rate 4 at u = 0.5 and rate 1 at u = 1 on a clip with 10 s of source in a 30 fps project
- **THEN** the element lasts 128 frames (4.267 s), within ±1 frame

#### Scenario: Too many points
- **WHEN** a command writes a curve with 33 points
- **THEN** the command fails validation and the element's curve is unchanged

#### Scenario: Invalid stored curve
- **WHEN** a project contains a curve with non-increasing `u` values
- **THEN** the curve is ignored, the clip plays at its stored constant `rate`, and the Curve tab shows "This speed curve was invalid and has been reset"

### Requirement: Speed curve presets
The Curve tab SHALL offer the tiles None, Custom, Montage, Hero, Bullet, Jump Cut, Flash In and Flash Out, each with a thumbnail of its curve shape. Selecting a preset SHALL replace the clip's curve with these points `(u → rate)`, defined for this project; the last column is the resulting duration of a clip showing 10 s of source in a 30 fps project, computed by `Retime time map`:

| Preset | Points | Duration of a 10 s source |
|---|---|---|
| Montage | 0 → 0.9; 0.25 → 0.9; 0.40 → 6.0; 0.60 → 6.0; 0.75 → 0.4; 1 → 0.4 | 328 frames (10.933 s) |
| Hero | 0 → 1.0; 0.20 → 5.0; 0.40 → 0.5; 0.60 → 0.5; 0.80 → 5.0; 1 → 1.0 | 239 frames (7.967 s) |
| Bullet | 0 → 5.5; 0.30 → 5.5; 0.45 → 0.5; 0.55 → 0.5; 0.70 → 5.5; 1 → 5.5 | 146 frames (4.867 s) |
| Jump Cut | 0 → 0.6; 0.30 → 0.6; 0.45 → 5.5; 0.55 → 5.5; 0.70 → 0.6; 1 → 0.6 | 354 frames (11.800 s) |
| Flash In | 0 → 5.5; 0.40 → 5.5; 0.60 → 1.0; 1 → 1.0 | 167 frames (5.567 s) |
| Flash Out | 0 → 1.0; 0.40 → 1.0; 0.60 → 5.5; 1 → 5.5 | 167 frames (5.567 s) |

"None" SHALL remove the curve and restore constant speed at 1×. "Custom" SHALL start from five points at `u` = 0, 0.25, 0.5, 0.75, 1, all at rate 1, or keep the existing custom points when the clip already has them. Selecting a preset and then moving any point SHALL change `preset` to `"custom"` while keeping the points. Selecting a tile SHALL be one undo step and SHALL play the clip once in the preview. A preset whose resulting duration does not fit (see `Duration linked to speed`) SHALL be refused with that requirement's toast. [CAPCUT CC-075, CC-076, CC-077, CC-078, CC-079, CC-080] [NEW]

#### Scenario: Apply Hero
- **WHEN** the user selects Hero on a clip
- **THEN** the clip's curve has the six Hero points, `preset` is `"hero"`, the clip's duration is recomputed and its badge reads "Hero"

#### Scenario: Preset durations
- **WHEN** each of the six presets is applied to a clip showing 10 s of source in a 30 fps project
- **THEN** the element durations are 328, 239, 146, 354, 167 and 167 frames for Montage, Hero, Bullet, Jump Cut, Flash In and Flash Out respectively, each within ±1 frame

#### Scenario: Editing a preset makes it custom
- **WHEN** the user drags one Hero point
- **THEN** `preset` becomes `"custom"`, the Custom tile is highlighted and the other five points are unchanged

#### Scenario: None
- **WHEN** the user selects None on a curved clip
- **THEN** the curve is removed, the rate is 1× and the duration equals the source span

### Requirement: Custom speed curve editor
Selecting Custom, or a second tap/click on a selected preset tile, SHALL open the curve editor: a graph with `u` on the horizontal axis and rate on a logarithmic vertical axis from 0.1× to 10× with a dashed line at 1×, the clip's filmstrip behind it, and a playhead marker linked to the timeline playhead. Points SHALL be draggable vertically (0.1–10, shown in a tooltip to one decimal) and horizontally between their neighbours with a minimum gap of 0.02; end points SHALL move vertically only. Rate SHALL snap to 1.0× within ±0.05 unless Shift is held. "Add point" (the "+" button, or double-click on the curve) SHALL insert a point at the playhead position on the curve with the curve's current rate there, and SHALL be disabled when 32 points exist or when the position is within 0.02 of an existing point; "Delete point" (the "−" button, or Delete with a point selected) SHALL remove the selected interior point and SHALL be disabled for end points and when only 2 points remain. "Reset" SHALL restore the selected preset's points (or five points at 1× for Custom). The editor SHALL show the original source span and the resulting duration ("10.0s → 6.4s"), updating live while dragging. A drag SHALL preview live and commit one undo step on release. On mobile the editor SHALL be a bottom sheet with 32 px touch targets on points and the ✓ button to confirm. Point selection SHALL be keyboard accessible: Tab cycles points, arrow keys move by 0.01 in `u` or 0.1 in rate. [CAPCUT CC-081]

#### Scenario: Drag a point up
- **WHEN** the user drags an interior point from 1.0× to 3.0×
- **THEN** the tooltip shows "3.0x", the resulting duration shown becomes shorter, and one undo step is recorded on release

#### Scenario: Add at the playhead
- **WHEN** the playhead is at 40% of the clip's source span and the user presses "+"
- **THEN** a point is inserted at `u = 0.40` with the curve's rate at that position and the curve shape is unchanged

#### Scenario: Cannot delete an end point
- **WHEN** the first point is selected
- **THEN** the "−" button is disabled

#### Scenario: Rate limit per point
- **WHEN** the user drags a point above the top of the graph
- **THEN** its rate stops at 10.0×

### Requirement: Reverse
The user SHALL be able to reverse a video, compound or audio element with the "Reverse" action (action id `timeline.reverse`; Speed panel and context menu on desktop/web; mobile entry: the "Reverse" item of `mobile-editor.Video clip tool strip` for video and compound clips and of `mobile-editor.Audio group and audio clip strips` for audio clips). It SHALL toggle `retime.reverse`: the element keeps its start time, duration and visible source span, and the mapping follows `Retime time map` (the last visible source frame is shown first). The clip's audio SHALL be reversed together with the picture. A speed curve's points SHALL NOT be changed by the toggle: `u` is a position in the source span, and `Retime time map` reads a reversed element from the end of its source span (`τ = D − clipTime`), so every source frame is shown for exactly as long as before and only the order of the frames is reversed (a fast-then-normal clip becomes normal-then-fast in playback). The earlier rule that mirrored the curve in `u` is withdrawn, because it changed how long each source frame is shown and moved keyframes off their source frames. Keyframes, captions and beat-synchronised data follow `Effect of retime on keyframes and animations` and `Effect of retime on captions`, which keep each on its source frame. Reversed video SHALL play in preview through a reverse frame cache built per group of pictures; while the cache for the visible range is being built the clip SHALL show a progress label "Reversing {n}%" and the preview SHALL show the nearest available frame; the build SHALL resume after app restart without restarting from zero. The cache is a derived asset: its progress and completion are not history entries. The label's "Cancel" SHALL execute an ordinary command that sets `retime.reverse` back to false (so history then holds "Reverse" followed by "Reverse off") and stops the build. Export SHALL decode in reverse without requiring the preview cache. Each toggle SHALL be one undo step. `timeline-editing` lists the entry points only. [PORT N-014] [CAPCUT CC-039] [NEW]

#### Scenario: First frame after reversing
- **WHEN** a clip showing source 2 s–6 s is reversed
- **THEN** local time 0 shows the source frame at 6 s minus one frame and the last frame shows source 2 s

#### Scenario: Audio is reversed
- **WHEN** the clip has audio
- **THEN** the audio sample order is reversed across the same span

#### Scenario: Reverse twice
- **WHEN** the user reverses the clip again
- **THEN** `reverse` is false and playback is identical to the original

#### Scenario: Cancel the cache build
- **WHEN** the user cancels during "Reversing 40%"
- **THEN** the clip returns to forward playback, the history holds two entries (Reverse, Reverse off), and pressing undo once reverses the clip again

#### Scenario: Audio element
- **WHEN** an audio element is selected
- **THEN** the Reverse action is enabled and reversing it mirrors its waveform

#### Scenario: Reversing a clip with an asymmetric curve
- **WHEN** a clip with the Flash In preset (fast, then normal) is reversed
- **THEN** its curve points and duration are unchanged, playback shows the last source frame first at normal speed and ends fast, and each source frame is on screen for as many output frames as before the reverse (±1 frame)

### Requirement: Freeze frame
This requirement is the single definition of freeze frame; `timeline-editing.Timeline toolbar` and the context menus only list the entry point (action id `timeline.freeze`; mobile entry: the "Freeze" item of `mobile-editor.Video clip tool strip`; agent tool `jc_clip_freeze`). The target SHALL be the single selected video or compound element when the playhead is inside it, or, with no selection, the main-track video or compound element under the playhead. "Freeze frame" SHALL split the target at the playhead frame and insert between the two parts a freeze element showing the source frame under the playhead, with the default freeze duration (3 s, frame-aligned; the one default, exposed as the "Default freeze-frame duration" preference of `settings-preferences.Editing default preferences`, range 0.1–60 s), no audio, and a copy of the clip's transform, crop, flip, adjustments, effects, masks, chroma key, cutout, opacity and blend mode evaluated as static values at the playhead (keyframes are not copied). The second part and all following elements on the same track SHALL shift right by the freeze duration in the same undo step, on every track type and regardless of the ripple setting (there is no refusal path); linked audio shifts with its video per `timeline-editing.Video and audio linking`. Data shape (`project-document.Freeze field`): for a video source the freeze element is `type: "video"` with `freeze: {mediaId, sourceTime}`; for a compound source it is `type: "compound"` referencing the same scene with `freeze: {sourceTime}` (`mediaId` absent). A freeze element renders from the original media or scene (no exported image file), has no audio, is not retimable, is trimmable at both ends from 1 frame to 6 hours without source limits, is eligible for transitions (`transitions.Eligible cuts`), and takes masks, adjustments, effects and clip animations like its source type. When the playhead is on the clip's first frame, no left part is created; on its last frame, no right part. The button SHALL be disabled, with the tooltip "Move the playhead onto a video clip", when no target exists. The whole action SHALL be one undo step. [PORT N-014] [CAPCUT CC-040] [NEW]

#### Scenario: Freeze in the middle
- **WHEN** a 10 s clip is frozen at local 4 s on the main track
- **THEN** the track has a 4 s part, a 3 s freeze element showing the frame at local 4 s, and a 6 s part, and the scene is 3 s longer

#### Scenario: Freeze data shape
- **WHEN** the frozen clip references media `m1` and the playhead was at source time 14 s
- **THEN** the inserted element has `type: "video"` and `freeze: {mediaId: "m1", sourceTime: 1 680 000}`

#### Scenario: Overlay track with ripple off
- **WHEN** a clip on an overlay track is frozen while ripple editing is off and another clip starts 1 s after it on that track
- **THEN** that following clip also shifts right by 3 s and no element overlaps

#### Scenario: No selection uses the main track
- **WHEN** nothing is selected and the playhead is inside a main-track video clip
- **THEN** "Freeze frame" is enabled and freezes that clip

#### Scenario: Freeze has no audio
- **WHEN** the freeze element plays
- **THEN** no audio from the clip is heard during its 3 s

#### Scenario: Disabled state
- **WHEN** an audio element is selected, or the playhead is over a gap with no selection
- **THEN** the Freeze frame button is disabled with the stated tooltip

#### Scenario: Trim limits
- **WHEN** the user drags the freeze element's end outward by 10 minutes
- **THEN** it lasts 10 min 3 s, and dragging it inward stops at 1 frame

#### Scenario: Undo
- **WHEN** the user presses undo once
- **THEN** the original 10 s clip is restored with its original id and following elements return to their positions

### Requirement: Smooth slow motion
For video elements whose effective rate is below 1× at any point, the Speed panel SHALL offer "Smooth slow-mo" with the options Off (`"none"`: nearest source frame is repeated), Frame blending (`"blend"`: each output frame is a linear mix of the two neighbouring source frames weighted by the fractional source position) and Optical flow (`"flow"`: intermediate frames are synthesised by motion-compensated interpolation computed on-device on the GPU with no model). Frame blending SHALL render in real time in preview.

**Optical-flow algorithm (normative).** For two consecutive source frames `F0`, `F1` and a fractional position `α ∈ (0, 1)`: (1) both frames are converted to luma and reduced to one quarter of the source resolution per axis (never below 160 px on the long side); (2) a 4-level Gaussian pyramid is built (each level half the previous); (3) dense flow is estimated coarse-to-fine by block matching on 8×8-pixel blocks with a search range of ±4 pixels per level (sum of absolute differences, half-pixel refinement by parabola fit, each level starting from the upsampled flow of the coarser level), followed by a 3×3 median filter of the flow field per level; (4) the estimate is run in both directions (`F0→F1` and `F1→F0`); (5) forward–backward consistency: a pixel whose two flows disagree by more than 2 px at source resolution is marked unreliable; (6) the output frame is `(1 − α) × warp(F0, α × flow01) + α × warp(F1, (1 − α) × flow10)` at full resolution with bilinear sampling, and unreliable pixels use the plain blend `(1 − α) F0 + α F1` instead (occlusion fallback), with the reliability mask blurred by a 5-px box so the switch is not visible as an edge; (7) scene cut: when the mean absolute luma difference between `F0` and `F1` at the quarter resolution exceeds 0.25, no frame is synthesised across that pair and the nearer source frame is used. The shaders are `optical-flow-estimate` and `optical-flow-warp` of `render-engine.Shader registry and extended shader set`. The result is deterministic for the same inputs on the same backend.

**Budget and cache.** Synthesising one 1920×1080 frame SHALL take at most 40 ms on the reference desktop and at most 250 ms on the reference phones (iOS and Android alike) that pass the capability check. Optical-flow frames SHALL be computed in the background and cached per clip as derived assets in the cache store of `project-storage.Cache management` (encoded as an intra-only video per clip, keyed by source content hash, source range, the retime and the output frame rate; under that requirement's single budget), their completion is not a history entry, the user's choice of `"flow"` is the only undo step, and a result for an element that no longer exists is discarded. Until a frame is cached, preview SHALL fall back to frame blending and the clip SHALL show "Smoothing {n}%". Export SHALL compute the optical-flow frames of clips set to `"flow"` as part of the export, at the budgeted speed, counted in the export's progress and estimate as the step "Smoothing motion"; it never waits for the preview cache and it can be cancelled like the rest of the export.

**Capability check.** The check passes when all of the following hold: the engine backend is `webgpu`, `maxTextureSize ≥ 4096`, and a probe that synthesises one 1280×720 frame from two bundled test frames at engine start completes in 60 ms or less on desktop and web and 200 ms or less on mobile. When the backend is `webgl2`, or the check fails, the Optical flow option SHALL be disabled with the tooltip "Optical flow is not available on this device", clips already set to `"flow"` SHALL render with frame blending and show a warning badge, and where a host with `remote-export` is paired the tooltip adds "Export on the host to get optical flow" (the render host runs the same shaders). With `backend: "none"` nothing renders (`render-engine.Behaviour without a GPU backend`) and the setting stays editable. For clips at 1× or faster the control SHALL be disabled with "Available when the clip is slowed down".

**Quality bar.** On each of the fixtures `fixtures/retime/pan-24fps` (camera pan), `fixtures/retime/object-motion-30fps` (an object crossing a static background) and `fixtures/retime/occlusion-30fps` (an object passing behind another), slowed to 0.5×, the mean SSIM of the synthesised frames against the fixture's ground-truth double-rate frames SHALL be at least 0.92 and at least 0.03 above the mean SSIM of frame blending on the same fixture; on `fixtures/retime/scene-cut-30fps` no synthesised frame mixes the two shots. [CAPCUT CC-083, CC-084] [NEW]

#### Scenario: Frame blending at 0.5×
- **WHEN** a 30 fps clip plays at 0.5× in a 30 fps project with Frame blending
- **THEN** every second output frame is the 50/50 mix of two consecutive source frames and the others equal a source frame

#### Scenario: Off repeats frames
- **WHEN** the same clip uses Off
- **THEN** each source frame appears on two consecutive output frames

#### Scenario: Optical flow not yet cached
- **WHEN** Optical flow is selected and 20% of the range is cached
- **THEN** uncached frames in preview are frame-blended and the clip shows "Smoothing 20%"

#### Scenario: WebGL2 backend
- **WHEN** the engine runs on the `webgl2` backend and a project contains a clip set to `"flow"`
- **THEN** the clip renders with frame blending and shows the warning badge, the Optical flow option is disabled with the stated tooltip, and the stored value stays `"flow"`

#### Scenario: Optical-flow quality
- **WHEN** the three motion fixtures are rendered at 0.5× with Optical flow on a device that passes the capability check
- **THEN** on each fixture the mean SSIM of the synthesised frames is at least 0.92 and exceeds that of frame blending by at least 0.03

#### Scenario: Scene cut inside a clip
- **WHEN** the `scene-cut-30fps` fixture is rendered at 0.5× with Optical flow
- **THEN** the frame between the last frame of the first shot and the first frame of the second shot equals one of those two source frames

#### Scenario: Time budget
- **WHEN** 100 frames of a 1920×1080 clip are synthesised on the reference desktop
- **THEN** the mean time per synthesised frame is 40 ms or less

#### Scenario: Export does not wait for the preview cache
- **WHEN** a clip set to Optical flow is 20% cached and the user exports
- **THEN** the export starts at once, shows the step "Smoothing motion" with progress, and every slowed frame of that clip in the output is an optical-flow frame

#### Scenario: Fast clip
- **WHEN** the clip's rate is 2×
- **THEN** the Smooth slow-mo control is disabled with the stated tooltip

### Requirement: Frame-rate matching at export
When a video element's source frame rate is lower than the export frame rate and the element's `smooth` is `"none"`, the export option "Smooth motion" (placement and default owned by `export-share.Frame rate options`) SHALL, when enabled, render that element with optical-flow interpolation as if `smooth` were `"flow"` for that export only, without changing the project. This capability provides the interpolation and its capability check (`Smooth slow motion`); the synthesis runs inside the export as the step "Smoothing motion" at the budget of `Smooth slow motion`, and the export's time estimate includes it; where the check fails on the exporting device or render host, the option SHALL be disabled with "Optical flow is not available on this device". [CAPCUT CC-085] [NEW]

#### Scenario: 24 fps source to 60 fps export
- **WHEN** a 24 fps clip at 1× is exported at 60 fps with "Smooth motion" on
- **THEN** output frames between source frames are synthesised, and the project's `retime` data is unchanged after export

#### Scenario: Check fails
- **WHEN** the exporting device runs the `webgl2` backend
- **THEN** "Smooth motion" is disabled with the stated message and the export repeats source frames

### Requirement: Velocity effects from beats
The Speed panel SHALL offer a "Velocity" tab that generates a speed curve from beat markers. Controls: Music source (any audio element or video-with-audio element overlapping the clip that has beat markers per `audio-editing.Beat markers on audio`; default: the longest overlapping one), Beat step (every 1, 2 or 4 beats; default 2), Pattern (Slow–fast, Fast–slow, Pulse; default Slow–fast) and Intensity `I` 0–100 (default 60), which sets the fast rate `1 + 5 × I / 100` (1×…6×) and the slow rate `1 − 0.7 × I / 100` (1×…0.3×). A "section" is the span between two consecutive chosen beats (every Beat-step-th marker). Slow–fast alternates slow, fast, slow, … starting with slow; Fast–slow alternates starting with fast; Pulse repeats the group slow, fast, fast, fast. Applying SHALL build a `"custom"` curve whose points hold each section's rate and change rate at the section boundaries (two points 0.02 apart in `u` around each boundary) so that the midpoint of each ramp (the instant halfway, in timeline time, between the ramp's two points) lies within 1 frame of its chosen beat. The curve is limited to 32 points, which allows 15 boundaries; when more beats fall on the clip the latest boundaries are dropped (the last section keeps its rate to the end of the clip) and a toast SHALL read "Speed changes applied to the first {n} beats (limit reached)". Applying SHALL be one undo step. The result SHALL be editable in the curve editor. With no beat-marked audio overlapping the clip, the tab SHALL show "Add music and mark its beats first" with a button that opens the beat tool. On mobile the "Velocity effects" item of the Speed strip SHALL open a sheet with the same four controls, an Apply button and the ✓ / ✕ header. [CAPCUT CC-082] [NEW]

#### Scenario: Speed changes land on beats
- **WHEN** beats occur every 0.5 s under the clip and the user applies Slow–fast with Beat step 2
- **THEN** in the resulting timeline the midpoint of every ramp between a slow and a fast section lies within 1 frame of every second beat

#### Scenario: More beats than the curve can hold
- **WHEN** 40 chosen beats fall on the clip
- **THEN** the curve has 32 points, speed changes exist at the first 15 chosen beats, and the toast reads "Speed changes applied to the first 15 beats (limit reached)"

#### Scenario: Intensity mapping
- **WHEN** Intensity is 60
- **THEN** the fast sections have rate 4.0 and the slow sections have rate 0.58

#### Scenario: Pulse pattern
- **WHEN** the Pulse pattern is applied over eight sections
- **THEN** the section rates are slow, fast, fast, fast, slow, fast, fast, fast

#### Scenario: No beats available
- **WHEN** no overlapping audio has beat markers
- **THEN** the empty state and its button are shown and Apply is disabled

### Requirement: Audio clip speed
Audio elements SHALL support constant speed, speed curves, reverse and Keep pitch exactly as video elements do, through the same panel. A separate pitch-shift control independent of speed is defined in `audio-editing.Audio pitch shift`. Changing a video element's speed SHALL apply to its embedded source audio; when its audio has been extracted to a linked audio element (`linkId` semantics owned by `timeline-editing.Video and audio linking`), a speed change on either linked element SHALL be applied to both in the same undo step so they stay in sync, unless they have been unlinked or only one member is selected with the single-member selection of that requirement. [PORT SP-001] [CAPCUT CC-086] [NEW]

#### Scenario: Linked audio follows
- **WHEN** a video with a linked extracted audio element is set to 2×
- **THEN** both elements have rate 2 and the same duration, in one undo step

#### Scenario: Unlinked audio does not follow
- **WHEN** the pair has been unlinked and the video is set to 2×
- **THEN** only the video changes

### Requirement: Effect of retime on keyframes and animations
Keyframe times are element-local timeline times. When a retime change alters an element's duration, each keyframe time SHALL be remapped so that it stays on the same source frame: the keyframe's source position is computed with `sourceTimeAt` of the old retime and converted back with `clipTimeAt` of the new one (`Retime time map`), then snapped to a frame and clamped to `[0, duration]`; keys that collide after snapping keep the last one in original time order. Toggling reverse uses this same source-frame remap; because the curve is not changed by the toggle (`Reverse`) and a reversed element is read from the end of its source span, the remap equals `t → duration − t` for every curve, and because the order of the keys in time is then inverted, each segment's type and bezier SHALL be re-attached to the key that now starts that segment, with the segment's two handles swapped and their `dt` signs inverted (for a path key: `easing [x1, y1, x2, y2]` becomes `[1 − x2, 1 − y2, 1 − x1, 1 − y1]`), so the animation plays backwards exactly. Beat markers are stored in source time and need no remap. Clip animations (`clipAnimation` in, out, combo) SHALL keep their durations in timeline seconds, clamped by the new element duration. Audio fade durations SHALL keep their timeline length, clamped by the new duration. Mask, effect and adjustment keyframes follow the same remapping. All of this SHALL be part of the retime command's single undo step. [PORT SP-004] [NEW]

#### Scenario: Constant speed-up
- **WHEN** a clip at 1× has an opacity key at local 4 s and the rate becomes 2×
- **THEN** the key is at local 2 s

#### Scenario: Reverse at constant rate
- **WHEN** a 10 s clip at 1× with an opacity key at 2 s is reversed
- **THEN** the key is at 8 s

#### Scenario: Reverse with a speed curve
- **WHEN** a clip with the Flash In preset has a key at local time t on the output frame that shows source time 3 s, and the clip is reversed
- **THEN** the key is at `duration − t`, and the output frame there shows source time 3 s (within 1 frame)

#### Scenario: Segment easing follows the reversal
- **WHEN** keys K1 (2 s, bezier ease-in to K2) and K2 (4 s) on a 10 s constant-rate clip are reversed
- **THEN** K2 is at 6 s and starts a bezier segment to K1 at 8 s whose shape is the mirror image (ease-out), and the rendered values play backwards

#### Scenario: Clip animation keeps its length
- **WHEN** a clip with a 0.5 s In animation goes from 10 s to 5 s
- **THEN** the In animation still lasts 0.5 s

### Requirement: Effect of retime on captions
Caption elements that are linked to a source element by `captions-subtitles.Auto captions on device` (captions generated from that clip's audio) SHALL be remapped when that element's retime changes: each caption's start and end are converted to source time with the old map and back with the new map, snapped to frames, with a minimum caption duration of 1 frame; toggling reverse uses the same source-time remap (with the start and end of each caption exchanged), so each caption stays on the words it transcribes whatever the speed curve. Captions without such a link SHALL NOT move. The remap SHALL be part of the same undo step, and a toast SHALL report "{n} captions retimed". When captions are on a locked track they SHALL be left in place and the toast SHALL read "{n} captions not retimed (track locked)". [NEW]

#### Scenario: Captions follow a speed-up
- **WHEN** a clip starting at 0 s with a linked caption at 4 s–6 s is set to 2×
- **THEN** the caption spans 2 s–3 s

#### Scenario: Unlinked captions stay
- **WHEN** captions were imported from a file and are not linked to the clip
- **THEN** their times do not change

### Requirement: Trim and split of retimed clips
Trim handles on a retimed element SHALL move in timeline time and convert to source time with `sourceTimeAt` of `Retime time map`, so the limit of a trim is the source media's boundary. Trimming an element with a speed curve SHALL keep the speed at every remaining source position: the curve SHALL be cropped to the new source span and its `u` values renormalised, inserting boundary points with the interpolated rate and thinning to 32 points when necessary. Splitting SHALL produce two elements whose curves are the two crops of the original, so that playback across the split is identical to the unsplit clip within 1 frame; for constant rate both parts keep the rate; `reverse`, `maintainPitch` and `smooth` SHALL be copied to both parts. Waveforms and filmstrips SHALL be drawn through the time map. [PORT SP-004] [NEW]

#### Scenario: Split a curved clip
- **WHEN** a clip with the Bullet preset is split at its midpoint
- **THEN** the left part's curve covers the first half of the original source span and the right part's covers the second half, both with `preset: "custom"`, and the frames at every timeline time match the unsplit clip within 1 frame

#### Scenario: Trim limit at 2×
- **WHEN** a clip at 2× has 4 s of unused source after its out-point and the user drags its end handle outward
- **THEN** the handle stops after 2 s of timeline extension

#### Scenario: Waveform follows the curve
- **WHEN** a clip has a curve that is fast at the start and slow at the end
- **THEN** the waveform is compressed at the start and stretched at the end

### Requirement: Speed panel structure
On desktop/web the inspector of a retimable element SHALL have the "Speed" tab named in `preview-canvas.Inspector structure per element type` with the sub-tabs Normal (speed slider and field, the editable Duration field of `Duration linked to speed`, Keep pitch, Reverse, Smooth slow-mo), Curve (preset tiles and curve editor) and Velocity. Mobile entry (iOS and Android): the "Speed" item of `mobile-editor.Video clip tool strip` and of the audio clip strip in `mobile-editor.Audio group and audio clip strips`; this capability defines what it opens — a second-level strip Normal · Curve · Velocity effects; Normal opens a sheet with the slider (stops 0.1×, 1×, 2×, 5×, 10×, 100×), the editable Duration field, Keep pitch and Smooth slow-mo; Curve opens a sheet with the tiles None · Custom · Montage · Hero · Bullet · Jump Cut · Flash In · Flash Out; Velocity effects opens the sheet of `Velocity effects from beats`. Every sheet keeps the preview and a compact timeline visible and follows the ✓ / ✕ rules of `mobile-editor.Tool sheets never cover the preview`. Choosing a curve while a constant rate other than 1× is set SHALL replace the constant rate, and setting a constant rate while a curve is set SHALL remove the curve after the confirm "Replace the speed curve with a constant speed?". With several retimable elements selected, Normal-tab edits SHALL apply to all of them in one undo step and Curve and Velocity SHALL be disabled with "Select a single clip". The registry actions are `speed.panel.show`, which opens the panel on its Normal tab for the selection, and `speed.curve.show`, which opens it on its Curve tab (`keyboard-shortcuts.Action registry`). [PORT SP-001] [CAPCUT CC-073, CC-081]

#### Scenario: Mobile curve strip
- **WHEN** the user taps Speed then Curve on a selected clip
- **THEN** the eight tiles are shown in a sheet with the preview still visible

#### Scenario: Constant speed replaces a curve
- **WHEN** a clip has the Montage curve and the user sets Normal speed to 2×
- **THEN** a confirm is shown, and on confirming the curve is removed and the rate is 2×

#### Scenario: Multi-selection
- **WHEN** three clips are selected and the user sets 1.5×
- **THEN** all three have rate 1.5 after one undo step, and the Curve tab is disabled

#### Scenario: Mobile duration field
- **WHEN** the user types 4 s into the Duration field of the mobile Normal sheet for a clip showing 10 s of source and taps ✓
- **THEN** the rate is 2.5× and the clip lasts 4 s, as one undo step

### Requirement: Speed badges on clips
A retimed element SHALL show badges in its header, left to right: a speed badge with the constant rate to one decimal and "x" (for example "2.0x"; two decimals below 1×, for example "0.25x"), or the curve preset's localised name ("Hero", or "Curve" for custom); a reverse icon when reversed; a smoothing icon when `smooth` is not `"none"`. A freeze element SHALL show a snowflake icon and "Freeze". Badges SHALL be hidden when the clip is narrower than 48 px, and no speed badge SHALL be shown at 1× with no curve. On mobile the same badges SHALL be drawn on the clip in the main track and on overlay bars. [CAPCUT CC-073, CC-075, CC-076] [NEW]

#### Scenario: Constant speed badge
- **WHEN** a clip's rate is 5
- **THEN** its badge reads "5.0x"

#### Scenario: Curve badge
- **WHEN** a clip uses the Hero preset
- **THEN** its badge reads "Hero"

#### Scenario: Normal speed
- **WHEN** a clip is at 1× with no curve and not reversed
- **THEN** no badge is shown

### Requirement: Retimed playback and export behaviour
Preview playback of a retimed video SHALL show, for each output frame, the source frame selected by `Retime time map` (unless smoothing applies); at rates above 1× intermediate source frames are skipped, not blended. Audio SHALL be rendered through the same time map at every rate from 0.1× to 100×. Export SHALL produce the same frames and the same audio as preview for every retime setting. Retime changes SHALL invalidate only the affected element's cached frames, waveform columns and prepared audio. All retime mutations SHALL be undoable commands saved with the project and exposed to agents through `jc_speed_set` and `jc_clip_freeze` (`agent-editing-tools.Tool naming and families`). [PORT SP-004] [NEW]

#### Scenario: Preview equals export
- **WHEN** a clip with the Montage curve is exported
- **THEN** each exported frame shows the same source frame index as the preview at that timeline frame

#### Scenario: High rate
- **WHEN** a clip showing 100 s of source plays at 100× in a 30 fps project
- **THEN** each output frame shows the source frame 100 frame-intervals after the previous one, and the clip's output audio lasts 1 s ± 1 ms (source span / 100)

#### Scenario: Agent tool uses the model's field names
- **WHEN** `jc_speed_set` is called with `{rate: 2, maintainPitch: true, smooth: "blend"}`
- **THEN** the element stores `retime: {rate: 2, maintainPitch: true, reverse: false, smooth: "blend"}`
