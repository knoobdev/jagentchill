## ADDED Requirements

### Requirement: GPU-composited preview surface
The editor SHALL show the composited frame of the active scene on a preview canvas owned by the engine surface of `render-engine.Same-thread surface on web and desktop` (web and desktop: mounted directly in the app document) or of `mobile-editor.Engine view native module` (mobile). The canvas SHALL be sized to the scene rectangle (project canvas width × height scaled by the current view scale) and SHALL be the only element that draws clip pixels; selection handles, guides and overlays SHALL be drawn by the app above it. The canvas background behind the clips (colour, gradient, blur or image, per clip or project default) SHALL be drawn by the compositor inside the canvas as resolved by `render-engine.Background nodes`; the app SHALL draw the viewport outside the canvas rectangle with the editor surface token of `design-system.Editor colour tokens` and SHALL draw nothing behind the canvas itself. [PORT V-001] [CAPCUT CC-282]

#### Scenario: Canvas matches project size
- **WHEN** a project with canvas 1080×1920 is opened in a preview viewport of 600×800 px at zoom "Fit"
- **THEN** the canvas is displayed at 450×800 px, centred horizontally
- **AND** the frame at the playhead is visible within 500 ms of the scene becoming ready

#### Scenario: Per-clip blur background
- **WHEN** the main-track clip at the playhead has a `blur` background and the previous clip has a colour background
- **THEN** the canvas shows the blurred background at the playhead and the colour background when the playhead is moved onto the previous clip, both drawn inside the canvas

### Requirement: Render only on frame or scene change
The preview SHALL request a new frame only when the playhead frame index changes or the scene tree changes (tracks, media assets, background, canvas size, or any preview-layer edit). The render time SHALL be `min(currentTime, lastFrameTime)` where `lastFrameTime` is the start of the final frame of the scene. A new render request SHALL NOT start while a previous one is pending; the most recent pending request SHALL be rendered when the previous one finishes, and intermediate requests SHALL be dropped. [PORT V-002]

#### Scenario: Idle preview does no work
- **WHEN** playback is paused and no edit occurs for 5 s
- **THEN** zero frames are rendered during those 5 s

#### Scenario: Playhead at the exact end
- **WHEN** the playhead is at the scene duration of a 30 fps scene that is 10 s long
- **THEN** the frame rendered is the frame starting at 9.9667 s (frame index 299)

#### Scenario: Requests coalesce
- **WHEN** 10 scene changes arrive while one render is pending
- **THEN** exactly one further render is performed, using the state after the tenth change

### Requirement: Degraded graphics notice
When the engine reports backend `webgl2` (WebGPU unavailable, `render-engine.GPU backend selection and WebGL2 fallback`) the editor SHALL show a dismissible banner above the editor with the text "Preview is running in compatibility mode. Some effects render more slowly." — or, when `engine.ready` reports `software: true` (the preference "Allow software rendering" is on and no hardware-accelerated context exists), the text "Preview is rendered without a GPU and will be slow." — and a "Learn more" link that opens the engine section of `diagnostics-quality.Connection diagnostics screen`. Dismissal SHALL be persisted per device and SHALL be reset when the detected graphics backend changes. This requirement is the only definition of the banner; the shell references it. States in which nothing renders are defined by `preview-canvas.Engine states`. [PORT V-024] [NEW]

#### Scenario: WebGL2 fallback
- **WHEN** the editor opens on a device without WebGPU but with WebGL2
- **THEN** the preview renders frames and the compatibility banner is shown with the "Learn more" link
- **AND** after the user dismisses it and reloads the editor, the banner is not shown

#### Scenario: Software rendering
- **WHEN** "Allow software rendering" is on and the engine reports `backend: "webgl2"` with `software: true`
- **THEN** the banner reads "Preview is rendered without a GPU and will be slow."

#### Scenario: Backend change resets dismissal
- **WHEN** the banner was dismissed on WebGL2, the device then runs with WebGPU, and afterwards again with WebGL2
- **THEN** the banner is shown again

### Requirement: Engine states
The preview area SHALL present exactly one of these engine states in place of, or over, the canvas, and timeline, inspector and project editing SHALL remain usable in all of them:

| State | Entered when | Presentation | Actions |
|---|---|---|---|
| recovering | the engine reports device loss or is being re-initialised (`render-engine.GPU device-lost recovery`) | the last rendered frame is held; a spinner is overlaid after 500 ms | none |
| no GPU | `engine.ready` reports `backend: "none"` (`render-engine.Behaviour without a GPU backend`) | blocking notice "This device cannot render the preview." | "Try again" (disposes the surface and runs `engine.init` again), "Open diagnostics", on the desktop app (macOS, Windows and Linux) "Export on this computer's host" while the built-in host's render host is healthy (it renders in software when it must), and "Export on host" (`export-share.Gateway export hand-off`) while another host with the `remote-export` feature is connected; after the GPU-disabled relaunch of `desktop-app.Hardware acceleration and media capability flags` the state is this one with the same actions |
| unsupported runtime | initialisation fails with `engine/unsupported-runtime` | blocking notice naming the missing capability, for example "This browser cannot decode video (WebCodecs missing)" | "Open diagnostics" |
| engine stopped | the repeated-panic limit of `render-engine.Wasm panic capture and recovery` is reached on web or desktop | non-dismissable banner "The preview engine stopped" over the last frame | "Reload engine" |

On mobile, process termination and repeated crashes are presented by `mobile-editor.Engine surface lifecycle` instead of "engine stopped". In the states no GPU, unsupported runtime and engine stopped, Save snapshot, Copy snapshot, the timeline preview axis (`timeline-editing.Preview axis`) and colour eyedroppers SHALL be disabled with the tooltip "Preview is unavailable"; parameters SHALL stay editable, and in the no-GPU state the play control stays enabled: playback advances the playhead and plays audio with no picture, and the transport keeps working, as stated by `render-engine.Behaviour without a GPU backend`; in the unsupported-runtime and engine-stopped states the play control is disabled with the same tooltip. Toggling the preference "Force WebGL2 rendering" (`settings-preferences.Performance preferences`) SHALL re-initialise the engine immediately. [NEW]

#### Scenario: Recovering
- **WHEN** the GPU device is lost during editing
- **THEN** the last frame stays visible, a spinner appears after 500 ms, and the canvas resumes rendering when recovery completes without user action

#### Scenario: No GPU backend
- **WHEN** the editor opens on a device with neither WebGPU nor WebGL2
- **THEN** the preview area shows "This device cannot render the preview." with "Try again" and "Open diagnostics"
- **AND** selecting, trimming and saving on the timeline still work, and Save snapshot is disabled with the tooltip "Preview is unavailable"

#### Scenario: No GPU on the desktop app
- **WHEN** the desktop app is in the no-GPU state and its built-in host's render host is healthy
- **THEN** the notice offers "Export on this computer's host" on macOS, Windows and Linux, and choosing it opens the export dialog with that target selected

#### Scenario: Try again succeeds
- **WHEN** the no-GPU state is shown, a GPU becomes available and the user presses "Try again"
- **THEN** the engine initialises and the frame at the playhead is rendered

#### Scenario: Unsupported runtime
- **WHEN** the runtime has no WebCodecs video decoder
- **THEN** the notice names the missing capability and offers "Open diagnostics"

#### Scenario: Engine stopped
- **WHEN** the engine panics three times within 60 s on desktop
- **THEN** the banner with "Reload engine" is shown and pressing it re-initialises the engine and renders the playhead frame

#### Scenario: Force WebGL2
- **WHEN** the user turns on "Force WebGL2 rendering" while the editor is open
- **THEN** the engine re-initialises at once with backend `webgl2`

### Requirement: Play, pause and stop
The player SHALL provide Play/Pause and Stop. Play SHALL be a no-op when the scene duration is 0. Stop SHALL pause playback and seek to time 0. The play control SHALL be a single button in the centre of the player toolbar that shows a pause glyph while playing. Starting playback SHALL commit any in-place text edit and any uncommitted inspector draft. [PORT PB-001, PB-002, V-008]

#### Scenario: Toggle playback
- **WHEN** the user presses the play button on a 20 s scene with the playhead at 4 s
- **THEN** playback starts from 4 s and the button shows the pause glyph
- **AND** pressing it again pauses at the current frame

#### Scenario: Empty scene
- **WHEN** the scene has no elements (duration 0) and the user presses play
- **THEN** playback does not start and the playhead stays at 0

#### Scenario: Stop
- **WHEN** playback is running at 12 s and the user invokes Stop
- **THEN** playback pauses and the playhead is at 0

### Requirement: Seek, jump and frame step
The player SHALL provide: seek backward/forward by 1 s; jump backward/forward by 5 s; step backward/forward by exactly 1 frame of the project frame rate; multi-frame step backward/forward by 10 frames; go to start; go to end. Every resulting time SHALL be clamped to `[0, duration]` and snapped to a frame boundary. These actions SHALL be rebindable actions whose default bindings are stated only in `keyboard-shortcuts.Default bindings for playback and navigation`, and SHALL work while playing (playback continues from the new time). [PORT PB-003, PB-004, PB-005, PB-006] [CAPCUT CC-066]

#### Scenario: Frame step at 30 fps
- **WHEN** the playhead is at frame 100 of a 30 fps project and the user steps forward one frame
- **THEN** the playhead is at frame 101 (404 000 ticks)

#### Scenario: Clamp at start
- **WHEN** the playhead is at 2 s and the user jumps backward 5 s
- **THEN** the playhead is at 0

#### Scenario: Multi-frame step
- **WHEN** the playhead is at frame 5 and the user performs a multi-frame step backward
- **THEN** the playhead is at frame 0

### Requirement: End-of-timeline behaviour
With loop off, when playback reaches the scene duration the player SHALL pause with the playhead at exactly the scene duration; the transport position and the `transport.ended` event are owned by `render-engine.Audio clock as playback master`, and the frame shown is the one at `min(position, lastFrameTime)`. Pressing play when the playhead is at or past the duration SHALL restart from 0. When an edit shortens the scene so that the playhead exceeds the new duration, the playhead SHALL be clamped to the new duration and playback SHALL pause if it was running. [PORT PB-007]

#### Scenario: Auto-pause at end
- **WHEN** playback runs to the end of a 10 s scene at 30 fps with loop off
- **THEN** playback pauses, the timecode shows `00:00:10:00` and the canvas shows frame index 299

#### Scenario: Play from end restarts
- **WHEN** the playhead is at the duration and the user presses play
- **THEN** playback starts from 0

#### Scenario: Scene shortened during playback
- **WHEN** playback is at 9 s and the last clip is deleted so the duration becomes 6 s
- **THEN** the playhead is at 6 s and playback is paused

### Requirement: Loop playback
The player SHALL provide a Loop toggle (default off) in the player toolbar; this requirement is the only definition of the loop setting. With loop on, reaching the end of the loop region SHALL seek to the start of the loop region and continue playing without pausing; the wrap itself (audio rescheduling, a gap of at most one frame duration) is performed by `render-engine.Playback rate, loop and reverse shuttle`. The loop region SHALL be the in/out range of `timeline-editing.In/out range` when one is set, otherwise the whole scene `[0, duration]`. Pressing play with the playhead outside the loop region SHALL start from the region start. The loop state SHALL be persisted in the preview settings per device (it is a monitoring setting, like master volume), is not part of the project and is not undoable. [PORT N-007] [NEW]

#### Scenario: Loop whole scene
- **WHEN** loop is on, no in/out range is set, and playback reaches the end of an 8 s scene
- **THEN** playback continues from 0 without the play button changing state

#### Scenario: Loop a range
- **WHEN** loop is on with in = 2 s and out = 5 s and the playhead is at 3 s when play is pressed
- **THEN** playback runs to 5 s, returns to 2 s and continues

#### Scenario: Playhead outside the range
- **WHEN** loop is on with in = 2 s and out = 5 s and play is pressed with the playhead at 7 s
- **THEN** playback starts from 2 s

#### Scenario: Gap at the wrap
- **WHEN** a 30 fps scene whose audio is a continuous 1 kHz tone is looped and the output is recorded across one wrap
- **THEN** the recorded silence at the wrap lasts no longer than 33.4 ms

#### Scenario: Per device, not per project
- **WHEN** the user turns loop on in project A and opens project B on the same device
- **THEN** loop is on in project B, and opening project A on another device shows loop off

### Requirement: Playback rate and JKL shuttle
The player SHALL provide a playback-rate menu with 0.25×, 0.5×, 1× (default), 1.5×, 2× and 4×, and three shuttle actions, `playback.shuttle-forward`, `playback.shuttle-reverse` and `playback.shuttle-stop`, whose default keys (L, J and K) are stated only in `keyboard-shortcuts.Default bindings for playback and navigation`. This requirement is the only definition of shuttle behaviour: shuttle-forward SHALL play forward at 1× and each further invocation SHALL step the rate through 1×, 2×, 4×, 8× (staying at 8×); shuttle-reverse SHALL play in reverse and each further invocation SHALL step through −1×, −2×, −4×, −8×; invoking the opposite direction SHALL start that direction at 1×; shuttle-stop SHALL pause and reset the shuttle rate to 1×; while the shuttle-stop key is held, shuttle-forward and shuttle-reverse SHALL instead step one frame forward or backward. Reverse shuttle SHALL pause at time 0. Playback rate SHALL be a preview-only setting that never changes the project or the export. Audio SHALL be pitch-preserved for forward rates from 0.5× to 2× inclusive and SHALL be muted for any other rate and for reverse playback, as rendered by `render-engine.Playback rate, loop and reverse shuttle`. The menu rate SHALL reset to 1× when the editor is reopened. On mobile the rate menu SHALL be available from the fullscreen preview overlay (`mobile-editor.Fullscreen preview and orientation`) and the shuttle actions SHALL work with a hardware keyboard. [PORT N-007] [CAPCUT CC-067] [NEW]

#### Scenario: Shuttle forward
- **WHEN** the user invokes shuttle-forward three times while paused
- **THEN** playback runs forward at 4× and audio is muted

#### Scenario: Audible at 2×
- **WHEN** the user invokes shuttle-forward twice while paused
- **THEN** playback runs forward at 2× with pitch-preserved audio

#### Scenario: Reverse shuttle
- **WHEN** the user invokes shuttle-reverse once at 6 s
- **THEN** the playhead moves backward at 1× real time with audio muted and pauses at 0

#### Scenario: Stop resets
- **WHEN** playback is at 8× and the user invokes shuttle-stop then shuttle-forward
- **THEN** playback pauses, then resumes forward at 1× with audio

#### Scenario: Frame step while stop is held
- **WHEN** the shuttle-stop key is held and the user invokes shuttle-forward once at frame 40
- **THEN** the playhead is at frame 41 and playback is paused

#### Scenario: Rate does not affect export
- **WHEN** the rate menu is set to 2× and the project is exported
- **THEN** the exported file has the same duration as the scene

### Requirement: Master volume and mute
The player toolbar SHALL contain a master volume control: a speaker button that toggles mute and a slider from 0 to 100 % in steps of 1 % (default 100 %). Setting the slider to 0 SHALL set the muted state; unmuting SHALL restore the volume in effect before muting (or 100 % when that was 0). Master volume SHALL affect monitoring only and SHALL NOT affect export. Volume and mute SHALL be persisted per device. [PORT PB-008] [NEW]

#### Scenario: Mute and restore
- **WHEN** the volume is 60 % and the user clicks the speaker button twice
- **THEN** the output is silent after the first click and returns to 60 % after the second

#### Scenario: Export unaffected
- **WHEN** master volume is 0 and the project is exported
- **THEN** the exported audio has the levels defined by the project

### Requirement: Audio-clock master playback
During playback the playhead time shown by the player and the timeline SHALL be the transport time reported by the engine, which derives it from the audio output clock as defined by `render-engine.Audio clock as playback master`; the displayed video frame SHALL be the frame for that time. Scheduling interval and lookahead, clip start accuracy, the audio–video offset bound, late-chunk handling and latency compensation are owned by `render-engine.Audio scheduler lookahead` and `render-engine.Audio drift and underrun handling`, and audio while scrubbing by `render-engine.Scrub audio`; this capability states no numbers for them. When no audio output is available the playhead SHALL still advance, from the engine's monotonic clock. The player SHALL NOT keep a second clock of its own. [PORT PB-009, PB-010] [NEW]

#### Scenario: One clock
- **WHEN** a 10-minute 30 fps scene with a clap every 10 s is played from start to end at 1×
- **THEN** at every clap the timecode shown by the player equals the transport time reported by the engine, and the audio–video offset is within the bound of `render-engine.Audio drift and underrun handling`

#### Scenario: No audio device
- **WHEN** playback starts on a device with no audio output
- **THEN** the playhead advances at real time and frames render at the project frame rate

### Requirement: Timecode and duration display
The left side of the player toolbar SHALL show the current time as an editable field in `HH:MM:SS:FF` (FF = frame within the second at the project frame rate) followed by `/` and the read-only total scene duration in the same format; this is the only editable timecode field of the editor (the timeline has none). The field SHALL also accept `SS`, `MM:SS` and `MM:SS:FF`, parsed as defined by `render-engine.Timecode formatting and parsing`. Committing a valid value with Enter or blur SHALL seek to that time clamped to `[0, duration]`. While the typed text is not a valid timecode the field SHALL show the error style; Enter on an invalid value SHALL keep the field in edit mode without seeking; blur or Escape SHALL leave edit mode and restore the previous time. On mobile the time is shown as `MM:SS / MM:SS` in the transport row (`mobile-editor.Transport row`) and is not editable. [PORT PB-011, PB-012, V-008]

#### Scenario: Seek by typing
- **WHEN** the user types `00:00:07:15` in a 30 fps project and presses Enter
- **THEN** the playhead is at 7.5 s

#### Scenario: Out-of-range value
- **WHEN** the user types `00:10:00:00` in a scene that is 20 s long
- **THEN** the playhead is at 20 s and the field shows `00:00:20:00`

#### Scenario: Invalid value and Enter
- **WHEN** the user types `abc` and presses Enter
- **THEN** the playhead does not move, the field shows the error style and stays in edit mode

#### Scenario: Invalid value and Escape
- **WHEN** the user types `abc` and presses Escape
- **THEN** the field leaves edit mode and shows the previous time

### Requirement: Player toolbar layout
On desktop and web the player toolbar SHALL be a single 36 px row under the canvas containing, left to right: timecode field and total duration; (centre) go-to-start, step-back, play/pause, step-forward, go-to-end, loop toggle; (right) the "Reduced preview quality" chip (only while shown, see `preview-canvas.Preview quality`), playback-rate menu, master volume, aspect-ratio control (opens `projects.Canvas size presets and custom size`), guides button, preview-quality menu, zoom select, fullscreen button. Every control SHALL have a tooltip with its name and current shortcut, a visible focus ring, and SHALL be reachable by Tab in the listed order. Controls SHALL use the icon size, row height and radius tokens of `design-system.Control size tokens and density rules`. The mobile arrangement is defined by `mobile-editor.Transport row`. [PORT V-008] [CAPCUT CC-282] [NEW]

#### Scenario: Toolbar order
- **WHEN** the desktop editor is open at a preview width of 720 px or more
- **THEN** all listed controls are visible in the listed order

#### Scenario: Narrow preview
- **WHEN** the preview panel is narrower than 520 px
- **THEN** playback-rate, aspect-ratio and preview-quality controls collapse into a single "More" menu and no control overlaps another

### Requirement: Preview quality
The player SHALL offer a preview-quality menu with Auto (default on every platform), Full, 1/2 and 1/4, mapping to the levels `auto`, `full`, `half` and `quarter` of `render-engine.Preview resolution scaling`, which owns the levels, the automatic lowering and raising rule and the re-render at full resolution when paused. The setting SHALL scale the internal render resolution of the preview only, SHALL NOT change element geometry, hit-testing or export, and SHALL be persisted per device, not in the project document; the Performance tab of `projects.Project settings surface` shows this same control. One chip "Reduced preview quality" SHALL be shown in the player toolbar (above the preview on mobile) whenever the level is Auto and the `effectiveQuality` reported by the engine (`render-engine.Preview resolution scaling`) is below `full`; it is the only indication of an automatic change on every platform, and no toast SHALL be shown for automatic changes. Snapshots SHALL always render at full project resolution. [NEW]

#### Scenario: Lower quality keeps layout
- **WHEN** preview quality is set to 1/4 on a 1920×1080 project and playback is running
- **THEN** the canvas keeps the same on-screen size and the internal render target is 480×270
- **AND** selection handles stay aligned with the elements

#### Scenario: Full frame when paused
- **WHEN** playback at 1/4 is paused
- **THEN** within 150 ms the current frame is re-rendered at full resolution

#### Scenario: Auto shows the chip
- **WHEN** quality is Auto and the engine lowers the level to `half` during playback
- **THEN** the chip "Reduced preview quality" is shown, and it is hidden when the level returns to `full`

#### Scenario: Default
- **WHEN** the editor is opened for the first time on a phone, a desktop and in a browser
- **THEN** the menu shows Auto selected on all three

### Requirement: Preview zoom model
Preview zoom SHALL be expressed relative to fit, where fit scale = `min(viewportWidth / canvasWidth, viewportHeight / canvasHeight)` and zoom 1 = fit. Zoom SHALL be limited to the range 0.25–16 and the zoom-in/zoom-out step SHALL be a factor of 1.25. The zoom select SHALL list Fit, a separator, and the presets 25 %, 50 %, 75 %, 100 %, 150 %, 200 %; presets are absolute percentages of native canvas pixels (zoom = percent / 100 / fitScale) clamped to the range. The label SHALL read "Fit" when |zoom − 1| ≤ 0.001 and `round(displayScale × 100) %` otherwise. Zoom and pan SHALL reset to fit and centred whenever the canvas size changes. [PORT V-003, V-006]

#### Scenario: 100 % preset
- **WHEN** a 1920×1080 canvas is shown in a 960×540 viewport and the user picks 100 %
- **THEN** zoom becomes 2 and one canvas pixel maps to one CSS pixel

#### Scenario: Clamp at maximum
- **WHEN** zoom is 14 and the user zooms in once
- **THEN** zoom becomes 16 and a further zoom-in has no effect

#### Scenario: Fit to screen
- **WHEN** the user chooses "Fit to screen" at zoom 3 with the view panned
- **THEN** zoom is 1, the canvas is centred and the label reads "Fit"

### Requirement: Zoom by wheel, pinch and commands
`Mod` + wheel over the preview SHALL zoom with factor `exp(−delta / 300)`, where delta is capped to ±30 per animation frame and updates are batched per frame. Zoom by wheel and by trackpad pinch SHALL keep the canvas point under the cursor fixed; zoom by command or preset SHALL keep the view centre fixed. The actions Zoom in (`player.zoom-in`), Zoom out (`player.zoom-out`), Fit to screen (`player.zoom-fit`) and Actual size (100 %) (`player.zoom-100`) SHALL be rebindable actions whose defaults are stated in `keyboard-shortcuts.Default bindings for timeline view and player`. On touch devices a two-finger pinch on the preview with no element selected SHALL zoom about the pinch centroid within the same range. [PORT V-004] [NEW]

#### Scenario: Cursor-anchored zoom
- **WHEN** the cursor is over the top-left corner of the canvas and the user zooms in with `Mod` + wheel
- **THEN** the top-left corner of the canvas stays under the cursor

#### Scenario: Wheel burst is capped
- **WHEN** a single animation frame receives wheel deltas summing to −600
- **THEN** the zoom changes by a factor of exp(30/300) ≈ 1.105 for that frame

### Requirement: Preview pan
When zoom is greater than 1 the view SHALL pan by: plain wheel on both axes (line-mode deltas ×16, page-mode deltas × viewport size); middle-mouse drag with a `grabbing` cursor; Space + primary-button drag; two-finger drag on touch devices with no element selected. The pan centre SHALL be clamped so that the canvas always covers the viewport on any axis where it is larger than the viewport, and SHALL be re-centred on any axis where the canvas fits. When zoom is 1 or less, pan input SHALL have no effect. [PORT V-005] [NEW]

#### Scenario: Pan clamps at the canvas edge
- **WHEN** zoom is 2 and the user drags with the middle button far to the right
- **THEN** panning stops when the left canvas edge reaches the left viewport edge

#### Scenario: No pan at fit
- **WHEN** zoom is 1 and the user scrolls the wheel over the preview
- **THEN** the view does not move

### Requirement: Fullscreen preview
The fullscreen control SHALL put the whole preview panel (canvas, overlays and player toolbar) into fullscreen. Escape, the fullscreen shortcut or the button SHALL exit. Menus and popovers opened from the preview SHALL render inside the fullscreen container. In fullscreen the player toolbar SHALL hide after 3 s without pointer movement and reappear on pointer movement or key press. On desktop the native window fullscreen of the Electron shell SHALL NOT be changed. On mobile, fullscreen follows `mobile-editor.Fullscreen preview and orientation`. [PORT V-007] [NEW]

#### Scenario: Enter and exit
- **WHEN** the user clicks the fullscreen button and then presses Escape
- **THEN** the preview panel fills the screen, then returns to its previous size with the same zoom mode

#### Scenario: Context menu in fullscreen
- **WHEN** the user right-clicks the canvas in fullscreen
- **THEN** the context menu is visible above the fullscreen canvas

### Requirement: Multi-camera angle viewer
While the playhead is inside a multi-camera clip (`project-document.Multi-camera clip`) or such a clip is selected, the player SHALL offer the angle viewer of `timeline-editing.Multi-camera clip`; this capability owns its presentation, that requirement owns what a switch does. On web and desktop (macOS, Windows, Linux) a player-toolbar button "Angles" (`player.multicam-viewer.toggle`, context `editor`, default unbound) SHALL split the player area: the left half shows a grid of the angles of `project-document.Multi-camera definition` in angle order — 1 column × 2 rows for 2 angles, 2 × 2 for 3–4, 3 × 2 for 5–6, 4 × 2 for 7–8 — and the right half the programme output. Each tile SHALL show the angle's frame at the playhead's source time, obtained through `thumbnails.request` of `render-engine.EngineSurface commands from app to engine` at a width of at most 480 px and refreshed at least 10 times per second during playback and on every seek; its number (1–8) and name; an accent outline (`timeline/selection`) on the active angle of the part under the playhead; a speaker badge on the audio angle (`audioAngleId`, or the active angle when `audioFollowsVideo` is on); and the text "No media" on a neutral tile where the angle has no clip at that time. Clicking a tile, or invoking `timeline.multicam.switch-angle-1` … `-8` (`keyboard-shortcuts.Default bindings for timeline view and player`) while the viewer or the timeline has focus, SHALL switch to that angle exactly as `timeline-editing.Multi-camera clip` defines — also during playback, without stopping it; Alt/Option-click SHALL set the audio angle instead. Tiles SHALL be focusable buttons named "Angle {n}: {name}", with "active" and "audio source" in their state. The viewer SHALL close when the playhead leaves every multi-camera clip and none is selected, and its open state SHALL be remembered per device. On phones and tablets (iOS and Android) the same grid, tiles, badges and tap behaviour SHALL be shown in the "Angle" sheet of `mobile-editor.Compound clip tool strip`, 2 tiles per row on phones and 4 on tablets, and a long press on a tile SHALL set the audio angle. Only the active angle is composited into the programme output (`render-engine.Compound clip nodes`); the tiles never appear in snapshots or exports. [CAPCUT CC-072] [NEW]

#### Scenario: Grid for four angles
- **WHEN** the playhead is inside a multi-camera clip with 4 angles and the user opens the viewer on desktop
- **THEN** a 2 × 2 grid shows the four angles at the playhead time, the active angle is outlined and the audio angle carries the speaker badge

#### Scenario: Switch by clicking while playing
- **WHEN** playback is running at 5 s inside a part showing angle 1 and the user clicks tile 3
- **THEN** the part is cut at the frame presented when the click arrived, the programme shows angle 3 from there, and playback does not stop

#### Scenario: Angle without media
- **WHEN** angle 2's clip ends before the playhead time
- **THEN** tile 2 reads "No media" and choosing it makes the part transparent and silent there

#### Scenario: Viewer on a phone
- **WHEN** a multi-camera clip is selected on an iPhone or an Android phone and the user taps Angle
- **THEN** the sheet shows the same tiles 2 per row with the active and audio marks, and tapping a tile switches the angle at the playhead

#### Scenario: Keyboard switch
- **WHEN** the viewer has focus and the user invokes the switch action for angle 2
- **THEN** the part under the playhead switches to angle 2 as one undo step

### Requirement: Save snapshot
"Save snapshot" SHALL render the frame at `min(playhead, lastFrameTime)` at full project canvas size through `render-engine.Still frame and thumbnail rendering`, with overlays, guides and handles excluded, to a PNG file named `<project>-<HH-MM-SS-FF>.png` — the still-frame name of `export-share.Still frame export` (FF = frame number), with the project name passed through `export-share.Filename sanitisation`, the one file-name rule; this capability defines no character rule of its own, so names in any script (Vietnamese, Japanese and every other) are kept. On desktop a native save dialog SHALL open with that name; on web the file SHALL be downloaded; on mobile it SHALL be saved to the photo library after the add-only photo permission is granted. A failure SHALL show an error toast "Snapshot was not saved" followed by the reason; a denied permission SHALL show a toast with an "Open settings" action. The action SHALL be disabled in the engine states listed in `preview-canvas.Engine states`. Still-frame export with format options is defined in `export-share.Still frame export`. [PORT V-010, V-009]

#### Scenario: Snapshot resolution
- **WHEN** the user saves a snapshot of a 1080×1920 project at preview quality 1/4 and zoom 3
- **THEN** the PNG is 1080×1920 px and contains no selection handles or guide lines

#### Scenario: File name
- **WHEN** the project is named "My Trip #1" and the playhead is at 00:01:05:11
- **THEN** the suggested file name is `My Trip #1-00-01-05-11.png`

#### Scenario: Vietnamese and Japanese names
- **WHEN** projects named "Chuyến đi Đà Lạt" and "京都の旅" each save a snapshot at 00:00:02:00
- **THEN** the suggested names are `Chuyến đi Đà Lạt-00-00-02-00.png` and `京都の旅-00-00-02-00.png`

#### Scenario: Permission denied on mobile
- **WHEN** the user denies photo-library access
- **THEN** no file is written and a toast offers "Open settings"

#### Scenario: Disk write error
- **WHEN** the chosen destination is not writable on desktop
- **THEN** no partial file remains and a toast reads "Snapshot was not saved" with the operating-system reason

### Requirement: Copy snapshot to clipboard
"Copy snapshot" SHALL render the same frame as Save snapshot and place it on the system clipboard as `image/png`. When the platform cannot write images to the clipboard the menu item SHALL be disabled with the tooltip "Clipboard images are not supported on this device". Success SHALL show a toast "Snapshot copied"; failure SHALL show an error toast. [PORT V-011]

#### Scenario: Copy and paste
- **WHEN** the user chooses "Copy snapshot" and pastes into an image editor
- **THEN** an image of the project canvas size is pasted

#### Scenario: Unsupported platform
- **WHEN** the runtime has no image clipboard API
- **THEN** "Copy snapshot" is shown disabled with the tooltip

### Requirement: Hit-testing candidates and order
Preview hit-testing SHALL consider only elements live at the playhead (`startTime ≤ t < startTime + duration`), excluding hidden elements, elements on hidden tracks, elements on locked tracks, and audio, effect and adjustment elements. Z-order SHALL be: overlay track index 0 topmost, descending to the main track at the bottom; within one track the element with the greater `startTime` (ties by id) is on top. The hit shape SHALL be the element's rotated bounding rectangle. Bounds SHALL be: video and image — contain-fit of the source size × scale, after crop; compound — contain-fit of the referenced scene's canvas size × scale, after crop; sticker — intrinsic size (fallback 200×200) × scale; graphic — 512×512 × scale, except a graphic with `definitionId: "drawing"`, whose bounds are its `intrinsicWidth` × `intrinsicHeight` (`project-document.Freehand drawing geometry`) × scale, centred on `transform.position`; text and caption — measured glyph block unioned with the background rectangle or bubble. Effect spill and mask clipping SHALL NOT change bounds. [PORT V-012]

#### Scenario: Topmost wins
- **WHEN** a text element on overlay track 0 overlaps a video on the main track and the user clicks the overlap
- **THEN** the text element is selected

#### Scenario: Drawing bounds
- **WHEN** a drawing with intrinsic size 900×300 at scale 1 is on the canvas and the user clicks 400 px to the right of its centre
- **THEN** the drawing is selected, although the point lies outside a 512×512 square

#### Scenario: Locked track is skipped
- **WHEN** the topmost element under the pointer is on a locked track
- **THEN** the click selects the next element underneath, or clears the selection when there is none

#### Scenario: Element not at the playhead
- **WHEN** the playhead is outside an element's time range
- **THEN** clicking where that element would be does not select it

### Requirement: Preview selection
A primary-button click without drag SHALL select the topmost hit element and clear any other selection; a click on empty canvas SHALL clear the selection. Shift + click SHALL toggle the hit element in the selection. Alt/Option + click SHALL select the next element underneath the currently selected one at that point, cycling back to the topmost. A primary-button drag that starts on empty canvas SHALL draw a marquee and select every candidate whose bounds intersect it (Shift adds to the selection). Selection SHALL be the same selection state as the timeline's (`timeline-editing.Click selection`, `timeline-editing.Selection commands`). Only the primary button selects; canvas selection, drag and double-click SHALL be disabled while text is edited in place, in crop mode and in mask mode. On touch devices a tap selects, a tap on empty canvas clears, and multi-selection is made from the timeline. [PORT V-012] [NEW]

#### Scenario: Shift-click adds
- **WHEN** element A is selected and the user Shift-clicks element B on the canvas
- **THEN** A and B are both selected in the preview and in the timeline

#### Scenario: Select underneath
- **WHEN** three elements overlap, the top one is selected, and the user Alt-clicks the overlap twice
- **THEN** the second element is selected after the first click and the third after the second click

#### Scenario: Marquee
- **WHEN** the user drags a marquee from empty canvas across two stickers
- **THEN** both stickers are selected and no element is moved

### Requirement: Move elements on the canvas
A drag that moves at least 0.5 canvas units SHALL move elements: the already-selected element under the pointer when there is one, otherwise the topmost hit, which becomes the selection. When the target belongs to a multi-selection, all selected visual elements SHALL move by the same delta. Holding Shift SHALL constrain the movement to the axis with the larger delta. The nudge actions `preview.nudge-left`, `preview.nudge-right`, `preview.nudge-up` and `preview.nudge-down` SHALL move the selection by 1 canvas px, and `preview.nudge-far-left`, `preview.nudge-far-right`, `preview.nudge-far-up` and `preview.nudge-far-down` by 10 canvas px; they are active only in the `preview` focus scope (the preview region focused with an element selected) and their keys are stated only in `keyboard-shortcuts.Default bindings for timeline view and player`. Repeated nudges of the same selection SHALL be merged into one history entry by the coalescing rule of `timeline-editing.Undo and redo`. A drag SHALL be shown through the preview layer and committed as one undo step on release; pointer-cancel or Escape during the drag SHALL discard it. When `transform.position.x` or `transform.position.y` (`project-document.Transform`) has keyframes, the commit SHALL write keyframes at the playhead instead of changing the base value. [PORT V-013] [CAPCUT CC-046] [NEW]

#### Scenario: Move a group
- **WHEN** two elements are selected and the user drags one of them 100 px right and 20 px down
- **THEN** both elements' positions change by (+100, +20) and one undo restores both

#### Scenario: Axis lock
- **WHEN** the user drags with Shift held by (+80, +12)
- **THEN** the element moves by (+80, 0)

#### Scenario: Cancel
- **WHEN** the user presses Escape during a drag
- **THEN** the element returns to its original position and no undo step is added

#### Scenario: Nudge only in the preview scope
- **WHEN** an element is selected, focus is on the timeline and the user invokes the key bound to `preview.nudge-right`
- **THEN** the element does not move and the key performs its timeline action

### Requirement: Transform handles
Transform handles SHALL be shown only when exactly one visual element is selected and it is live at the playhead on an unlocked, visible track. The frame SHALL be a 1 px outline in white at 75 % opacity following the element's rotation, with four square corner handles of 10 px (hit area 18 px), four edge handles of 6×14 px on the left, right, top and bottom edges, and a rotate handle of radius 10 px placed 24 px outside the top-centre. Handle sizes SHALL be constant in screen pixels at every zoom. Cursors SHALL follow the handle angle in 45° buckets. On touch devices the hit area of every handle SHALL be at least 44×44 pt and the handle set is defined by `mobile-editor.On-canvas element handles`. [PORT V-014, V-015, V-016] [NEW]

#### Scenario: Handles for a single selection
- **WHEN** one image element is selected and live at the playhead
- **THEN** four corner handles, four edge handles and one rotate handle are drawn around it

#### Scenario: No handles for multi-selection
- **WHEN** two elements are selected
- **THEN** each shows an outline and no handles are drawn

#### Scenario: Handles keep size when zoomed
- **WHEN** preview zoom changes from 1 to 4
- **THEN** corner handles are still 10 px on screen

### Requirement: Scale with handles
Dragging a corner handle SHALL scale the element uniformly about its centre by the ratio of pointer distances from the centre, applied to both `transform.scale.x` and `transform.scale.y`. Dragging an edge handle SHALL scale only that axis symmetrically about the centre. Modifiers: Shift on a corner handle SHALL release the aspect lock (X and Y follow the pointer independently); Alt/Option SHALL anchor the opposite corner or edge instead of the centre. The absolute scale SHALL be clamped to 0.01–100. A scale gesture SHALL be one undo step; when the scale channels have keyframes the commit SHALL write keyframes at the playhead and SHALL NOT delete existing keyframes. On touch devices a two-finger pinch on a selected element SHALL scale it uniformly about its centre. [PORT V-014, V-015] [CAPCUT CC-045, CC-046] [NEW]

#### Scenario: Uniform corner scale
- **WHEN** the user drags a corner handle of an element at scale 1 to twice its distance from the centre
- **THEN** scaleX and scaleY are both 2 and the centre has not moved

#### Scenario: Anchored scale
- **WHEN** the user drags the bottom-right corner with Alt held
- **THEN** the top-left corner stays at the same canvas position

#### Scenario: Keyframes preserved
- **WHEN** an element has scale keyframes at 1 s and 3 s and the user scales it by handle with the playhead at 2 s
- **THEN** a scale keyframe exists at 2 s and the keyframes at 1 s and 3 s are unchanged

### Requirement: Flip by dragging through the centre
Dragging an edge or corner handle through the element's centre SHALL mirror the element on that axis during the drag. On commit the stored scale SHALL remain positive and the element's `flip.horizontal` or `flip.vertical` flag SHALL be toggled instead. Elements loaded from an OpenCut classic project with a negative stored scale SHALL render mirrored and SHALL be normalised to a positive scale plus flip flag the next time their transform is committed. [PORT V-017] [NEW]

#### Scenario: Drag through the centre
- **WHEN** the user drags the right edge handle past the left edge to the same distance on the other side
- **THEN** the element is shown mirrored horizontally with `flip.horizontal = true` and `scaleX` unchanged in magnitude and positive

#### Scenario: Legacy negative scale
- **WHEN** a classic project with `transform.scaleX = -1` is opened
- **THEN** the element renders mirrored without any edit being recorded

### Requirement: Rotate with the handle
Dragging the rotate handle SHALL change `transform.rotate` by the angle swept about the centre of the element bounds, clamped to the range of `preview-canvas.Basic tab fields`. Rotation SHALL snap to multiples of 90° when within ±5°; holding Shift SHALL instead constrain rotation to multiples of 15°; holding `Mod` SHALL disable snapping. While rotating, a badge near the handle SHALL show the angle to 0.1°. On touch devices a two-finger twist on a selected element SHALL rotate it with the same 90° snap. [PORT V-016, V-019] [CAPCUT CC-043, CC-046] [NEW]

#### Scenario: Snap to 90°
- **WHEN** the user rotates an element to 87°
- **THEN** the committed rotation is 90°

#### Scenario: 15° steps
- **WHEN** the user rotates with Shift held to about 40°
- **THEN** the committed rotation is 45°

#### Scenario: Free rotation
- **WHEN** the user rotates with `Mod` held to 88°
- **THEN** the committed rotation is 88°

### Requirement: Preview snapping
This requirement is the only definition of snapping on the canvas. While moving or scaling, element centres and axis-aligned bounding edges (rotation-aware) SHALL snap within 8 screen px (converted to canvas units by the current zoom) to: the canvas centre lines; the canvas edges; the lines of the active grid guide; the edges of the active safe-area guide; custom guide lines; and the centres and bounding edges of every other visible element live at the playhead. Per axis the closest candidate SHALL win. Each active snap SHALL draw a 1 px guide line in white at 70 % opacity across the viewport. Holding `Mod` during the gesture SHALL disable snapping for every canvas gesture, including the mask and pen-point gestures of `masks-blending-keying.Mask snapping`; Shift is reserved for constraining (axis lock, 15° steps, aspect release) and never disables snapping (this supersedes the Shift modifier of OpenCut classic). A "Snap in preview" toggle in the guides popover (default on) SHALL enable or disable snapping and SHALL be persisted per device. [PORT V-018, V-020] [CAPCUT CC-046] [NEW]

#### Scenario: Snap to canvas centre
- **WHEN** an element's centre is dragged to within 5 screen px of the vertical centre line
- **THEN** its centre X equals the canvas centre and a vertical guide line is shown

#### Scenario: Snap to another element
- **WHEN** element A's left edge is dragged to within 6 screen px of element B's left edge
- **THEN** the two left edges are equal and a guide line is drawn along that edge

#### Scenario: Modifier disables snapping
- **WHEN** the user drags with `Mod` held near the canvas centre
- **THEN** no snapping occurs and no guide line is shown

#### Scenario: Outside the threshold
- **WHEN** an element's centre is released 9 screen px from the vertical centre line
- **THEN** its position is exactly where it was released

### Requirement: Crop mode
This requirement is the only definition of crop. Video, image and compound elements SHALL support crop. Crop mode SHALL be entered from the inspector Crop button, the element context menu, the entry points listed in `timeline-editing.Transform entry points in the timeline`, the mobile Transform tool (`mobile-editor.Video clip tool strip`) or the action `preview.crop` (default binding in `keyboard-shortcuts.Default bindings for timeline view and player`). In crop mode the preview SHALL show the uncropped source dimmed to 40 % outside the crop rectangle, a rule-of-thirds grid inside it, and 8 handles (4 corners, 4 edges); dragging inside the rectangle SHALL move it within the source. A ratio menu (chips on mobile) SHALL offer Free (default), Original, 16:9, 9:16, 1:1, 4:3, 3:4, 4:5 and 2.35:1; a fixed ratio SHALL be maintained while dragging. The crop SHALL be stored as `crop {left, top, right, bottom}`, each a fraction of the source from 0 to 0.99 with `left + right ≤ 0.99` and `top + bottom ≤ 0.99`; in addition the remaining size SHALL be at least 16 source px per side when the source is large enough to allow it. Apply (Enter, ✓ on mobile) SHALL commit one undo step, Cancel (Escape, ✕ on mobile) SHALL discard, and Reset SHALL set all four values to 0. Crop values SHALL be keyframable. After cropping, element bounds, hit-testing and handles SHALL use the cropped rectangle. The compositor applies crop in the `crop` stage of `render-engine.Per-layer stage order`. [PORT N-013] [CAPCUT CC-041] [NEW]

#### Scenario: Crop to square
- **WHEN** the user enters crop mode on a 1920×1080 clip, picks 1:1 and applies with the rectangle centred
- **THEN** the stored crop is left 0.21875, right 0.21875, top 0, bottom 0 and the element bounds are square

#### Scenario: Cancel
- **WHEN** the user changes the rectangle and presses Escape
- **THEN** the previous crop is unchanged and no undo step is added

#### Scenario: Minimum size
- **WHEN** the user drags the right handle to the left handle on a clip with `crop.left = 0.5`
- **THEN** `crop.right` stops at 0.49

#### Scenario: Typed value is clamped by the opposite side
- **WHEN** `crop.top` is 0.6 and the user types 70 in the Bottom field
- **THEN** `crop.bottom` becomes 0.39

#### Scenario: Unsupported element
- **WHEN** a text element is selected
- **THEN** the Crop button is not shown

### Requirement: Flip, mirror and quarter-turn rotation
This requirement is the only definition of flip and of "Rotate 90°". Every visual element SHALL have `flip {horizontal, vertical}` (booleans, default false, not keyframable), applied about the element centre in the `flip` stage of `render-engine.Per-layer stage order` (before rotation). The inspector, the element context menu, the timeline entry points of `timeline-editing.Transform entry points in the timeline` and the mobile Transform tool SHALL offer "Flip horizontal" (Mirror), "Flip vertical" and "Rotate 90°". "Rotate 90°" SHALL add 90 to `transform.rotation` (clockwise): when the property has no keyframes the result SHALL be normalised to the interval (−180, 180]; when it has keyframes a key with the value `current + 90` SHALL be written at the playhead without normalising, clamped to ±3600. Each action SHALL apply to every selected visual element as one undo step. [PORT N-013] [CAPCUT CC-042, CC-044]

#### Scenario: Mirror
- **WHEN** the user chooses "Flip horizontal" on a video element
- **THEN** the picture is mirrored left–right, `flip.horizontal` is true, position and scale values are unchanged, and undo restores it

#### Scenario: Rotate 90° four times
- **WHEN** the user chooses "Rotate 90°" four times on an element at 0° without rotation keyframes
- **THEN** the rotation values are 90, 180, −90 and 0 in turn

#### Scenario: Keyframed rotation
- **WHEN** rotation has keyframes and its value at the playhead is 350 and the user chooses "Rotate 90°"
- **THEN** a keyframe with value 440 exists at the playhead and the other keyframes are unchanged

#### Scenario: Clamp with keyframes
- **WHEN** the keyframed value at the playhead is 3580 and the user chooses "Rotate 90°"
- **THEN** the keyframe written at the playhead has the value 3600

### Requirement: Reset transform
"Reset transform" (element context menu, the reset button in the Basic header, and the timeline entry point of `timeline-editing.Transform entry points in the timeline`) SHALL, for every selected visual element and as one undo step, set position to (0, 0), scale to (1, 1), rotation to 0 and both flips to false, and SHALL remove every keyframe of the position, scale and rotation properties. Crop SHALL NOT be changed; crop is reset only by Reset in `preview-canvas.Crop mode`. Opacity, blend mode, masks, effects and animations SHALL NOT be changed. [NEW]

#### Scenario: Reset transform
- **WHEN** the user chooses Reset transform on an element at position (200, 50), scale 2, rotation 30° with horizontal flip on
- **THEN** the element is at (0, 0), scale 1, rotation 0° with flips off, and one undo restores the previous values

#### Scenario: Keyframes are removed
- **WHEN** the element has position keyframes at 1 s and 3 s and the user chooses Reset transform
- **THEN** the position property has no keyframes and its value is (0, 0), and one undo restores both keyframes

#### Scenario: Crop is kept
- **WHEN** the element has `crop.left = 0.2` and the user chooses Reset transform
- **THEN** `crop.left` is still 0.2

### Requirement: Layer order controls
This requirement is the only definition of layer-order commands. The element context menu and the inspector header SHALL offer Bring to front, Bring forward, Send backward and Send to back for visual elements on overlay tracks; on mobile the same commands are driven by `mobile-editor.Layers sheet`. Bring forward SHALL move the element to the nearest track above that accepts its type (`timeline-editing.Track types and element compatibility`) and has no overlap in its time range, creating a new track directly above when none exists (`timeline-editing.Track creation and insert index`); Send backward SHALL do the same downward and SHALL NOT move an element below the main track; Bring to front and Send to back SHALL move it to the topmost or lowest overlay position by the same rule. Moves SHALL be executed through `timeline-editing.Moving elements` as one undo step. Items that have no effect SHALL be disabled. When the overlay track limit of `timeline-editing.Track creation and insert index` prevents creating a track, the command SHALL be refused with that requirement's limit message. [NEW]

#### Scenario: Bring forward
- **WHEN** a sticker on overlay track 2 is brought forward and overlay track 1 is free during its time range
- **THEN** the sticker is on overlay track 1 and renders above the element that was above it

#### Scenario: Already at the back
- **WHEN** the selected element is on the lowest overlay track with nothing below it but the main track
- **THEN** "Send backward" and "Send to back" are disabled

#### Scenario: New track created
- **WHEN** a sticker on overlay track 0 is brought forward while another element overlaps its time range on no track above
- **THEN** a new overlay track is created above track 0 holding the sticker, and one undo removes the track and restores the sticker

### Requirement: Align and distribute
The inspector Basic tab and the element context menu SHALL offer Align left, Align horizontal centre, Align right, Align top, Align vertical centre and Align bottom. With one element selected, alignment SHALL be relative to the canvas; with two or more, relative to the union of their bounds. With three or more selected, Distribute horizontally and Distribute vertically SHALL equalise the gaps between bounding boxes. Each action SHALL be one undo step and SHALL respect keyframes as in `preview-canvas.Move elements on the canvas`. [NEW]

#### Scenario: Centre on canvas
- **WHEN** one element at position (300, −120) is aligned to horizontal centre and vertical centre
- **THEN** its position is (0, 0)

#### Scenario: Distribute
- **WHEN** three elements with horizontal gaps of 10 px and 50 px are distributed horizontally
- **THEN** both gaps are 30 px and the outer elements have not moved

### Requirement: Preview context menu on empty canvas
Right-click (long-press on touch) on empty canvas SHALL open a menu with, in order: Fit to screen; separator; Full screen; Save snapshot; Copy snapshot; separator; Paste (when the clipboard holds elements); separator; one checkbox per registered overlay (at minimum "Show marker notes"); Guides (opens the guides popover). [PORT V-009] [NEW]

#### Scenario: Menu content
- **WHEN** the user right-clicks empty canvas with an empty clipboard
- **THEN** the menu shows the listed items with Paste disabled

#### Scenario: Toggle an overlay
- **WHEN** the user unchecks "Show marker notes"
- **THEN** marker notes disappear from the preview and the setting persists after reload

### Requirement: Element context menu
Right-click (long-press on touch with a pointer device; on phones the tool strips of `mobile-editor` replace this menu) on an element SHALL select it if it is not selected and open a menu with: Edit text (text and caption only); Crop (video, image, compound); Flip horizontal; Flip vertical; Rotate 90°; separator; Bring to front; Bring forward; Send backward; Send to back; separator; Align submenu; separator; AI tools submenu (`ai-editing-tools.AI tools catalogue and entry points`); separator; Copy; Cut; Duplicate; Delete; separator; Hide; Lock track; separator; Reset transform (`preview-canvas.Reset transform`). Clipboard, duplicate, hide, lock and delete items SHALL invoke `timeline-editing.Clipboard`, `timeline-editing.Duplicate`, `timeline-editing.Element hide, mute and deactivate`, `timeline-editing.Track lock` and `timeline-editing.Delete and ripple delete`. Items that do not apply to the selection SHALL be omitted. [NEW]

#### Scenario: Menu on an unselected element
- **WHEN** the user right-clicks an unselected image
- **THEN** the image becomes the only selection and the menu shows Crop but not Edit text

#### Scenario: Text element
- **WHEN** the user right-clicks a text element
- **THEN** the menu shows Edit text and does not show Crop

### Requirement: Overlay system
The preview SHALL host overlays registered with: an id; a mount (`hud` with one of four corner anchors and an order, `scene` scaled with the canvas, or `viewport` in viewport pixels); a plane (`under-interaction` or `over-interaction` relative to selection handles); a z-index; pointer-events on or off; and a default visibility. Visibility SHALL resolve as `stored[id] ?? defaultVisible ?? true`. The built-in overlays SHALL be: guides (scene mount, under-interaction) and marker notes (HUD top-left stack; its content rule is `timeline-editing.Marker notes overlay`; each note has a 3 px left border in the marker's `marker/1…8` colour token of `design-system.Editor colour tokens`). The user-facing term is "marker" everywhere; the stored scene field is `markers` (`project-document.Markers`). Overlays SHALL NOT appear in snapshots or exports. [PORT V-023]

#### Scenario: Marker note shown
- **WHEN** the playhead is inside a marker range whose note is "Check logo"
- **THEN** "Check logo" is shown at the top-left of the preview

#### Scenario: Hidden overlay stays hidden
- **WHEN** the marker-notes overlay is turned off and the editor is reloaded
- **THEN** no marker notes are shown

#### Scenario: Not in snapshots
- **WHEN** a marker note is visible and the user saves a snapshot
- **THEN** the PNG does not contain the note

### Requirement: Guides popover
The player toolbar guides button SHALL open a popover (on mobile a bottom sheet opened from the Guides row of `mobile-editor.More sheet`) with three independent sections: Grid, Safe area and Custom lines, plus the "Snap in preview" toggle. Each section SHALL have an on/off switch; Grid and one Safe area preset and Custom lines SHALL be able to be active at the same time. The guides button SHALL show an active state when any guide is on. The rebindable action `player.guides.toggle` ("Show / hide preview guides"; registered by `preview-canvas.Preview keyboard access and accessibility`) SHALL hide or show all active guides without changing their configuration. [PORT V-025, V-026] [NEW]

#### Scenario: Popover is reachable
- **WHEN** the user clicks the guides button
- **THEN** the popover opens with the Grid, Safe area and Custom lines sections

#### Scenario: Combined guides
- **WHEN** the user enables Grid and a Safe area preset
- **THEN** both are drawn over the canvas

### Requirement: Grid guide
The grid guide SHALL divide the canvas into rows and columns, each configurable from 1 to 24 (default 3×3) with scrubbable number fields and a reset button, drawn as 1 px lines in white at 35 % opacity with a 1 px black 20 % shadow for contrast on light footage. [PORT V-025]

#### Scenario: Default grid
- **WHEN** the grid is enabled with default settings
- **THEN** two vertical and two horizontal lines divide the canvas into 9 equal cells

#### Scenario: Limits
- **WHEN** the user types 40 in the rows field
- **THEN** the value becomes 24

### Requirement: Safe-area guides
The Safe area section SHALL offer the presets below, drawn as a dimmed (black 35 %) region outside the safe rectangle plus a 1 px white 70 % outline. Preset names are neutral descriptions; no third-party platform name, logo, icon, brand colour or interface artwork SHALL appear in a preset name, label or drawing. "Title safe" (90 % of width and height, centred) and "Action safe" (93 %) SHALL be available for every canvas ratio. Four vertical-video presets SHALL be available only when the canvas ratio is 9:16, with margins expressed for a 1080×1920 reference and scaled proportionally:

| Preset id | Label | Top | Bottom | Left | Right |
|---|---|---|---|---|---|
| `vertical-rail-right` | Vertical feed — side buttons | 130 | 370 | 60 | 140 |
| `vertical-tall-caption` | Vertical feed — tall caption area | 220 | 420 | 35 | 35 |
| `vertical-wide-rail` | Vertical feed — wide side buttons | 190 | 380 | 60 | 190 |
| `vertical-compact` | Vertical feed — compact | 150 | 340 | 60 | 150 |

Presets that do not apply to the current ratio SHALL be disabled with the tooltip "Available for 9:16 projects". At most one safe-area preset SHALL be active at a time. [PORT V-026, V-027] [NEW]

#### Scenario: Vertical preset
- **WHEN** the preset "Vertical feed — side buttons" is enabled on a 1080×1920 project
- **THEN** the safe rectangle spans x 60–940 and y 130–1550

#### Scenario: Scaled preset
- **WHEN** the same preset is enabled on a 720×1280 project
- **THEN** the safe rectangle margins are top 86.7, bottom 246.7, left 40, right 93.3 canvas px

#### Scenario: Wrong ratio
- **WHEN** the project is 16:9
- **THEN** the four vertical-video presets are disabled and Title safe and Action safe are selectable

#### Scenario: Neutral labels
- **WHEN** the Safe area section is opened in each bundled locale
- **THEN** it lists exactly the six presets and no label contains the name of a third-party product or service

### Requirement: Custom guide lines
The Custom lines section SHALL let the user add horizontal and vertical guide lines (up to 20 per project) with the buttons "Add horizontal line" and "Add vertical line"; a new line SHALL be placed at the canvas centre. Each line SHALL be listed with a numeric position field in canvas px (0 to canvas size, step 1) and a delete button, SHALL be draggable on the canvas when the popover is open, and SHALL be drawn 1 px in the accent colour token of `design-system.Colour tokens` at 80 % opacity. "Clear all" SHALL remove every line. Custom lines SHALL be stored with the project, and add/move/delete SHALL be undoable. [PORT V-028] [NEW]

#### Scenario: Add and position
- **WHEN** the user adds a vertical line and types 200 in its field on a 1080-wide canvas
- **THEN** a vertical line is drawn at x = 200 and elements snap to it

#### Scenario: Limit reached
- **WHEN** 20 lines exist
- **THEN** both add buttons are disabled with the tooltip "Maximum 20 guide lines"

### Requirement: Persist preview settings
Preview settings SHALL be persisted per device under a versioned store: active guides and their configuration (grid rows/columns, safe-area preset), overlay visibility map, snap toggle, loop, master volume and mute, preview quality. A stored version older than the current one SHALL be migrated; unknown or invalid values SHALL fall back to defaults without error. Zoom and pan SHALL NOT be persisted. [PORT V-029] [NEW]

#### Scenario: Settings survive reload
- **WHEN** the user sets the grid to 4×6, turns loop on and reloads the editor
- **THEN** the grid is 4×6 and loop is on

#### Scenario: Corrupt store
- **WHEN** the stored preview settings contain a grid row count of 0
- **THEN** the grid uses 3 rows and the editor opens without an error

### Requirement: In-place text editing
In-place editing is the text entry of pointer devices: web, desktop, and tablets (iPadOS and Android) while a pointer device is attached. On phones, and on tablets without a pointer, it is NOT used: the Edit handle and a double-tap open the text sheet of `text-and-titles.Text on touch devices` on its Keyboard tab, whose input field holds the text; the canvas shows the live text without a caret, and the sheet's ✓ / ✕ rules (`mobile-editor.Tool sheets never cover the preview`) commit or discard. Double-click on a text or caption element that is the topmost hit SHALL open an editable overlay at the element's position, rotation and scale on both axes, with all text selected. The canvas SHALL keep rendering the glyphs; the overlay SHALL show only the caret and selection in the text colour, placed from the glyph positions of `render-engine.Engine-side text shaping and layout`, mirroring background, padding, alignment and text-box width. Every input (including IME composition end) SHALL update `content` through the preview layer. Enter SHALL insert a newline. Blur, Escape, clicking outside or starting playback SHALL commit the edit as one undo step. Committing empty content SHALL delete the element when it was created in the same editing session and SHALL restore the previous content otherwise. Undo and redo shortcuts inside the overlay SHALL act on the text draft only. While editing, canvas selection, dragging and transform handles SHALL be disabled. [PORT V-021, V-022] [NEW]

#### Scenario: Edit and commit
- **WHEN** the user double-clicks a text element, types "Hello" and clicks outside
- **THEN** the element content is "Hello" and one undo restores the previous content

#### Scenario: Phone uses the text sheet
- **WHEN** the user double-taps a text element on an iPhone and on an Android phone
- **THEN** no overlay is opened on the canvas; the text sheet opens on its Keyboard tab and ✕ discards what was typed

#### Scenario: Playback commits
- **WHEN** the user presses the play shortcut while the overlay is open
- **THEN** the edit is committed and playback starts

#### Scenario: Empty new text
- **WHEN** the user adds a new text element, clears its content in the overlay and clicks outside
- **THEN** the element is removed

#### Scenario: Non-uniform scale
- **WHEN** a text element has `transform.scale.x` 2 and `transform.scale.y` 1 and is edited in place
- **THEN** the caret lines up with the rendered glyphs on both axes

### Requirement: Inspector empty state and project details
With nothing selected the inspector SHALL show a "Details" card for the project (name, aspect ratio, resolution, frame rate, duration, storage location on desktop) with a "Modify" button that opens `projects.Project settings surface`, and below it the hint "Select an element on the timeline or canvas to edit its properties." [PORT PR-001] [CAPCUT CC-005, CC-284]

#### Scenario: Nothing selected
- **WHEN** the selection is empty
- **THEN** the inspector shows the project name, ratio, resolution and frame rate and a Modify button

#### Scenario: Modify
- **WHEN** the user presses Modify
- **THEN** the project settings dialog opens on its Details tab

### Requirement: Inspector structure per element type
This requirement is the only definition of the inspector's tabs; every other capability contributes the content of a tab and references this table. With one element selected the inspector SHALL show a horizontal tab strip and the content of the active tab. On desktop and web the inspector is the right panel whose size is defined only by `app-shell-navigation.Editor four-region layout`; on tablets it is the side panel of `mobile-editor.Tablet layout`; on phones the same content is reached through the tool strips of `mobile-editor`, each tool opening the corresponding section as a sheet. The table is identical on desktop and web. Tabs per selection, in order (first tab and first sub-tab are the defaults):

| Selection | Tabs (sub-tabs in parentheses) |
|---|---|
| video | Video (Basic, Cutout, Mask, Retouch, Effects), Audio (hidden when the asset has no audio), Speed, Animation, Tracking, Adjustment, AI tools |
| video with `freeze` set | Video (Basic, Cutout, Mask, Retouch, Effects), Animation, Tracking, Adjustment, AI tools |
| image | Image (Basic, Cutout, Mask, Retouch, Effects), Animation, Adjustment, AI tools |
| compound | Video (Basic, Mask, Effects), Audio (hidden when the referenced scene has no audio), Speed, Animation, Adjustment |
| compound inserted from a template | Video (Basic, Mask, Effects), Slots, Audio (hidden when the referenced scene has no audio), Speed, Animation, Adjustment |
| multi-camera clip | Video (Basic, Mask, Effects), Multi-camera, Audio, Speed, Animation, Adjustment |
| text | Text (Basic, Bubble, Effects, Templates), Animation, Tracking, Text-to-speech |
| caption | Captions (Style, Layout, Highlight, Bilingual), Text, Animation, Text-to-speech |
| sticker | Sticker (Basic, Mask, Effects), Animation, Tracking |
| graphic | Shape (Shape, Basic, Mask, Effects), Animation, Tracking |
| graphic with `definitionId: "drawing"` | Drawing (Drawing, Basic, Mask, Effects), Animation, Tracking |
| audio | Audio (Basic, Voice changer), Speed |
| effect | Parameters |
| adjustment | Parameters (Adjustment, Mask) |
| transition (a selected transition or crossfade junction) | Transition |

Content owners: Basic — `preview-canvas.Basic tab fields`; Cutout — `masks-blending-keying.Cutout model and auto cutout` and `masks-blending-keying.Chroma key`; Mask — `masks-blending-keying.Masks tab and mobile mask sheet`; Retouch — `ai-editing-tools.Face retouch`, `ai-editing-tools.Makeup presets`, `ai-editing-tools.Face reshape`, `ai-editing-tools.Body reshape`, `ai-editing-tools.Eye contact correction` and `ai-editing-tools.Relight`; Effects — `visual-effects-filters.Clip effects list`; Audio and Audio ▸ Basic — `audio-editing.Audio properties tab and mobile audio tools`; Voice changer — `audio-editing.Voice changer`; Speed — `speed-retime.Speed panel structure`; Animation — `keyframe-animation.Clip animation panel` (for text and captions `text-and-titles.Text animations in, out and loop`); Tracking — `ai-editing-tools.Motion tracking`, which tracks a target on a video clip, so the tab exists for video and for the followers text, sticker and shape, and not for image (binding controls for text in `text-and-titles.Text tracking`, for stickers and shapes in `stickers-shapes.Sticker and shape animation and tracking`); Adjustment — `color-adjustment.Adjustment tab layout`; AI tools — the remaining clip-level tools of `ai-editing-tools.AI tools catalogue and entry points`; Text sub-tabs and Text-to-speech — `text-and-titles.Text inspector layout`; Captions and its four sub-tabs — `captions-subtitles.Caption inspector tab`; the Text tab of a caption is the Basic section of `text-and-titles.Text inspector layout` without Bubble and Templates; Text-to-speech of a caption — `text-and-titles.Text-to-speech hand-off`; Shape — `stickers-shapes.Shape parameter table`; Drawing — `stickers-shapes.Freehand drawing`; Slots — `templates.Replace and adjust slot media`; Multi-camera — the "Audio source" and "Audio follows video" controls and the source and flatten buttons of `timeline-editing.Multi-camera clip`, with the angle grid of `preview-canvas.Multi-camera angle viewer`; Transition — `transitions.Transition inspector` (including the crossfade shape select of `audio-editing.Crossfades`); the Cutout sub-tab includes the "Invert" switch (`cutout.inverted`) of `masks-blending-keying.Cutout model and auto cutout`; Parameters of an effect element — `visual-effects-filters.Effect parameter editing`; Parameters of an adjustment layer — its Adjustment sub-tab hosts the sections of `color-adjustment.Adjustment tab layout` and its Mask sub-tab the mask controls of `masks-blending-keying.Masks tab and mobile mask sheet`. A standalone filter is an `effect` element and therefore shows Parameters. For a selected video, image or compound element on the main track, the Basic sub-tab SHALL end with a **Background** section for that clip's canvas background (`timeline-editing.Per-clip canvas background`): the background editor of `projects.Background colour and gradient`, `projects.Background blur and image` and `projects.Transparent background`, a switch "Use project background" (on when the clip has no override; turning it on removes the override) and the button "Apply to all", which writes the value to the project default and clears every per-clip override as one undo step; the section is absent for elements on other tracks. The active tab and sub-tab SHALL be remembered per selection row per device. [PORT PR-003, PR-011] [CAPCUT CC-284, CC-291]

#### Scenario: Video tabs
- **WHEN** a video element whose asset has audio is selected
- **THEN** the tabs are Video, Audio, Speed, Animation, Tracking, Adjustment, AI tools with Video ▸ Basic active by default, and Video has the sub-tabs Basic, Cutout, Mask, Retouch, Effects

#### Scenario: Silent video
- **WHEN** a video element whose asset has `hasAudio = false` is selected
- **THEN** the Audio tab is not shown

#### Scenario: Freeze frame
- **WHEN** a video element with `freeze` set is selected
- **THEN** the Audio and Speed tabs are not shown

#### Scenario: Sticker and adjustment have Mask
- **WHEN** a sticker is selected, and then an adjustment element
- **THEN** the sticker shows Sticker (Basic, Mask, Effects), Animation, Tracking, and the adjustment element shows Adjustment, Mask

#### Scenario: Caption tabs
- **WHEN** a caption is selected on desktop
- **THEN** the tabs are Captions, Text, Animation, Text-to-speech and Captions has the sub-tabs Style, Layout, Highlight, Bilingual

#### Scenario: Image has no Tracking tab
- **WHEN** an image element is selected
- **THEN** the tabs are Image, Animation, Adjustment, AI tools

#### Scenario: Transition selected
- **WHEN** the user selects a transition between two clips
- **THEN** the inspector shows the single tab Transition with the content of `transitions.Transition inspector`

#### Scenario: Drawing and template compound
- **WHEN** a drawing is selected, and then a compound inserted from a template
- **THEN** the drawing shows Drawing (Drawing, Basic, Mask, Effects), Animation, Tracking, and the compound shows a Slots tab after Video

#### Scenario: Text tabs
- **WHEN** a text element is selected
- **THEN** the tabs are Text, Animation, Tracking, Text-to-speech and Text has the sub-tabs Basic, Bubble, Effects, Templates

#### Scenario: Tab memory
- **WHEN** the user opens the Speed tab on one video element and then selects another video element
- **THEN** the Speed tab is active

### Requirement: Basic tab fields
The Basic sub-tab (and the Basic section of Text) SHALL contain the sections Transform, Blend and — for main-track video, image and compound elements — Background, with these fields. The Key column gives the stored field of `project-document.Transform` and `project-document.Opacity, blend mode, crop and flip`, which own names, ranges and defaults; the keyframable ones are animation paths of `project-document.Animatable property paths` under exactly these names. The uniform scale lock is the device-local `local.uniformScaleLock`.

| Section | Field | Key | Range | Step | Default | Keyframable |
|---|---|---|---|---|---|---|
| Transform | Position X | `transform.position.x` | −100000..100000 canvas px (0 = canvas centre, + right) | 1 | 0 | yes |
| Transform | Position Y | `transform.position.y` | −100000..100000 canvas px (+ down) | 1 | 0 | yes |
| Transform | Scale (one field when the uniform lock is on, Scale X and Scale Y when off) | `transform.scale.x`, `transform.scale.y` | 0.01..100, displayed as 1 %..10000 % | 0.01 | 1 | yes |
| Transform | Uniform scale lock | (per device, per element type) | on / off | — | on | no |
| Transform | Rotation | `transform.rotation` | −3600..3600° | 0.1 | 0 | yes |
| Transform | Flip horizontal / Flip vertical / Rotate 90° (buttons) | `flip.horizontal`, `flip.vertical` | off / on | — | off | no |
| Transform | Crop (button opens crop mode; four numeric fields Left, Top, Right, Bottom) | `crop.*` | 0..0.99, displayed as 0–99 %, opposite sides sum ≤ 0.99 | 0.001 | 0 | yes |
| Blend | Opacity | `opacity` | defined by `masks-blending-keying.Opacity` | | | |
| Blend | Blend mode | `blendMode` | the modes of `masks-blending-keying.Blend modes` | | | |
| Background | Background of this clip, with "Apply to all" | element `background` | defined by `timeline-editing.Per-clip canvas background` with the value types of `projects.Background colour and gradient` and `projects.Background blur and image` | | | |

The rotation range of ±3600° in steps of 0.1° supersedes the −360…360°, step 1 range of OpenCut classic so that multi-turn spins can be keyframed; stored classic values are valid unchanged. With the uniform lock on, editing Scale SHALL multiply both axes by the same factor, preserving any existing X:Y ratio. Crop fields SHALL be shown only for video, image and compound elements. The Transform section header SHALL carry the reset button of `preview-canvas.Reset transform`. Alignment buttons (`preview-canvas.Align and distribute`) SHALL sit under the position fields. [PORT PR-004, PR-005, PR-006, PR-007, PR-008] [CAPCUT CC-043, CC-045] [NEW]

#### Scenario: Scale lock preserves ratio
- **WHEN** an element has `transform.scale.x` 2 and `transform.scale.y` 1, the lock is on, and the user sets Scale to 400 %
- **THEN** `transform.scale.x` is 4 and `transform.scale.y` is 2

#### Scenario: Rotation clamp
- **WHEN** the user types 5000 in Rotation
- **THEN** the value becomes 3600

#### Scenario: Multi-turn keyframes
- **WHEN** rotation has keyframes 0 at 0 s and 720 at 2 s with linear interpolation
- **THEN** the element completes two full clockwise turns in 2 s and shows 360° at 1 s

#### Scenario: Background section only for main-track clips
- **WHEN** an overlay video element is selected, and then a main-track video element
- **THEN** the Background section is absent for the overlay element and present for the main-track element

### Requirement: Audio and Speed tab fields
The Audio and Speed tabs are placed by `preview-canvas.Inspector structure per element type` and their fields are defined by their owners; this requirement only fixes how those fields behave inside the inspector. The Audio tab SHALL host the panel of `audio-editing.Audio properties tab and mobile audio tools`, starting with Volume (`audio-editing.Clip volume in decibels`, with a keyframe toggle) and Mute (`audio-editing.Clip mute and track mute`). The Speed tab SHALL host the panel of `speed-retime.Speed panel structure`, starting with the constant-rate field (`speed-retime.Constant speed range`, which supersedes the 0.01–5× range of OpenCut classic), the editable Duration field of `speed-retime.Duration linked to speed` and the "Keep pitch" switch of `speed-retime.Pitch preservation`. Every numeric field in both tabs SHALL follow `preview-canvas.Number field behaviour`, `preview-canvas.Live preview and single-step commit` and, where the owner marks the parameter keyframable, `preview-canvas.Keyframe toggle in the inspector`. [PORT PR-009, PR-010, PR-012, PR-013]

#### Scenario: Volume clamp
- **WHEN** the user types a value above the maximum of `audio-editing.Clip volume in decibels` in Volume
- **THEN** the field shows that maximum and one undo restores the previous value

#### Scenario: Duration field is editable
- **WHEN** the user sets the rate of a 10 s clip to 2
- **THEN** the Duration field shows 5 s, and typing 10 in the Duration field sets the rate back to 1

#### Scenario: Speed has no keyframe toggle
- **WHEN** the Speed tab is open
- **THEN** the constant-rate field shows a reset button and no keyframe diamond

### Requirement: Number field behaviour
Inspector number fields SHALL: select all on focus; accept typed values and math expressions using `+ - * / ( )` and decimals, evaluated on commit, with any other character causing the entry to be rejected and the previous value restored; snap the committed value to the field's step and clamp it to min/max using the parameter definition of `timeline-editing.Element parameter registry`, so that the same coercion applies to values written by the inspector, the canvas, paste, templates and agent tools; commit on Enter or blur and cancel on Escape; scrub when the label or icon is dragged, using pointer lock where available, at 1 unit per px (0.5 for fields marked slow, ×10 with Shift, ×0.1 with Alt), discarding the first move event; show a suffix (%, °, dB, ×, px) after the value; and show a reset-to-default button whenever the value differs from the default. On touch devices each number field SHALL be presented as a slider with the same range plus − / + steppers and a tappable value that opens a numeric keypad. [PORT PR-014, PR-015, PR-016, PR-017] [NEW]

#### Scenario: Expression
- **WHEN** the user types `1920/2-100` in Position X and presses Enter
- **THEN** the value is 860

#### Scenario: Step snap and clamp
- **WHEN** the user types 33.7 in the Opacity field (displayed in percent)
- **THEN** the stored value is 0.34 and the field shows 34 %

#### Scenario: Scrub
- **WHEN** the user drags the Rotation label 45 px to the right
- **THEN** rotation increases by 45° and the gesture is one undo step

#### Scenario: Rejected input
- **WHEN** the user types `12abc` and presses Enter
- **THEN** the field shows the previous value and nothing changes

#### Scenario: Reset
- **WHEN** Scale is 250 % and the user clicks the reset button
- **THEN** Scale is 100 % and the reset button is hidden

### Requirement: Live preview and single-step commit
Every inspector edit SHALL be shown in the preview immediately through the preview layer while typing, scrubbing or dragging a slider or colour, and SHALL be committed as exactly one undo step on blur, Enter, scrub end or pointer release. Escape SHALL discard the draft and restore the committed value. Starting playback or changing the selection SHALL commit a pending draft. [PORT PR-018]

#### Scenario: Slider drag is one step
- **WHEN** the user drags the Opacity slider from 100 % to 40 % through many intermediate values
- **THEN** the preview updates continuously and a single undo returns opacity to 100 %

#### Scenario: Escape discards
- **WHEN** the user types 500 in Position X and presses Escape
- **THEN** the element returns to its previous position and no undo step is added

### Requirement: Keyframe toggle in the inspector
Every keyframable field SHALL show a diamond toggle before its label, with previous-keyframe and next-keyframe arrows beside it when the property has at least one keyframe. The toggle's semantics — add at the playhead with the current value, remove the keyframe at the playhead, filled and outlined states, disabled with a tooltip when the playhead is outside the element's time range — are owned by `keyframe-animation.Keyframe toggle in the properties panel`; the rule that an edit of a keyframed property (inspector, canvas handles, alignment) writes a keyframe at the playhead instead of changing the base value is owned by `keyframe-animation.On-canvas edits respect keyframes`. This requirement fixes only the placement of the toggle in every inspector row. [PORT PR-019, PR-020]

#### Scenario: Add a keyframe
- **WHEN** the playhead is inside the element and the user clicks the diamond of Opacity
- **THEN** an opacity keyframe exists at the playhead and the diamond is filled

#### Scenario: Edit writes a keyframe
- **WHEN** Position X has keyframes at 1 s and 3 s and the user sets Position X to 200 with the playhead at 2 s
- **THEN** a keyframe with value 200 exists at 2 s and the other two keyframes are unchanged

#### Scenario: Playhead outside the element
- **WHEN** the playhead is before the element's start
- **THEN** the diamond toggles are disabled

### Requirement: Collapsible sections and dependent fields
Inspector sections SHALL be collapsible by clicking their header or pressing Enter/Space on it; the collapsed state SHALL be persisted per section key per device. A field that depends on another (for example the text background fields on `background.enabled`, or stroke fields on the stroke toggle) SHALL be shown only while its dependency holds, and its stored value SHALL be kept while hidden. [PORT PR-021, PR-022] [NEW]

#### Scenario: Collapsed state persists
- **WHEN** the user collapses the Blend section and reopens the editor
- **THEN** the Blend section is collapsed

#### Scenario: Dependent fields
- **WHEN** the text Background switch is turned off and on again
- **THEN** the background fields disappear and reappear with their previous values

### Requirement: Multi-selection editing
With two or more elements selected the inspector SHALL show the header "{N} elements selected" and the tabs and fields common to every selected element type. A field whose values differ SHALL show "Mixed". Typing a value SHALL set that value on every selected element; scrubbing or using steppers SHALL apply the same delta to each element relative to its own value, clamped per element. Each edit SHALL be one undo step covering all elements. Keyframe toggles SHALL add or remove a keyframe on every selected element live at the playhead. When the selected types share no field the inspector SHALL show only the header and the alignment controls. [PORT PR-002] [NEW]

#### Scenario: Absolute edit
- **WHEN** three elements with opacities 100 %, 80 % and 50 % are selected and the user types 30 in Opacity
- **THEN** all three have opacity 30 % and one undo restores 100 %, 80 % and 50 %

#### Scenario: Relative scrub
- **WHEN** two elements at Position X 0 and 100 are selected and the user scrubs Position X by +20
- **THEN** their positions are 20 and 120

#### Scenario: Mixed types
- **WHEN** a video and an audio element are selected
- **THEN** the header reads "2 elements selected" and only fields shared by both (Volume, Muted, Speed) are shown

### Requirement: Canvas gestures are single undo steps
Every canvas gesture (move, scale, rotate, crop, flip, layer order, align, in-place text edit) SHALL preview through the `previewElements` layer and commit through `commitPreview` as one undoable command (design D5; `timeline-editing.Preview and commit`). Undo and redo SHALL restore selection as it was when the command was executed. A gesture interrupted by pointer-cancel, loss of window focus, an engine restart or the edit lease being taken by another device (`cross-device-sync.Lease takeover and transfer`) SHALL be discarded without creating an undo step. [NEW]

#### Scenario: Undo a rotate
- **WHEN** the user rotates an element by handle and presses undo
- **THEN** the rotation returns to its previous value and the element is selected

#### Scenario: Interrupted gesture
- **WHEN** the window loses focus in the middle of a scale drag
- **THEN** the element returns to its previous scale and the undo history is unchanged

### Requirement: Preview keyboard access and accessibility
The preview SHALL be a focusable region with the accessible name "Preview" that forms the `preview` focus scope of `keyboard-shortcuts.Shortcut contexts and precedence`. Tab and Shift + Tab SHALL move focus out of the region to the next and previous focusable control and SHALL never be captured by the preview. With the preview focused these actions SHALL be available, with their keys stated only in `keyboard-shortcuts.Default bindings for timeline view and player`: `preview.select-next` and `preview.select-previous` (cycle the selection through elements live at the playhead in z-order, topmost first); the nudge actions of `preview-canvas.Move elements on the canvas`; `preview.edit-text` (starts in-place editing on a selected text or caption element); delete selection; and clear selection. This capability registers the following actions in `keyboard-shortcuts.Action registry` (context `editor` unless stated; every default key is stated only in `keyboard-shortcuts`): transport — `playback.toggle`, `playback.stop` (`preview-canvas.Play, pause and stop`), `playback.frame-previous`, `playback.frame-next`, `playback.frames-back-10`, `playback.frames-forward-10`, `playback.jump-back`, `playback.jump-forward`, `playback.seek-back-1s`, `playback.seek-forward-1s`, `playback.cut-previous`, `playback.cut-next`, `playback.go-start`, `playback.go-end` (`preview-canvas.Seek, jump and frame step`), `playback.loop.toggle` (`preview-canvas.Loop playback`), `playback.shuttle-reverse`, `playback.shuttle-stop`, `playback.shuttle-forward` (`preview-canvas.Playback rate and JKL shuttle`); player — `player.zoom-in`, `player.zoom-out`, `player.zoom-fit`, `player.zoom-100` (`preview-canvas.Zoom by wheel, pinch and commands`), `player.guides.toggle` (`preview-canvas.Guides popover`), `player.multicam-viewer.toggle` (`preview-canvas.Multi-camera angle viewer`), `player.fullscreen` (`preview-canvas.Fullscreen preview`), `player.snapshot` (`preview-canvas.Save snapshot`), `player.copy-snapshot` (`preview-canvas.Copy snapshot to clipboard`); element — `preview.mirror`, `preview.flip-vertical`, `preview.rotate-90` (`preview-canvas.Flip, mirror and quarter-turn rotation`), `preview.crop` (`preview-canvas.Crop mode`); and, in the `preview` context, the two selection actions, the eight nudge actions and `preview.edit-text` named above. Each selected element SHALL be announced to screen readers as "{type}: {name}, position x, y, scale s %, rotation r°". Handles, guide lines and selection outlines SHALL have a contrast ratio of at least 3:1 against both black and white footage by pairing each light line with a dark 1 px shadow. [NEW]

#### Scenario: Keyboard selection and nudge
- **WHEN** the preview is focused with nothing selected, the user invokes `preview.select-next` once and then `preview.nudge-right` three times
- **THEN** the topmost element is selected and its Position X has increased by 3

#### Scenario: Every promised action is registered
- **WHEN** the registry check compares the actions this capability names with `keyboard-shortcuts.Action registry`
- **THEN** `player.zoom-100`, `player.guides.toggle`, `preview.flip-vertical` and `player.copy-snapshot` are registered with context `editor` and no default key, on every platform

#### Scenario: Tab leaves the preview
- **WHEN** the preview is focused and the user presses Tab
- **THEN** focus moves to the first control of the player toolbar and the selection is unchanged

#### Scenario: Screen reader announcement
- **WHEN** a sticker named "Star" is selected with a screen reader running
- **THEN** the announcement includes "sticker: Star" and its position, scale and rotation

#### Scenario: Contrast on white and black footage
- **WHEN** an element is selected over a pure white frame and then over a pure black frame
- **THEN** in both cases the selection outline and handles measure a contrast ratio of at least 3:1 against the adjacent footage pixels
