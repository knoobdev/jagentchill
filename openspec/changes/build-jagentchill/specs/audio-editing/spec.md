## ADDED Requirements

### Requirement: Audio tracks and audio elements
A scene SHALL hold zero or more audio tracks, listed beneath the main track. The stored shape of a track (`id`, `name`, `type`, `locked`, `pinned`, `hidden`, `muted`, `solo`, `volume`, `pan`, `ducking`, `transitions[]`, `elements[]`) is defined only by `project-document.Track fields`, and that of an audio element and of every audio field of an element by `project-document.Audio element`, `project-document.Element audio level fields`, `project-document.Audio processing fields` and `project-document.Beat markers field`; this capability declares no track or element shape of its own and defines the behaviour of those fields. Every audio element references a project media asset through `mediaId` and carries `sourceType`: `upload` (an imported, recorded, extracted or generated audio asset), `library` (an online sound stored in the project with its attribution record) or `bundled` (a sound of `Bundled sound pack` stored in the project). Audio elements SHALL support the common element operations (move, trim within source bounds, split, duplicate, copy/paste, delete, mute), the fields `volume`, `muted` and `pan`, fades, retime per `speed-retime.Audio clip speed`, and the processing options of this capability. "Audio-capable element" in this capability means an audio element, or a video or compound element whose source has audio. Audio tracks produce no picture. Empty audio tracks SHALL be removed automatically after a command, except a pinned track (`timeline-editing.Empty track pruning and persistent tracks`). [PORT AU-001] [CAPCUT CC-207]

#### Scenario: Add an audio file to the timeline
- **WHEN** the user drops an imported MP3 from the media library onto the area below the main track
- **THEN** an audio track is created and holds an audio element with `sourceType: "upload"`, the asset's `mediaId` and the asset's duration

#### Scenario: Empty track cleanup
- **WHEN** the only element on an unnamed, unlocked audio track is deleted
- **THEN** the track is removed, and undo restores both the element and the track

### Requirement: Clip volume in decibels
Every audio element and every video or compound element with audio SHALL have `volume` in decibels, range −60 to +20 dB, default 0 dB, stored with 0.01 dB precision and edited in 0.1 dB steps. Linear gain SHALL be `10^(dB / 20)`, except that −60 dB SHALL be treated as silence (gain 0) and displayed as "−∞ dB". The Audio tab SHALL show a Volume slider with a numeric field ("x.x dB") and a keyframe toggle; double-click resets to 0 dB. The actions `audio.volume-up` and `audio.volume-down` SHALL change the selected elements' volume by +0.1 dB and −0.1 dB (default bindings defined only in `keyboard-shortcuts`); held keys repeat and consecutive presses merge into one history entry by the rule of `timeline-editing.Undo and redo`. Edits SHALL preview live and commit one undo step per gesture. Touch presentation (mobile Volume sheet, template slot sheets and every other touch surface; `mobile-editor` and `templates` reference this definition): a slider labelled in percent from 0 % to 1000 % with the dB value shown beside it, where `percent = 100 × 10^(dB / 20)`, so 0 % = −60 dB (silence), 100 % = 0 dB and 1000 % = +20 dB; the slider position SHALL be `sqrt(percent / 1000)` of its length (power-2 gain curve), and the stored value is always dB. [PORT AU-002] [CAPCUT CC-211]

#### Scenario: Gain mapping
- **WHEN** volume is −6 dB
- **THEN** the element's samples are multiplied by 0.501 (±0.001)

#### Scenario: Range clamp
- **WHEN** the user types 35 into the Volume field
- **THEN** the stored volume is 20 dB

#### Scenario: Minimum is silence
- **WHEN** volume is −60 dB
- **THEN** the element contributes no signal and the field shows "−∞ dB"

#### Scenario: Nudge
- **WHEN** the user invokes `audio.volume-up` three times on a clip at 0 dB
- **THEN** the volume is 0.3 dB

#### Scenario: Touch slider mapping
- **WHEN** the mobile Volume slider is set to 200 %
- **THEN** the stored volume is +6.02 dB (±0.01) and the sheet shows "200 %" with "+6.0 dB" beside it

#### Scenario: Touch slider extremes
- **WHEN** the mobile Volume slider is dragged to its minimum and then to its maximum
- **THEN** the stored volume is −60 dB (shown "0 %", "−∞ dB") and then +20 dB (shown "1000 %")

### Requirement: Volume line on clips
This requirement is the single definition of the volume line; `timeline-editing.Audio clip rendering and volume line` references it. Audio elements, and video and compound elements with enabled source audio, SHALL show a horizontal volume line: on audio clips across the clip body, on video and compound clips inside the 16 px waveform strip; the line is drawn only when the track row is at least 24 px high (otherwise volume is edited in the inspector only). With `y` the distance from the top of the drawing area and `h` its height, the line position SHALL satisfy `gain = (1 − y / h)² × 10`, with the result clamped to −60…+20 dB (top = +20 dB, 0 dB at `y = 0.684 h`, bottom = silence). The line SHALL have a 14 px hit area (32 px on mobile), SHALL be draggable vertically in 0.1 dB steps with a tooltip "x.x dB", SHALL select the element on pointer down, SHALL snap to 0 dB within 3 px unless Shift is held, SHALL reset to 0 dB on double-click, and SHALL preview live and commit one undo step. When volume has keyframes the straight line SHALL be replaced by the automation envelope drawn through the keyframes, with a draggable point at each keyframe (vertical drag changes that keyframe's value; horizontal movement is ignored; double-click on a point removes that keyframe). [PORT AU-002, A-002] [CAPCUT CC-211, CC-223] [NEW]

#### Scenario: Drag the line
- **WHEN** the user drags the line downward until the tooltip reads "−12.0 dB" and releases
- **THEN** the element's volume is −12 dB and one undo returns it to its previous value

#### Scenario: Line position
- **WHEN** a clip's volume is 0 dB and its drawing area is 50 px high
- **THEN** the line is drawn 34 px (±1 px) from the top

#### Scenario: Double-click resets
- **WHEN** the user double-clicks the line of a clip at −9 dB that has no volume keyframes
- **THEN** the volume is 0 dB as one undo step

#### Scenario: Keyframed volume shows an envelope
- **WHEN** volume has keys 0 dB at 0 s and −20 dB at 2 s
- **THEN** the clip shows a sloped envelope with two points, and dragging the second point up to −10 dB changes that keyframe to −10 dB

#### Scenario: Video clip with audio
- **WHEN** a video clip with source audio is on the main track
- **THEN** it shows a volume line inside its waveform strip; a video whose asset has no audio shows none

#### Scenario: Short row
- **WHEN** the track row is 20 px high
- **THEN** no volume line is drawn and the Audio tab's Volume slider still edits the value

### Requirement: Volume keyframes
`volume` SHALL be keyframable with linear, hold and bezier interpolation in dB per `keyframe-animation.Interpolation types`, on audio elements and on video and compound elements with audio (path `volume` of `project-document.Animatable property paths`). During playback and export, gain SHALL be evaluated at least once per 64 samples from the resolved dB value and interpolated per sample between evaluations, so that no step larger than 0.1 dB occurs between consecutive samples on a continuous segment. [PORT A-002] [CAPCUT CC-223]

#### Scenario: Linear ramp in dB
- **WHEN** volume has keys 0 dB at 0 s and −20 dB at 2 s (linear)
- **THEN** the gain at 1 s corresponds to −10 dB

#### Scenario: No zipper noise
- **WHEN** a 1 kHz tone is rendered through that ramp
- **THEN** consecutive output samples never differ in applied gain by more than 0.1 dB

### Requirement: Clip mute and track mute
Each audio element and each video or compound element with audio SHALL have `muted` (default false), toggled from the Audio tab, the element context menu ("Mute" / "Unmute") and the action `audio.mute.toggle`. Each audio track, and each video track for the source audio of its clips, SHALL have a `muted` toggle in its header. A muted element or an element on a muted track SHALL contribute no signal to playback, mixdown and metering. A muted element SHALL be drawn with its waveform at the muted-waveform opacity token of `design-system.Timeline atoms` (35 %) and a muted-speaker icon in its header; a muted track's header icon SHALL be highlighted. Each toggle SHALL be one undo step. Mobile entries (per-clip mute and the main track's "Mute clip audio" toggle) are owned by `mobile-editor.Mute-all and cover entries`; this capability defines their effect: "Mute clip audio" mutes every main-track clip when at least one is unmuted and otherwise unmutes all of them, as one undo step. [PORT AU-003] [CAPCUT CC-214]

#### Scenario: Mute a clip
- **WHEN** the user mutes an audio element
- **THEN** it is silent in playback and export, its waveform dims and its header shows the muted icon

#### Scenario: Mute a track
- **WHEN** an audio track is muted
- **THEN** every element on it is silent while each element's own `muted` value is unchanged

#### Scenario: Main-track mute on mobile
- **WHEN** the user taps "Mute clip audio" on the main track with three unmuted clips
- **THEN** all three clips become muted in one undo step and the toggle shows its active state

### Requirement: Track volume, pan and solo
Each audio track, and each video track for its clips' source audio, SHALL have `volume` −60…+12 dB (default 0, −60 = silence), `pan` −100 (left) … +100 (right) (default 0) and `solo` (default false). Track gain SHALL be applied after clip gain and fades. Pan SHALL use an equal-power law: left gain `cos(θ)`, right gain `sin(θ)` with `θ = (pan + 100) / 200 × π/2`, normalised so that pan 0 leaves a stereo signal unchanged. When any track is soloed, only soloed tracks SHALL be audible in playback; solo SHALL NOT affect export, and `export-share.Export audio checks and credits` shows the notice "Solo is ignored when exporting" when any track is soloed. On desktop/web the controls SHALL be in the track header (mute and solo buttons always visible; volume and pan in the header's expanded state or context popover); on mobile (iOS and Android) they SHALL be in the track's row of the "Tracks" tab of `mobile-editor.Layers sheet` (Mute, Solo, Volume, Pan). `muted`, `solo`, `volume` and `pan` are the track fields of `project-document.Track fields`, present on video and audio tracks. Volume, pan and mute changes SHALL be undoable; `solo` is a document field that is saved and synchronised with the project and emits a state patch, but toggling it creates no undo step. Agents set the four fields through `jc_track_edit`. [CAPCUT CC-214] [NEW]

#### Scenario: Solo one track
- **WHEN** two audio tracks play and the user solos the first
- **THEN** only the first track and no source audio from video tracks is heard in playback

#### Scenario: Solo does not affect export
- **WHEN** the user exports with the first track soloed
- **THEN** the exported audio contains all unmuted tracks

#### Scenario: Hard-left pan
- **WHEN** a track's pan is −100
- **THEN** the right channel of that track's contribution is silent

#### Scenario: Track volume range
- **WHEN** the user types 20 into a track's volume field
- **THEN** the stored track volume is 12 dB

#### Scenario: Solo is saved but not undoable
- **WHEN** the user solos a track, closes and reopens the project and presses undo
- **THEN** the track is still soloed after reopening, and undo reverts the edit made before the solo, not the solo

### Requirement: Clip pan
Each audio element and each video or compound element with audio SHALL have `pan` −100…+100, step 1, default 0, keyframable, using the equal-power law of `Track volume, pan and solo`, applied after clip volume and fades and before track processing. Mono sources SHALL be centred at pan 0. [NEW]

#### Scenario: Mono source centred
- **WHEN** a mono voice recording plays with pan 0
- **THEN** left and right outputs are identical

#### Scenario: Animated pan
- **WHEN** pan has keys −100 at 0 s and +100 at 2 s
- **THEN** at 1 s left and right levels are equal

### Requirement: Video source audio
A video element whose asset has audio SHALL play that audio through the element's volume, mute, pan, fades, retime and processing settings, unless `isSourceAudioEnabled` is false. The Audio tab SHALL be hidden for a video whose asset has no audio. While an asset's `hasAudio` is undefined (a migrated classic asset that has not yet been probed, see `media-library.Media asset model`) it SHALL be treated as having audio. Sources with more than two channels SHALL be downmixed to stereo (front left/right at 1.0, centre at 0.707 to both, surrounds at 0.707 to their side, LFE discarded). [PORT AU-004]

#### Scenario: Video with audio
- **WHEN** a video with a stereo track is on the timeline
- **THEN** its audio is heard in sync with the picture within 1 frame

#### Scenario: Video without audio
- **WHEN** a silent video asset (`hasAudio: false`) is selected
- **THEN** no Audio tab, volume line or waveform is shown for it

#### Scenario: Unprobed classic asset
- **WHEN** a migrated classic video asset has no `hasAudio` value yet
- **THEN** the Audio tab and the volume line are shown, and after the probe reports `hasAudio: false` they are hidden

#### Scenario: 5.1 source
- **WHEN** a video with a 5.1 audio stream plays
- **THEN** its centre channel is heard equally in left and right at −3 dB and the LFE channel is not heard

### Requirement: Audio fades
Audio elements and video or compound elements with audio SHALL have `fadeIn` and `fadeOut`, each `{duration, shape}`. `duration` is in ticks, frame-aligned, 0 (default, no fade) up to the element's duration, with `fadeIn.duration + fadeOut.duration ≤ element duration`; a requested value beyond the limit SHALL be clamped. The Audio tab SHALL show "Fade in" and "Fade out" sliders with numeric fields in seconds (step 0.1 s, slider range 0–10 s, field accepts up to the limit) and a shape select for each. Fade gain SHALL multiply the clip gain (including keyframed volume). At an element end that carries an audio crossfade record, or the paired crossfade of a picture transition (`transitions.Audio crossfade pairing`), the crossfade replaces that end's fade in the mix while it exists. Fades SHALL be applied identically in playback and export, and are measured in timeline time regardless of retime. The mobile Fade sheet (entry owned by `mobile-editor.Audio group and audio clip strips`) SHALL show both sliders. Each change SHALL be one undo step. [PORT N-004] [CAPCUT CC-212, CC-213]

#### Scenario: Fade in
- **WHEN** a clip has a 2 s linear fade in
- **THEN** its gain is 0 at local 0 s, 0.5 at 1 s and 1 from 2 s on

#### Scenario: Fades cannot overlap
- **WHEN** a 3 s clip has a 2 s fade in and the user sets fade out to 2 s
- **THEN** fade out is clamped to 1 s

#### Scenario: Trim shorter than the fades
- **WHEN** a clip with 1 s fade in and 1 s fade out is trimmed to 1 s
- **THEN** both fades become 0.5 s in the same undo step as the trim

### Requirement: Fade curve shapes
A fade's `shape` SHALL be one of the following, where `p` is progress 0–1 through a fade in (a fade out uses the gain for `1 − p`):

| Shape | Gain | Default for |
|---|---|---|
| `linear` | `p` | — |
| `equal-power` | `sin(p × π/2)` | fades and crossfades |
| `s-curve` | `p² × (3 − 2p)` | — |
| `logarithmic` | `log10(1 + 9p)` | — |
| `exponential` | `p²` | — |

[PORT N-004] [NEW]

#### Scenario: Equal-power midpoint
- **WHEN** a fade in with shape `equal-power` is at 50% progress
- **THEN** the gain is 0.707 (±0.005)

#### Scenario: Exponential midpoint
- **WHEN** the shape is `exponential` at 50% progress
- **THEN** the gain is 0.25

### Requirement: Fade handles on clips
On desktop/web, a selected or hovered audio-capable clip at least 48 px wide SHALL show a round 10 px fade handle at each top corner. Dragging the left handle to the right sets `fadeIn.duration`, and the right handle to the left sets `fadeOut.duration`, frame-snapped, with a tooltip "Fade in 1.2s" / "Fade out 1.2s", live preview and one undo step. The faded region SHALL be drawn as a curve matching the shape, shading the area above it, and the waveform height SHALL follow the fade gain. Double-clicking a handle SHALL reset that fade to 0. On mobile, fades SHALL be drawn but edited only through the Fade sheet. [PORT N-004] [CAPCUT CC-212, CC-213] [NEW]

#### Scenario: Drag the fade-in handle
- **WHEN** the user drags the left handle 1.2 s to the right
- **THEN** `fadeIn.duration` is 1.2 s and the waveform tapers over the first 1.2 s

#### Scenario: Reset by double-click
- **WHEN** the user double-clicks the fade-out handle
- **THEN** `fadeOut.duration` is 0

### Requirement: Crossfades
Between two exactly adjacent audio elements on the same audio track, the user SHALL be able to add a crossfade with the context-menu item "Add crossfade" on the cut, the action `audio.crossfade.add` (applies to the cut nearest the playhead on the selected track), or by dragging one clip's fade handle across the cut. A crossfade SHALL be stored as a record of `kind: "crossfade"` in the audio track's `transitions[]` array — `{id, kind, fromElementId, toElementId, duration, shape}`, mirrored by the outgoing element's `transitionOut` and the incoming element's `transitionIn` — whose shape is defined only by `project-document.Track transition records`; there is no `crossfades[]` array. It is centred on the cut, with a frame-aligned duration from 2 frames (and at least 0.05 s) to 10 s (default 0.5 s) and shape `equal-power` by default. During the crossfade the outgoing element SHALL continue into its source handle while fading out and the incoming element SHALL start early from its handle while fading in; where a handle is shorter than half the duration, that side SHALL contribute silence beyond its boundary and the crossfade marker SHALL show a warning dot. The crossfade's half inside each element SHALL NOT overlap that element's own fade at the same end; while a crossfade exists it REPLACES the outgoing element's `fadeOut` and the incoming element's `fadeIn` in the mix; the stored fade values are kept, their handles at that cut are drawn dimmed, and they apply again when the crossfade is removed (the same rule as `transitions.Audio crossfade pairing`). The marker SHALL be an X-shaped overlay across the cut, selectable, resizable by its edges and removable with Delete. Moving, trimming or deleting either element so that they are no longer adjacent SHALL remove the crossfade in the same undo step. The pairing of a picture transition with a crossfade of the two clips' source audio is defined in `transitions.Audio crossfade pairing` and uses the shapes of `Fade curve shapes`. [PORT N-004] [NEW]

#### Scenario: Equal-power crossfade keeps level
- **WHEN** two adjacent clips of the same steady tone, each with sufficient handles, are crossfaded
- **THEN** the mixed level at the midpoint is within 0.5 dB of the level outside the crossfade

#### Scenario: Missing handle
- **WHEN** the incoming clip starts at the very beginning of its source
- **THEN** the incoming side is silent before the cut and the marker shows a warning dot

#### Scenario: Adjacency broken
- **WHEN** the user moves the incoming clip away
- **THEN** the crossfade is removed, and undo restores the position and the crossfade

#### Scenario: Stored as a track transition record
- **WHEN** a crossfade is added between audio elements A and B
- **THEN** the audio track's `transitions` array holds one record with `kind: "crossfade"`, `fromElementId` = A's id, `toElementId` = B's id, a `duration` and a `shape`, and `A.transitionOut` and `B.transitionIn` equal its `id`

#### Scenario: Minimum duration
- **WHEN** the user drags a crossfade's edge inward as far as possible on a 30 fps project
- **THEN** the duration stops at 2 frames

### Requirement: Extract audio from video
With one or more video elements selected whose assets have audio and whose source audio is enabled, "Extract audio" (timeline toolbar, context menu, action `audio.extract.toggle`; mobile entry: the "Extract" item of `mobile-editor.Audio group and audio clip strips`; agent tool `jc_clip_detach_audio`) SHALL, for each: create an audio element with `sourceType: "upload"` referencing the same media (`mediaId` of the video asset) with the same start time, duration, trims and retime; copy `volume`, `muted`, `pan`, fades, processing settings and volume and pan keyframes to it; reset the video's audio params to defaults; set `isSourceAudioEnabled = false` on the video; place the audio element on the first audio track with free space for its range, or a new audio track; and give both elements the same new `linkId`, whose behaviour (select-both, linked move, trim, split, delete, duplicate and retime, Link and Unlink, single-member selection) is defined by `timeline-editing.Video and audio linking`. This requirement and `Recover audio into video` are the single definition of extract and recover. The whole action SHALL be one undo step. The button SHALL be disabled, with the tooltip "Select a video clip that has audio", when no selected element qualifies. Extracted audio SHALL NOT create a new media asset. [PORT AU-001] [CAPCUT CC-208]

#### Scenario: Extract
- **WHEN** the user extracts audio from a 10 s video clip trimmed to 2 s–8 s with volume −3 dB
- **THEN** an audio element covering the same 6 s range with volume −3 dB exists on an audio track, the video plays silently, and both share a `linkId`

#### Scenario: Audio is not doubled
- **WHEN** playback runs after extraction
- **THEN** the sound is heard once, at the same level as before extraction

#### Scenario: No audio in the asset
- **WHEN** only a silent video is selected
- **THEN** the action is disabled with the stated tooltip

### Requirement: Recover audio into video
"Recover audio" on a video element whose source audio is disabled SHALL set `isSourceAudioEnabled = true`, and when an audio element with the same `linkId` still exists it SHALL copy that element's volume, mute, pan, fades, processing and keyframes back to the video, delete the linked audio element and clear the `linkId`, all in one undo step. When the linked audio element no longer exists, only the flag SHALL be restored. This replaces the classic behaviour of re-enabling the flag while leaving the extracted element in place. [PORT AU-004] [CAPCUT CC-208] [NEW]

#### Scenario: Recover with the linked element present
- **WHEN** the user recovers audio on a video whose extracted audio was lowered to −9 dB
- **THEN** the extracted element is removed, the video's volume is −9 dB and the sound is heard once

#### Scenario: Linked element already deleted
- **WHEN** the extracted element was deleted earlier
- **THEN** the video's source audio is re-enabled with its current audio params

### Requirement: Voiceover recording
The voiceover recorder SHALL be opened from the timeline toolbar "Record" button (desktop/web) and from the "Voiceover" item of `mobile-editor.Audio group and audio clip strips` (mobile). It SHALL offer: input device select (default: the "Default voiceover input device" preference, else the system default), an input level meter, a 3-second countdown switch (default on), "Mute project while recording" (default on), "Enhance voice" (default off) and a Record/Stop button. Recording SHALL start at the playhead after the countdown, play the timeline while recording, capture mono at 48 000 Hz with echo cancellation, noise suppression and automatic gain control all off, and draw the growing clip and waveform live. Stop (button, Space or Escape) SHALL end recording, store the take as a media asset named "Voiceover {n}" (WAV, 24-bit PCM, mono, 48 000 Hz on desktop — macOS, Windows and Linux — on iOS and Android, and on web when the browser delivers PCM capture; Opus at 128 kbit/s or higher in WebM on web otherwise), and insert an audio element at the recording start on the first audio track free for the range (or a new track), as one undo step. Recording SHALL stop automatically at 2 hours and keep the take. Recorded latency SHALL be compensated by the input latency, whose source is defined per platform: on desktop (macOS, Windows, Linux) and on mobile (iOS, Android) the input latency reported by the platform audio API for the chosen device, so that the take aligns with the timeline within 20 ms; on web `MediaTrackSettings.latency` plus the output latency of the audio context when the browser reports them (alignment within 20 ms), otherwise the value of a one-time loopback calibration offered in the recorder ("Calibrate": plays three clicks and measures their return; stored per input device in device preferences; alignment within 20 ms), and otherwise 0 with the alignment tolerance relaxed to 60 ms and the hint "Calibrate for tighter sync". With "Enhance voice" on, the take SHALL have `Enhance voice` enabled at strength 50 when inserted. A take's `isVoice` field (`Equaliser, compressor and ducking`) SHALL be true when inserted. [CAPCUT CC-209, CC-210]

#### Scenario: Record a take
- **WHEN** the user records for 5 s starting at 00:10 with the countdown on
- **THEN** after "3, 2, 1" the timeline plays from 00:10, and on Stop a 5 s audio element starting at 00:10 exists with a new "Voiceover 1" asset

#### Scenario: Microphone permission denied
- **WHEN** the operating system or browser denies microphone access
- **THEN** no recording starts and the recorder shows "Microphone access is blocked. Allow it in system settings." with a button that opens the relevant settings where the platform allows

#### Scenario: Mute project
- **WHEN** "Mute project while recording" is on
- **THEN** timeline audio is silent during the take while the playhead advances, and it is audible again after Stop

#### Scenario: No input device
- **WHEN** no audio input device exists
- **THEN** the Record button is disabled with "No microphone found"

#### Scenario: Latency compensation
- **WHEN** the timeline plays a click at 00:12.000 through a loopback cable into the recording input during a take
- **THEN** the click in the inserted take sits within 20 ms of 00:12.000 on the timeline

#### Scenario: Two-hour stop
- **WHEN** a recording reaches 2 hours
- **THEN** recording stops, the 2-hour take is inserted as if Stop had been pressed, and a toast reads "Recording stopped at the 2-hour limit"

#### Scenario: Device lost during a take
- **WHEN** the input device is unplugged 30 s into a recording
- **THEN** recording stops, the 30 s captured so far is kept and inserted, and a toast reads "Microphone disconnected. Your recording was saved."

#### Scenario: Browser without a reported latency
- **WHEN** a browser reports no input latency and no calibration is stored
- **THEN** the take is inserted with no compensation, sits within 60 ms of the timeline, and the recorder shows "Calibrate for tighter sync"

### Requirement: Sounds library panel
This capability is the single owner of the sounds browsing and search UI. The assets panel "Audio" tab (tab id and label owned by `app-shell-navigation.Editor asset panel tabs`; mobile entries "Sounds" and "Sound FX" owned by `mobile-editor.Audio group and audio clip strips`) SHALL have the sub-tabs Music, Sound effects and Saved, a source selector, a row of category chips, a search field, a sort select and a "Commercial use only" switch (default on). The source selector SHALL list "Bundled" first and selected by default (`Bundled sound pack`; works with no host and no network on every platform), then the sources of `Music provider slots`. Category chips: on Music the 8 moods and on Sound effects the 12 categories of `catalog.md`; with source "Bundled" a chip filters the pack by category, and with an online source it adds that category's tag query from `catalog.md` to the search. Each result row SHALL show name, author, duration, licence short name, a play/pause button, a save (heart) toggle and an add ("+") button. With an online source selected and no host connected the list SHALL show "Connect a host to browse online sounds" with a connect button; with a host that has no Freesound key, "Add your Freesound API key to browse Freesound" with a button to the key setting of `generation-providers.Provider connection`; in both states the Bundled source, the Saved sub-tab and importing own audio keep working. The sort select (Best match, Most downloaded, Highest rated, Newest) and the "Commercial use only" switch SHALL be hidden for the Bundled source, which is sorted by category then title. [PORT AU-008] [CAPCUT CC-205, CC-206]

#### Scenario: First run with no host
- **WHEN** the editor runs in a browser with no host connection and the user opens the Audio tab
- **THEN** the source is "Bundled", the Music sub-tab lists the 40 bundled tracks and the Sound effects sub-tab lists the 120 bundled effects, each playable and addable

#### Scenario: Online source without a host
- **WHEN** the user switches the source to Freesound with no host connected
- **THEN** the list shows the connect state, and switching back to Bundled lists the pack again

#### Scenario: Key missing
- **WHEN** a host is connected but has no Freesound key and the Freesound source is selected
- **THEN** the list shows the key message and no search request is sent

#### Scenario: Category chip on the bundled pack
- **WHEN** the source is Bundled and the user taps the "Whoosh" chip on Sound effects
- **THEN** exactly the 10 bundled Whoosh effects are listed

### Requirement: Bundled sound pack
The app SHALL ship a starter sound pack that works with no host on desktop (macOS, Windows, Linux), web and mobile (iOS, Android): exactly 40 music tracks (8 moods × 5 tracks, each 30–180 s) and exactly 120 sound effects (12 categories × 10 effects, each 10 s or shorter), enumerated in `catalog.md` next to this spec, which is normative for `{id, title, category, duration, bpm and key (music), tags, licence, origin, sourceUrl}`.

**Production status.** At the time this specification is written no audio file of the pack exists: the catalogue is the commissioning brief (titles, moods, tempo, key, duration, tags), not an inventory. The pack is therefore a release deliverable with its own gate (below), and nothing in the product presents a catalogue row whose file is absent: a build without the complete pack fails.

**Source and licence.** Each item is either (a) authored for this project (composed, performed, synthesised or recorded by a contributor who signs a CC0-1.0 dedication recorded in `docs/product/ASSET-PROVENANCE.md`; `origin: "authored"`, `sourceUrl` = the repository path of the item's source session or stem files) or (b) a third-party work published under CC0-1.0 whose `sourceUrl` resolves to the original publication (`origin: "third-party"`, with the author's name and the retrieval date in the provenance file). No other licence is accepted, the pack SHALL NOT contain third-party commercial music, and no item is generated by a model whose output terms restrict commercial use.

**Format.** AAC-LC in an MP4 container (`.m4a`), 48 000 Hz; music stereo at 128 kbit/s; effects mono (stereo where the catalogue title says so) at 96 kbit/s; each with a precomputed waveform summary (`media-library.Waveform summaries`) and, for music, precomputed beat markers in the format of `Beat markers on audio`.

**Per-item acceptance (checked by the build for every file).** Duration within ±1 s (music) or ±0.05 s (effects) of the catalogue; music integrated loudness −16 ± 1 LUFS and true peak at most −1 dBTP (measured as in `Loudness normalisation`); effect sample peak −3 ± 1 dBFS; no run of 3 or more consecutive full-scale samples; music tempo detected by `Automatic beat detection` within 1 BPM of the catalogue (or of its double or half); at most 50 ms of leading silence; and a listening review recorded per item in `ASSET-PROVENANCE.md` (reviewer, date, and confirmation that mood, key and title fit).

**Release gate.** The build SHALL fail when: the manifest `assets/jagentchill-sounds/manifest.json` (fields `id, title, category, kind, duration_ms, bpm?, key?, beats?, tags, licence, origin, author, sourceUrl, sha256, bytes`) does not have exactly the 160 catalogue ids; a file is missing, has no manifest entry or does not match its `sha256`; an entry lacks `licence`, `sourceUrl` or its provenance row; any per-item acceptance check fails; or a size budget is exceeded.

**Size budget and delivery.** The complete pack is at most 90 MB (music at most 82 MB for the catalogue's 4 964 s, effects at most 4 MB). Desktop: the complete pack is inside the app bundle on macOS, Windows and Linux. Mobile (iOS and Android): the app bundle contains all 120 effects and the first track of each mood (8 tracks), at most 24 MB; the other 32 tracks are listed with a download glyph and are fetched from the content host of `security-privacy.Network egress control` on first preview or add (after that row's one-time consent on the device), verified against the manifest `sha256` and then kept offline. Web: the pack is cacheable static assets of the web build, each fetched on first preview or add and then kept offline. Host: a host installs the complete pack with JAgentChill Server (`packages/content`).

Bundled items SHALL carry the normalised licence `cc0`, need no attribution, and pass the "Commercial use only" filter. Adding one follows `Add a library sound to the timeline` with the pack as the source and `sourceType: "bundled"`. [CAPCUT CC-205, CC-206] [NEW]

#### Scenario: Pack size
- **WHEN** the app is installed and started offline
- **THEN** the Bundled source lists exactly 40 music tracks in 8 moods of 5 and exactly 120 sound effects in 12 categories of 10, and on desktop every one of them plays

#### Scenario: Add offline
- **WHEN** the user presses "+" on a bundled track that is on the device, with no network
- **THEN** an audio element with that track is inserted at the playhead and plays

#### Scenario: Music has beats
- **WHEN** a bundled music track is added to the timeline
- **THEN** its element already has beat markers and the Beats tool shows the catalogue's BPM

#### Scenario: Build gate
- **WHEN** a pack audio file is added without a manifest entry, an entry has an empty `licence`, or a catalogue id has no audio file
- **THEN** the build fails and names the file, entry or id

#### Scenario: Loudness gate
- **WHEN** a music file measures −12.5 LUFS integrated
- **THEN** the build fails and names the item and the measured value

#### Scenario: Tempo gate
- **WHEN** the file of `mus-upbeat-01` (catalogue 124 BPM) is detected at 118 BPM
- **THEN** the build fails and names the item

#### Scenario: Mobile bundle
- **WHEN** the app is installed on an iOS or Android phone and started offline
- **THEN** all 120 effects and 8 music tracks (one per mood) play, the other 32 tracks are listed with a download glyph, and tapping one offline shows "Connect to the internet to download this track"

#### Scenario: Licence check treats the pack as CC0
- **WHEN** a scene uses two bundled sounds and the user opens "Licence check"
- **THEN** both rows show "CC0" with no attribution or non-commercial flag

### Requirement: Bundled pack as the built-in music and sound-effect source
The bundled pack SHALL be a built-in source for the roles `music` and `sfx`, so that a workflow, the one-prompt template and the film pipeline always have a route for those two roles even when no provider is configured (design D12; the consumer contracts are `agent-editing-tools.Stock and library search tools` for `jc_stock_search` with provider `bundled`, and the built-in `library` profile of the roles `music` and `sfx` in `orc-model-routing.Default profiles from the enabled catalogue`, served by the provider `jc-sound-pack` of `generation-providers.Provider registry by capability type`). This capability defines the search function those consumers call, on the device and on the host alike: `searchBundledSounds({kind: "music" | "sfx", query, category?, minDuration_s?, maxDuration_s?, bpmMin?, bpmMax?, limit (1–50, default 10)})` returns catalogue entries ranked by a deterministic keyword score — the query is lower-cased, split on whitespace and punctuation, and each term scores 3 for an exact match of a `tags` entry or of the category name, 2 for a whole-word match in the title, and 1 for a substring match in the title or a tag; the score of an entry is the sum over terms; entries with score 0 are omitted unless the query is empty (then all entries of the kind, filtered by the other parameters, are returned in catalogue order); ties are ordered by catalogue order. The function reads only the manifest and makes no network request. A result that a host-side consumer selects is imported into the project as a media asset with `sourceType: "bundled"` and licence `cc0`, exactly as when a user adds it. When the best score is 0 for a non-empty query the function returns an empty list and the consumer's own rule applies (a workflow node resolves to `skipped`, design D12). [NEW]

#### Scenario: Keyword search
- **WHEN** `searchBundledSounds({kind: "sfx", query: "whoosh fast"})` is called
- **THEN** the ten Whoosh effects are returned first, with "Fast Pass By" ranked above the others because it also matches "fast" in its title

#### Scenario: Works on a host with no provider
- **WHEN** a workflow's music node runs on a host where the `music` role has no provider route, with the mood "chill"
- **THEN** the node receives the five Chill tracks from the bundled pack and no provider call is made

#### Scenario: No match
- **WHEN** the query is "bagpipes" and no tag, category or title matches
- **THEN** an empty list is returned

### Requirement: Sound search proxy
Online sound search SHALL use only the server HTTP route defined by `server-api.Sound search proxy` (`GET /jagentchill/v1/sounds/search`, signed per `server-api.Authenticated media delivery`); this capability defines no RPC, no route and no server-side behaviour, and the Freesound key never reaches the client. The panel SHALL send these query parameters and no others: `q` (the search text, trimmed, with the active category chip's tag query appended), `type` (`music` on the Music sub-tab, `effects` on the Sound effects sub-tab), `page`, `page_size` (50 for the first page of an empty query, otherwise 20), `sort` (exactly the route's values: `relevance` for "Best match", `downloads` for "Most downloaded", `rating` for "Highest rated", `created` for "Newest"; the classic value `score` is not sent, because the route answers `INVALID_PARAMS` for it; the select defaults to "Most downloaded" when `q` is empty and to "Best match" otherwise), `min_rating` (3) and `commercial_only` (the switch). The client sends neither `min_duration_s` nor `max_duration_s` nor any tag filter of its own. Parameter ranges, caching, rate limits and the per-type filters have ONE owner, `server-api.Sound search proxy`, which states and applies them (`effects`: duration at most 30 s and one of its ten effect tags; `music`: duration 30–600 s and one of its five music tags); this capability neither defines nor repeats their values as normative, and a CI contract test SHALL call the route's parameter schema with every value this panel can send and fail on any `INVALID_PARAMS`. The panel SHALL map the route's errors as follows: `RATE_LIMITED` → "Too many searches. Try again in {n}s." using `details.retryAfter_ms`, with the search field disabled for that time; `INVALID_PARAMS` → "Couldn't load sounds" (and a diagnostic naming the parameter); `UNAVAILABLE` with `details.reason: "freesound_key_missing"` → "Online sounds are not set up on this host" (with "Open host settings" on an `admin` device and no Retry); any other `UNAVAILABLE` → "The sound service is not responding" with Retry; `EGRESS_BLOCKED` → "Online sound search is turned off on this host" (no Retry); `SCOPE_DENIED` → "This device isn't allowed to browse online sounds". [PORT AU-008, AU-015] [CAPCUT CC-205, CC-206] [NEW]

#### Scenario: Music search works
- **WHEN** the user types "piano" on the Music sub-tab with Freesound selected
- **THEN** one request `GET /jagentchill/v1/sounds/search?q=piano&type=music&page=1&page_size=20&sort=relevance&min_rating=3&commercial_only=true` is sent and its results are listed (no "coming soon" or not-implemented state)

#### Scenario: Rate limit
- **WHEN** the route answers `RATE_LIMITED` with `details.retryAfter_ms = 12000`
- **THEN** the UI shows "Too many searches. Try again in 12s." and sends no search request for 12 s

#### Scenario: Upstream failure
- **WHEN** the route answers `UNAVAILABLE` with `details.upstreamStatus = 503`
- **THEN** results already shown stay visible and the message with Retry is shown

#### Scenario: No Freesound key on the host
- **WHEN** the route answers `UNAVAILABLE` with `details.reason = "freesound_key_missing"`
- **THEN** the panel shows "Online sounds are not set up on this host" without Retry, and the Bundled source remains usable

#### Scenario: Every sort option is accepted by the route
- **WHEN** the contract test sends one request per sort option of the select ("Best match", "Most downloaded", "Highest rated", "Newest") to the route's parameter validator
- **THEN** the values sent are `relevance`, `downloads`, `rating` and `created`, and none is answered with `INVALID_PARAMS`

### Requirement: Sound licence filter
The licence rule for online sounds is defined here and applied by the route of `server-api.Sound search proxy`. When `commercial_only` is true results SHALL be restricted to the licences "Creative Commons 0" and "Attribution"; when false "Attribution NonCommercial" SHALL additionally be allowed. "Sampling+" and any unrecognised licence SHALL always be excluded. Each result's `licence` SHALL be normalised to `cc0`, `cc-by` or `cc-by-nc`, and the row SHALL show "CC0", "CC BY" or "CC BY-NC"; `cc-by-nc` rows SHALL carry a "Non-commercial" tag. A result whose `licence` is none of the three normalised values SHALL NOT be shown by the client. Toggling the switch SHALL re-run the current search from page 1. Bundled items are `cc0` (`Bundled sound pack`). [PORT AU-008] [NEW]

#### Scenario: Commercial only
- **WHEN** the switch is on
- **THEN** the request carries `commercial_only=true` and no listed result has licence `cc-by-nc`

#### Scenario: Switch off
- **WHEN** the user turns "Commercial use only" off
- **THEN** a new request is sent with `commercial_only=false` from page 1 and rows with licence `cc-by-nc` are listed with the "Non-commercial" tag

#### Scenario: Unrecognised licence
- **WHEN** a response row carries `licence: "sampling+"`
- **THEN** that row is not shown

### Requirement: Sound browsing, search and pagination
With an online source selected, opening the Sound effects or Music sub-tab with an empty query SHALL load the 50 most-downloaded results for that type. Typing in the search field SHALL send a request 300 ms after the last keystroke and cancel any request still in flight; a query longer than the route's limit SHALL be truncated to that limit before sending. Scrolling within 400 px of the end of the list SHALL request the next page (page size 20 after the initial load) and append its results without duplicates (deduplicated by id), until `count` results have been loaded; a spinner row SHALL show while a page loads and "End of results" after the last page. The list SHALL keep its scroll position when the user switches tabs and returns. Loading SHALL show 8 skeleton rows; no results SHALL show "No sounds found for "{query}""; a failed request SHALL show "Couldn't load sounds" with Retry, keeping results already shown. With the Bundled source, search SHALL filter the pack locally by case-insensitive substring match on title and category with no request. [PORT AU-009, AU-010] [CAPCUT CC-205, CC-206]

#### Scenario: Initial list
- **WHEN** the Sound effects sub-tab opens with an empty query and the Freesound source
- **THEN** 50 results sorted by downloads are shown

#### Scenario: Infinite scroll appends
- **WHEN** the user scrolls to the end of the first 50 results and `count` is 500
- **THEN** results 51–70 are appended, the total shown is 70 and no id appears twice

#### Scenario: Debounced search
- **WHEN** the user types "rain" quickly as four keystrokes within 200 ms
- **THEN** exactly one request with `q=rain` is sent, 300 ms after the last keystroke

#### Scenario: Page load failure
- **WHEN** the request for the next page fails
- **THEN** the already loaded results stay visible and a Retry row appears at the end

#### Scenario: Bundled search is local
- **WHEN** the source is Bundled and the user types "click"
- **THEN** only bundled items whose title or category contains "click" are listed and no network request is made

### Requirement: Sound preview playback
Pressing a row's play button SHALL play the sound's preview through the editor's audio output at the master volume, showing a progress ring on the button. Previews of online sounds SHALL be fetched only through the server route `GET /jagentchill/v1/sounds/{id}/preview` (signed per `server-api.Authenticated media delivery`), which serves the high-quality preview and falls back to the low-quality one; the client SHALL NOT contact Freesound or any other third-party host. Previews of bundled sounds play from the app bundle. Only one preview SHALL play at a time: starting another stops the current one, and starting timeline playback stops the preview. A preview that fails to load SHALL show "Preview unavailable" on the row for 3 s. Space with a row focused SHALL toggle its preview. [PORT AU-011]

#### Scenario: One at a time
- **WHEN** a preview is playing and the user plays another row
- **THEN** the first stops and the second starts

#### Scenario: Timeline playback stops the preview
- **WHEN** the user starts timeline playback during a preview
- **THEN** the preview stops

#### Scenario: No third-party request
- **WHEN** the user previews five Freesound results while network requests are captured
- **THEN** every request goes to the paired host and none to a Freesound host

#### Scenario: Preview failure
- **WHEN** the preview route answers with an error
- **THEN** the row shows "Preview unavailable" for 3 s and no other preview is interrupted

### Requirement: Saved sounds
The heart toggle SHALL save or unsave a sound. Saved sounds SHALL be stored in the `saved-sounds` store defined by `project-storage.Stored record layout` (not in the preferences port), as records `{id, source, name, username, duration, tags, licence, sourceUrl, savedAt_ms}` (no preview URL is stored; previews are requested by id), included in device sync through `cross-device-sync.Library item sync`, and listed in the Saved sub-tab newest first with the same row controls. Saved sounds imported from an OpenCut classic bundle (`projects.OpenCut classic data import`) SHALL be converted to this record shape. The Saved sub-tab SHALL have "Clear all" behind a confirm dialog stating the count. At most 1 000 sounds SHALL be saved; beyond that the toggle SHALL be refused with "Saved sounds limit reached (1000)". Empty state: "Sounds you save appear here". The same list SHALL be shown without a project at `/library/sounds` (the Saved sounds category of `app-shell-navigation.Library screen`) with preview, unsave and "Clear all". [PORT AU-012, AU-013]

#### Scenario: Save and reopen
- **WHEN** the user saves a sound and restarts the app
- **THEN** the sound is listed in Saved with a filled heart

#### Scenario: Clear all
- **WHEN** the user confirms "Clear all" with 12 saved sounds
- **THEN** the Saved list is empty and hearts in search results are unfilled

#### Scenario: Limit
- **WHEN** 1 000 sounds are saved and the user taps the heart of another
- **THEN** it is not saved and the stated message is shown

#### Scenario: Works with no host
- **WHEN** no host is connected
- **THEN** the Saved sub-tab lists the saved sounds; bundled ones can be previewed and added, and online ones show "Connect a host to play this sound" on play

### Requirement: Add a library sound to the timeline
The "+" button, a double-click, or dragging a row onto the timeline SHALL obtain the sound's audio (a bundled sound from the app bundle; an online sound's high-quality preview through the server route of `Sound preview playback`), store it as a project media asset (content-addressed, so the same sound is stored once per project) with an attribution record `{name, author, licence, sourceUrl}`, and insert an audio element (`sourceType: "library"` for an online sound, `"bundled"` for a pack sound) at the playhead (or the drop position) on the first audio track free for its range, or a new audio track, as one undo step. The row SHALL show a progress ring during download; a failed download SHALL add nothing and show "Couldn't add "{name}"". Once added, the element SHALL play, export and synchronise without network access. The project's attribution records SHALL be available to `Audio licence check` and to `export-share.Export audio checks and credits` for a credits file. [PORT AU-014] [NEW]

#### Scenario: Add at the playhead
- **WHEN** the user presses "+" on a 4 s sound with the playhead at 00:12
- **THEN** a 4 s audio element starts at 00:12 on an audio track and the project media contains the sound with its attribution

#### Scenario: Works offline afterwards
- **WHEN** the host is disconnected and the project is reopened
- **THEN** the sound still plays and exports

#### Scenario: Added twice
- **WHEN** the same sound is added again
- **THEN** a second element is created and the project still stores one media asset for it

#### Scenario: Download fails
- **WHEN** the server route fails while an online sound is being added
- **THEN** no element and no media asset are created, no undo step is recorded, and the message is shown

### Requirement: Music provider slots
The source selector of `Sounds library panel` SHALL list, in this order: "Bundled" (always present, default); "Freesound" (present when a host is connected; needs a Freesound key); one slot per stock-music provider enabled in `generation-providers.Stock media providers`; "Generate" (Music sub-tab opens the music flow and Sound effects sub-tab the sound-effect flow of `ai-editing-tools.AI music and sound effect generation`, using the `music` or `sfx` role of `orc-model-routing.Role catalogue`; listed only when that role has a generation provider route — the built-in bundled-pack source of `Bundled pack as the built-in music and sound-effect source` does not count, because it generates nothing); and, on the Music sub-tab, "My music" (audio assets in the media library longer than 30 s). Each provider slot SHALL return rows in the same shape as the Freesound source including a normalised licence, and SHALL use the same preview, save and add behaviour through the server. A slot whose provider is not configured SHALL NOT be listed. [PORT AU-015] [CAPCUT CC-205] [NEW]

#### Scenario: Nothing configured
- **WHEN** no host is connected
- **THEN** the selector lists Bundled and, on Music, My music only

#### Scenario: Only Freesound configured
- **WHEN** a host with a Freesound key is connected and no stock-music provider and no `music` route are configured
- **THEN** the Music selector lists Bundled, Freesound and My music

#### Scenario: Generate hand-off
- **WHEN** a `music` route is configured and the user chooses Generate
- **THEN** the music generation flow of `ai-editing-tools.AI music and sound effect generation` opens, and its result is added as an audio asset and an element with `sourceType: "upload"`

### Requirement: Audio licence check
"Licence check" SHALL list every audio source used in the current scene with its origin and licence: bundled and library sounds with their normalised licence and attribution; generated audio as "Generated"; imported and recorded audio as "Your file — licence not known to JAgentChill". Rows with `cc-by-nc` SHALL be flagged "Not for commercial use" and rows with `cc-by` "Attribution required", with a "Copy credits" button that copies a credits text for all attributed sounds. The check SHALL run locally from project data, SHALL NOT upload audio, and SHALL NOT claim to detect copyrighted music by content. Entry points: the Audio tab's toolbar (desktop/web), the "Copyright" item of `mobile-editor.Audio group and audio clip strips` (mobile) and the export dialog section defined by `export-share.Export audio checks and credits`. [CAPCUT CC-222] [NEW]

#### Scenario: Non-commercial sound flagged
- **WHEN** the scene uses one `cc-by-nc` sound and one `cc0` sound
- **THEN** the check lists both and flags the first as "Not for commercial use"

#### Scenario: Copy credits
- **WHEN** the user presses "Copy credits" with two `cc-by` sounds in the scene
- **THEN** the clipboard holds two lines, each with name, author, licence and URL

#### Scenario: No audio
- **WHEN** the scene contains no audio source
- **THEN** the check shows "This scene has no audio" and "Copy credits" is disabled

### Requirement: Waveform rendering
This requirement owns waveform drawing; the stored summary (format, levels, cache key, computation) is owned by `media-library.Waveform summaries`, and `timeline-editing.Audio clip rendering and volume line` references both. Audio elements show the waveform across the clip body; video and compound elements with enabled source audio show it in a 16 px strip at the bottom of the clip. Bars SHALL be 1 px wide with a 1 px gap, drawn only for the visible region at the device pixel ratio, mapped through trim and `speed-retime.Retime time map`, with height `((dB + 40) / 40)^1.5` of the drawing height and a −40 dB floor, scaled by the element's gain (volume, keyframes and fades) sampled at 200 or more positions across the visible part of the clip, and with a cap in the `waveform/clip` token of `design-system.Editor colour tokens` on any bar whose output exceeds 1.0. While a summary is being computed the clip SHALL show a shimmer placeholder; when the summary cannot be produced the clip SHALL show a flat line and a warning icon with the tooltip "Couldn't read audio". Waveforms SHALL update within 100 ms of a volume, fade, trim or speed change. [PORT AU-005] [NEW]

#### Scenario: Clipping cap
- **WHEN** a full-scale clip's volume is raised to +6 dB
- **THEN** its tallest bars show the `waveform/clip` cap

#### Scenario: Bar height
- **WHEN** a region's peak is −20 dB at clip volume 0 dB in a 40 px drawing height
- **THEN** its bars are 14 px high (±1 px), and a region at −40 dB or below has the minimum 1 px bar

#### Scenario: Summary still computing
- **WHEN** a newly imported 1-hour audio asset is placed on the timeline before its summary exists
- **THEN** the clip shows the shimmer placeholder and, when the summary arrives, the bars without a reload

#### Scenario: Decode failure
- **WHEN** an asset's audio stream cannot be decoded
- **THEN** the clip shows a flat line and the warning icon, and the rest of the timeline is unaffected

### Requirement: Noise reduction
This capability is the single owner of noise reduction (`ai-editing-tools.Voice enhance and noise cleanup` is an entry point to it). Audio elements and video or compound elements with audio SHALL have `noiseReduction {enabled, strength}` with `strength` 0–100 (default 50). It SHALL be processed on-device by the speech noise-suppression model that is the manifest entry `speech-denoise` of `ai-editing-tools.On-device model management` (that requirement owns the model's identity, licence, download and consent), run at 48 000 Hz per channel, with no host; `strength` SHALL mix the suppressed signal with the original (0 = original, 100 = fully suppressed). Processing SHALL run as a background job per source range — it is stage 3 of `Audio signal chain`, before reverse and retime, so its cache key is the source range and a speed change never re-processes it — with the result cached as derived audio per `Derived audio processing and caching`; it is not applied in the live audio graph. The Audio tab SHALL show a "Reduce noise" switch and strength slider; the mobile sheet (entry: the "Reduce noise" item of `mobile-editor.Audio group and audio clip strips` and of `mobile-editor.Video clip tool strip`) SHALL show the same switch and a "Noise cleanup" slider 0–100. Acceptance fixture: `fixtures/audio/speech-fan-noise.wav`. [CAPCUT CC-215]

#### Scenario: Steady noise reduced
- **WHEN** noise reduction at strength 100 is applied to the fixture `speech-fan-noise.wav`
- **THEN** the noise floor measured in the fixture's marked pauses drops by at least 12 dB, and the 300 Hz–3.4 kHz level measured over the marked speech segments changes by no more than ±2 dB

#### Scenario: Strength zero
- **WHEN** strength is 0
- **THEN** the output equals the unprocessed audio

#### Scenario: Works without a host
- **WHEN** no host is connected and the `speech-denoise` model is present on the device
- **THEN** the switch is enabled and processing completes on the device with no network request

### Requirement: Enhance voice
This capability is the single owner of voice enhancement (`ai-editing-tools.Voice enhance and noise cleanup` is an entry point to it). Audio elements and video or compound elements with audio SHALL have `enhanceVoice {enabled, strength}` with `strength` 0–100 (default 50). When enabled, the element's audio SHALL be rendered to derived audio (`Derived audio processing and caching`; not in the live audio graph) through this on-device chain: high-pass filter at 80 Hz (12 dB/octave); noise suppression as in `Noise reduction` at `strength`; de-esser reducing 5–9 kHz sibilance by up to 6 dB; compressor (threshold −18 dB, ratio 3:1, attack 10 ms, release 120 ms) with wet mix equal to `strength`%; presence shelf +0 to +4 dB at 4 kHz scaled by `strength`; and a static make-up gain that brings the result to −16 LUFS integrated (ITU-R BS.1770-4, measured on the output of this chain for the element's visible source range), limited to the range −12…+12 dB. The chain is stage 3 of `Audio signal chain` (before retime). The Audio tab SHALL show an "Enhance voice" switch and strength slider; the mobile sheet (entry: the "Enhance voice" item of the `mobile-editor` strips) SHALL show the "Enhance voice" toggle and the strength slider. When both `enhanceVoice` and `noiseReduction` are enabled, noise suppression SHALL run once, at the higher of the two strengths. [CAPCUT CC-216, CC-210]

#### Scenario: Quiet voice brought up
- **WHEN** a voice recording at −30 LUFS has Enhance voice on at strength 50
- **THEN** the processed clip measures −16 LUFS ±1 LU, or has received exactly the +12 dB cap when −16 LUFS is out of reach

#### Scenario: Noise floor on the fixture
- **WHEN** Enhance voice at strength 100 is applied to `fixtures/audio/speech-fan-noise.wav`
- **THEN** the noise floor in the marked pauses is at least 12 dB lower relative to the speech level, and the integrated loudness is −16 ± 1 LUFS or the +12 dB cap was applied

#### Scenario: Toggle off
- **WHEN** the user turns the toggle off
- **THEN** the clip plays its unprocessed audio and the derived audio stays cached

#### Scenario: Both switches on
- **WHEN** Enhance voice is on at strength 40 and Reduce noise is on at strength 80
- **THEN** noise suppression runs once at strength 80

### Requirement: Vocal isolation
Audio elements and video or compound elements with audio SHALL have `vocalIsolation {mode, vocalsAssetId?, accompanimentAssetId?}` (`project-document.Audio processing fields`) with `mode` `off` (default), `keep-vocals` or `remove-vocals`. This capability owns the element setting and its control; the separation itself is the tool `separate.stems` owned by `ai-editing-tools.Stem separation` (execution location, model, job lifecycle, progress, cancel and acceptance). A separation job SHALL return two derived assets (roles `stem-vocals` and `stem-accompaniment`) for the element's source range, referenced by `vocalsAssetId` and `accompanimentAssetId` and stored with the project so both modes switch instantly afterwards and play offline. Choosing a mode other than `off` SHALL be one undoable command; the job result is a non-history update of the derived-asset references, and a result for an element that no longer exists is discarded. Where `ai-editing-tools.Stem separation` requires a host and none is connected the control SHALL be disabled with "Connect a host to isolate vocals". While the job runs the clip SHALL show "Isolating vocals {n}%" and play its original audio. A failed job SHALL set the mode back to `off` as a non-history update and show the error with Retry. Mobile entry: the "Isolate vocals" item of `mobile-editor.Audio group and audio clip strips`. [CAPCUT CC-217] [NEW]

#### Scenario: Keep vocals
- **WHEN** the job succeeds and the mode is `keep-vocals`
- **THEN** the clip plays the vocals stem only

#### Scenario: Switch to remove
- **WHEN** the user switches to `remove-vocals` after a successful job
- **THEN** the accompaniment stem plays immediately with no new job

#### Scenario: No host
- **WHEN** the tool requires a host and none is connected
- **THEN** the control is disabled with the stated message

#### Scenario: Job fails
- **WHEN** the separation job fails
- **THEN** the mode is `off`, the clip plays its original audio, and the error with Retry is shown

### Requirement: Voice changer
Audio elements and video or compound elements with audio SHALL have `voiceEffect {type, intensity}` (`project-document.Audio processing fields`) with `intensity` 0–100 (default 100, wet/dry mix). Exactly the following 14 on-device effects (plus `none`) SHALL be bundled, each defined by fixed DSP settings at intensity 100 and rendered as derived audio at 48 000 Hz with no network:

| Type id | Name | Processing (normative) |
|---|---|---|
| `none` | None | bypass |
| `deep` | Deep | pitch −4 semitones, formants preserved (spectral envelope restored after the shift) |
| `high` | High | pitch +4 semitones, formants preserved |
| `chipmunk` | Chipmunk | pitch +8 semitones, formants shifted with the pitch |
| `giant` | Giant | pitch −8 semitones, formants shifted with the pitch |
| `robot` | Robot | ring modulation with a 50 Hz sine, then a feed-forward comb filter with 8 ms delay and gain 0.7 |
| `echo` | Echo | feedback delay 250 ms, feedback 0.4, wet 0.5 |
| `hall` | Hall | Schroeder reverb — four parallel feedback combs (29.7, 37.1, 41.1, 43.7 ms) into two series all-pass filters (5.0 and 1.7 ms, gain 0.7), comb gains set for a 2.5 s RT60, wet 0.35 |
| `telephone` | Telephone | 4th-order Butterworth high-pass at 300 Hz followed by 4th-order Butterworth low-pass at 3400 Hz (24 dB/octave on each side), then soft clip `tanh(x × 2)` (6 dB drive) |
| `megaphone` | Megaphone | 4th-order Butterworth high-pass at 500 Hz followed by 4th-order Butterworth low-pass at 4000 Hz, hard clip at −6 dBFS, single slap delay 60 ms at −9 dB |
| `vinyl` | Vinyl | band-limit 100 Hz–7 kHz, crackle noise at −30 dBFS from a seeded generator (seed = element id hash), pitch wow 0.5 Hz ±0.3 % |
| `synth` | Synth | 16-band channel vocoder (bands spaced logarithmically 100 Hz–8 kHz) with a sawtooth carrier following the detected pitch (autocorrelation, 60–500 Hz; 110 Hz when unvoiced) |
| `electronic` | Electronic | pitch quantised to the nearest equal-tempered semitone (A4 = 440 Hz) with 0 ms glide |
| `tremble` | Tremble | amplitude tremolo, 6 Hz sine, depth 0.6 |
| `underwater` | Underwater | low-pass 500 Hz (2nd-order), chorus with 4 ms depth at 0.8 Hz, wet 0.5 |

The Audio tab SHALL show a tile grid with a preview button per tile (plays 3 s of the clip from the playhead through the effect) and the intensity slider; the mobile sheet (entry: the "Voice effects" item of the `mobile-editor` strips) SHALL show the same tiles and slider. Selecting a tile SHALL be one undo step. Pitch-based effects SHALL keep the clip's duration. Voice tools that need a generative model are not part of this requirement: the grid SHALL end with an "AI voices" tile that hands off to `ai-editing-tools.AI voice changer`, and text-to-speech is the hand-off of `Audio properties tab and mobile audio tools`. [CAPCUT CC-218] [NEW]

#### Scenario: Deep voice
- **WHEN** the Deep effect is applied to a 220 Hz tone at intensity 100
- **THEN** the output's dominant frequency is 174.6 Hz ±2% and the clip's duration is unchanged

#### Scenario: Intensity mix
- **WHEN** Echo is applied at intensity 0
- **THEN** the output equals the unprocessed audio

#### Scenario: Telephone band
- **WHEN** the filter stage of Telephone (measured before the soft clip) is fed sine tones at −20 dBFS
- **THEN** its output at 100 Hz and at 8 kHz is at least 24 dB below its output at 1 kHz

#### Scenario: Deterministic vinyl noise
- **WHEN** the same clip with the Vinyl effect is rendered twice
- **THEN** both renders are sample-identical

#### Scenario: Fifteen tiles plus hand-off
- **WHEN** the voice effect grid is opened offline
- **THEN** it shows None plus exactly 14 effects, followed by the "AI voices" tile

### Requirement: Audio pitch shift
Audio elements and video or compound elements with audio SHALL have `pitch {semitones, cents}` (`project-document.Audio processing fields`): `semitones` −12…+12, step 1, and `cents` −100…+100, step 1 (both default 0), independent of speed and applied without changing duration: with `n = semitones + cents / 100`, the signal is time-stretched by the factor `2^(n / 12)` with the WSOLA engine of `speed-retime.Pitch preservation` and then resampled by the inverse factor with a band-limited resampler. The control SHALL be in the Audio tab ("Pitch") and in the mobile sheet reached from the "Pitch" item of `mobile-editor.Audio group and audio clip strips`. Pitch is not keyframable. The stretch engine accepts a combined factor (retime stretch × pitch stretch) of 0.25–4; when the combination leaves that range, Keep pitch is dropped first as defined by `speed-retime.Pitch preservation`. [CAPCUT CC-086] [NEW]

#### Scenario: Up an octave
- **WHEN** pitch is +12 on a 440 Hz tone
- **THEN** the output's dominant frequency is 880 Hz ±2% and the duration is unchanged (±1 ms)

#### Scenario: Combined with speed
- **WHEN** a clip plays at 2× with Keep pitch on and pitch −2
- **THEN** it lasts half as long and sounds 2 semitones lower than the source

#### Scenario: Fine control
- **WHEN** `pitch` is `{semitones: 0, cents: 50}` on a 440 Hz tone
- **THEN** the output's dominant frequency is 452.9 Hz ±1%

### Requirement: Loudness normalisation
Audio elements and video or compound elements with audio SHALL have `normalize {enabled, target, gainDb, measuredLufs?}` (`project-document.Audio processing fields`) with `target` in LUFS, −30…−5, step 1, default −14, and presets −23 (broadcast), −16 (speech) and −14 (online video). When enabled, the editor SHALL measure, per ITU-R BS.1770-4 and on-device, the integrated loudness and true peak of the element's signal at the output of stage 7 of `Audio signal chain` (after stem selection, noise reduction and voice enhancement, retime, voice effect, equaliser and compressor; before the normalisation gain itself) over the element's visible range and apply a static gain `target − measured`, limited so the resulting true peak does not exceed −1 dBTP and to a maximum boost of +24 dB. The gain SHALL be stored as `normalize.gainDb` and the measurement as `normalize.measuredLufs` (both written by a non-history update when the measurement completes), applied before clip volume, shown read-only in the Audio tab as "Measured −22.4 LUFS → +8.4 dB", and recomputed when the trim, the retime or any setting of stages 2–7 changes. With Enhance voice on (which already brings the clip to −16 LUFS), normalisation measures that result and applies only the difference to its own target. "Normalise loudness" on a multi-selection SHALL apply the same target to each element independently in one undo step. An element whose range is silent SHALL receive 0 dB and show "Clip is silent". [CAPCUT CC-219]

#### Scenario: Quiet clip raised
- **WHEN** a clip measuring −24 LUFS with true peak −12 dBTP is normalised to −14 LUFS
- **THEN** `normalize.gainDb` is +10 dB

#### Scenario: Peak-limited gain
- **WHEN** a clip measures −24 LUFS with true peak −5 dBTP and the target is −14 LUFS
- **THEN** `normalize.gainDb` is +4 dB and the tab notes "Limited by peak level"

#### Scenario: Silent clip
- **WHEN** the clip's range contains only digital silence
- **THEN** the gain is 0 dB and "Clip is silent" is shown

#### Scenario: Measured after processing
- **WHEN** a clip has the Bass boost equaliser preset and normalisation to −14 LUFS
- **THEN** `normalize.measuredLufs` is the loudness of the equalised signal, and changing the preset triggers a new measurement

### Requirement: Beat markers on audio
Audio elements and video or compound elements with audio SHALL carry `beats` (`project-document.Beat markers field`), a list of up to 2 000 marker positions in source time (ticks), so markers stay on the same sound when the element is moved, trimmed, split or retimed. The "Beats" tool (context menu "Mark beats", Audio tab; mobile entry: the "Beats" item of `mobile-editor.Audio group and audio clip strips`) SHALL provide "Add beat" at the playhead (action `audio.beat.add`, rebindable; also usable during playback to tap beats, each press adding a marker at the playhead compensated by the measured output latency), "Delete beat" for the marker under the playhead (within 2 frames) and "Clear all" with confirm. Markers SHALL be drawn as 6 px dots in the `waveform/beat` token of `design-system.Editor colour tokens` along the bottom of the clip's waveform, visible only inside the trimmed range, and SHALL be draggable along the clip on desktop/web. Adding, deleting, moving and clearing SHALL be undoable; taps made during one playback pass SHALL undo as one step. [CAPCUT CC-220]

#### Scenario: Add at the playhead
- **WHEN** the playhead is 3 s into a clip trimmed from source 10 s and the user adds a beat
- **THEN** a marker is stored at source time 13 s and a dot appears under the playhead

#### Scenario: Markers follow a trim
- **WHEN** the clip's start is trimmed in by 1 s
- **THEN** the marker is still at source 13 s and appears 2 s into the clip

#### Scenario: Tap during playback
- **WHEN** the user presses the add-beat action 8 times during one playback pass
- **THEN** 8 markers exist and a single undo removes all 8

#### Scenario: Limit
- **WHEN** a clip already has 2 000 markers
- **THEN** "Add beat" is refused with "Beat marker limit reached (2000)"

### Requirement: Automatic beat detection
The Beats tool SHALL offer "Auto beats", which analyses the element's visible source range on-device (onset-strength envelope and tempo tracking, off the main thread, no network) and replaces the element's markers with detected beats. A sensitivity slider labelled "Light" to "Intense", 0–100 (default 50), SHALL control density in three bands: 0–33 keeps downbeats only (every fourth detected beat), 34–66 keeps every beat, 67–100 adds half-beat subdivisions and onsets whose strength is above the track's 90th percentile. Changing the slider after detection SHALL re-derive markers from the cached analysis within 200 ms without re-analysing. Analysis of a 5-minute track SHALL complete within 10 s on the reference desktop device of `diagnostics-quality.Performance budgets` and show progress; it SHALL be cancellable. The detected tempo SHALL be shown as "{n} BPM". When no stable beat is found (tempo confidence below 0.3 on the tracker's 0–1 scale) the tool SHALL show "No clear beat found. Add beats manually." and leave existing markers unchanged. Applying SHALL be one undo step. The same analysis is exposed to agents as `jc_audio_beats`. [CAPCUT CC-221]

#### Scenario: Steady 120 BPM track
- **WHEN** Auto beats runs at sensitivity 50 on a track with a steady 120 BPM click
- **THEN** markers are placed every 0.5 s within ±20 ms of each click and the tool shows "120 BPM"

#### Scenario: Light sensitivity
- **WHEN** the slider is moved to 0
- **THEN** markers are 2 s apart on that track

#### Scenario: No beat
- **WHEN** the clip is speech only
- **THEN** the message is shown and existing markers are unchanged

#### Scenario: Cancel
- **WHEN** the user cancels during analysis
- **THEN** the existing markers are unchanged and no undo step is recorded

### Requirement: Snap to beats
When timeline snapping is enabled, beat markers of every visible audio-capable element SHALL be snap targets for the playhead, for element edges while moving and trimming, for split, for keyframes (`keyframe-animation.Drag keyframes in time`) and for transition and fade handles, using the snap threshold and the Shift-to-disable rule of `timeline-editing.Snapping` (10 px on desktop/web, 12 pt on mobile). A snap line SHALL be drawn at the beat while snapped. A "Snap to beats" switch in the Beats tool (default on, stored in editor preferences) SHALL remove beats from the snap targets when off. [CAPCUT CC-220, CC-221] [NEW]

#### Scenario: Trim to a beat
- **WHEN** the user drags a video clip's end to within the snap threshold of a beat marker on the music track
- **THEN** the edge lands exactly on the beat's timeline tick and a snap line is shown

#### Scenario: Switch off
- **WHEN** "Snap to beats" is off
- **THEN** the same drag does not snap to the marker

### Requirement: Equaliser, compressor and ducking
Audio elements and video or compound elements with audio SHALL have `eq {enabled, preset, bands {low, lowMid, mid, highMid, high}}` (`project-document.Audio processing fields`), a 5-band equaliser: `low` is a low shelf at 100 Hz and `high` a high shelf at 10 kHz, both second-order (12 dB/octave) with shelf slope S = 1; `lowMid`, `mid` and `highMid` are second-order peaking filters at 300 Hz, 1 kHz and 3 kHz with Q 1.0 (the biquad formulas of the Audio EQ Cookbook at 48 000 Hz). Each band is −12…+12 dB, step 0.5, default 0. `preset` is one of `flat`, `voice-clarity`, `bass-boost`, `treble-boost`, `warm`, `radio` or `custom`; choosing a preset writes its band values, and moving a band sets `preset: "custom"`. Exactly these six presets exist (id — band gains in dB):

| Preset | 100 Hz | 300 Hz | 1 kHz | 3 kHz | 10 kHz |
|---|---|---|---|---|---|
| Flat (`flat`) | 0 | 0 | 0 | 0 | 0 |
| Voice clarity (`voice-clarity`) | −3 | −2 | 0 | +4 | +2 |
| Bass boost (`bass-boost`) | +6 | +2 | 0 | 0 | 0 |
| Treble boost (`treble-boost`) | 0 | 0 | 0 | +2 | +6 |
| Warm (`warm`) | +3 | +2 | 0 | −1 | −3 |
| Radio (`radio`) | −12 | −3 | +3 | +5 | −9 |

They SHALL also have `compressor {enabled, threshold −60…0 dB (−18), ratio 1–20 (3), attack 1–200 ms (10), release 10–1000 ms (120), makeup 0–24 dB (0)}`: a feed-forward compressor with a peak detector on the linked channels (the larger absolute sample of left and right), a hard knee, gain computed in dB as `(threshold − level) × (1 − 1 / ratio)` above the threshold, smoothed with the attack and release time constants, followed by the make-up gain. Each audio track SHALL have `ducking {enabled, amount, attack, release}`: when enabled, the track's gain SHALL be reduced by `amount` (0–30 dB, default 12) whenever any element with `isVoice: true` on another track is above −40 dBFS (RMS, 50 ms window), with `attack` 10–1000 ms (default 200) and `release` 50–3000 ms (default 500). An element's `isVoice` field ("Voice" switch in the Audio tab; default false) SHALL be set by the user and SHALL be true when inserted for voiceover recordings and text-to-speech clips. Ducking SHALL be computed deterministically from the mix so preview and export match, and the ducked track's clips SHALL show the gain reduction as a shaded envelope. All settings SHALL be undoable and static (not keyframable). Agents set these through `jc_audio_edit` (`eq`, `compressor`, `isVoice`) and `jc_audio_duck`. [CAPCUT CC-224] [NEW]

#### Scenario: Music ducks under voice
- **WHEN** a music track has ducking at 12 dB and a voiceover clip plays from 5 s to 8 s on another track
- **THEN** the music's level is 12 dB lower between 5.2 s and 8 s (after the 200 ms attack) and returns to full level by 8.5 s

#### Scenario: EQ band
- **WHEN** the 1 kHz band is +6 dB
- **THEN** a 1 kHz tone is 6 dB louder (±0.5 dB) and a 100 Hz tone changes by less than 1 dB

#### Scenario: Preset values
- **WHEN** the user selects the "Radio" preset
- **THEN** the five band gains are −12, −3, +3, +5 and −9 dB, and `eq.preset` is `radio`; moving any band afterwards sets `eq.preset` to `custom` and shows the preset name as "Custom"

#### Scenario: No voice clips
- **WHEN** ducking is enabled and no element is flagged Voice
- **THEN** the track plays at full level and the Audio panel shows "Mark a clip as Voice to duck under it"

### Requirement: AI lip sync entry point
The clip context menu and the Audio tab of a video element SHALL include "Lip sync", which opens the flow of `ai-editing-tools.Avatar and lip-sync` (using the `lipsync` role of `orc-model-routing.Role catalogue`) with the selected video and, when exactly one audio element is also selected, that audio preselected as the driving voice; mobile entry: the "Lip sync" item of `mobile-editor.Video clip tool strip`. This capability defines only the entry point: the item requires a connected host and SHALL otherwise open the notice "Connect a host to use lip sync"; the result is a new video asset that replaces the clip's source non-destructively, leaving all audio settings unchanged. [CAPCUT CC-225] [NEW]

#### Scenario: Hand-off with audio
- **WHEN** a video clip and a voiceover clip are selected and the user chooses "Lip sync"
- **THEN** the lip-sync flow opens with both preselected

#### Scenario: No host
- **WHEN** no host is connected
- **THEN** the notice is shown and no job starts

### Requirement: Derived audio processing and caching
Noise reduction, voice enhancement, voice effects, pitch shift, pitch-preserving retime and vocal isolation SHALL produce derived audio at 48 000 Hz that is cached on the device, keyed by a hash of the source content, the source range and the processing parameters. A change to parameters SHALL invalidate only the affected element's derived audio. Derived audio is a derived asset: its completion is never a history entry (the user's parameter change is the only undo step), and a result for an element that no longer exists is discarded. While derived audio is being prepared the clip SHALL show a progress label, playback SHALL use the most recent available version (the unprocessed audio when none exists), and export SHALL wait for processing to finish, showing it as the export step "Preparing audio". Jobs SHALL run off the main thread, at most 2 concurrently on mobile and 4 on desktop/web, SHALL be cancellable, and SHALL resume after an app restart. A failed job SHALL show a warning icon on the clip with the reason and Retry, and the clip SHALL play unprocessed audio. Derived audio lives in the cache store of `project-storage.Cache management` under that requirement's single budget (no separate budget), evicted least-recently-used; evicted items are recomputed on demand. [NEW]

#### Scenario: Parameter change re-processes one clip
- **WHEN** the user changes noise-reduction strength on one of ten processed clips
- **THEN** only that clip shows a progress label and the other nine keep their cached audio

#### Scenario: Export waits
- **WHEN** export starts while one clip is still processing
- **THEN** the export shows "Preparing audio" until that clip is ready and the exported audio contains the processed result

#### Scenario: Failure
- **WHEN** processing fails because storage is full
- **THEN** the clip shows a warning with "Not enough storage to process audio" and Retry, and plays unprocessed

#### Scenario: Evicted item
- **WHEN** a clip's derived audio was evicted from the cache and the project is played
- **THEN** the clip plays unprocessed with a progress label while the derived audio is recomputed, and no undo step is recorded

### Requirement: Audio signal chain
This requirement is the single definition of the order of audio processing; `render-engine.Audio mixdown for export` and `render-engine.Audio scheduler lookahead` implement it and do not restate it. For each audio-capable element the signal SHALL be processed in this fixed order: (1) decode, downmix to stereo and resample to the 48 000 Hz internal rate; (2) vocal isolation stem selection; (3) noise reduction and voice enhancement (on the source signal, so their derived audio is keyed by the source range and is unaffected by speed changes); (4) reverse and retime, with pitch preservation and pitch shift; (5) voice effect; (6) equaliser; (7) compressor; (8) loudness normalisation gain; (9) clip volume, including keyframes; (10) fades and crossfades; (11) clip pan. Stages 2–5 are served from derived audio (`Derived audio processing and caching`); stages 6–11 run in the live graph and in the mixdown. Elements SHALL then be summed per track, followed by (12) track volume, (13) ducking, (14) track pan, (15) track mute, then summed to the master bus, followed by (16) master volume (playback only) and (17) the mastering stage (`Mastering limiter`). Playback and export SHALL use the same order and parameters. The internal processing rate is always 48 000 Hz; conversion to the export sample rate happens once, after stage 17 (`Mixdown for export`). [PORT AU-006] [NEW]

#### Scenario: Fade after volume
- **WHEN** a clip has volume +6 dB and a 1 s fade in
- **THEN** its gain at local 0 s is 0 and at 1 s corresponds to +6 dB

#### Scenario: Normalisation precedes volume
- **WHEN** a clip has `normalize.gainDb` +8 dB and volume −3 dB
- **THEN** its total static gain is +5 dB

#### Scenario: Equaliser before compressor
- **WHEN** a clip has the 1 kHz band at +12 dB and a compressor with threshold −18 dB on a 1 kHz tone at −24 dBFS
- **THEN** the compressor acts on the boosted −12 dBFS signal (gain reduction is applied), whereas with the band at 0 dB no gain reduction occurs

#### Scenario: Track volume after clip gain
- **WHEN** a clip at +6 dB sits on a track whose volume is −6 dB
- **THEN** the clip's contribution to the master bus is at 0 dB relative to its source level

#### Scenario: Speed change does not re-run noise reduction
- **WHEN** a clip with noise reduction already processed is changed from 1× to 2×
- **THEN** the cached noise-reduced audio of the source range is reused and only the retime stage is rendered again

### Requirement: Mixdown for export
This requirement defines what the export mix contains; the offline block renderer (blocks of at most 10 s, memory independent of duration, sample-identical repeat runs) is defined by `render-engine.Audio mixdown for export`. Export SHALL mix all tracks to stereo 32-bit float at the 48 000 Hz internal rate through `Audio signal chain`, and convert once, after the mastering stage, to the sample rate and channel count requested by the export (44 100 or 48 000 Hz, default 48 000; stereo or mono), which are export settings owned by `export-share.Audio settings for video export`. There is no project-level sample-rate setting, and projects migrated from OpenCut classic get no special rate. Collection order SHALL be overlay tracks, main track, audio tracks, including the audio of compound scenes; muted tracks and elements and videos with source audio disabled SHALL be skipped; solo is ignored. The mix SHALL report progress and SHALL be cancellable within 500 ms. A timeline with no audible audio SHALL produce a silent track of the timeline's duration. The same mix function SHALL provide audio for transcription, resampled to 16 kHz mono as required by `captions-subtitles.Auto captions on device`. [PORT AU-006] [NEW]

#### Scenario: Default sample rate
- **WHEN** a new project is exported with the default audio settings
- **THEN** the audio stream is stereo at 48 000 Hz

#### Scenario: Export at 44 100 Hz
- **WHEN** the export requests 44 100 Hz
- **THEN** the mix is rendered at 48 000 Hz, converted once to 44 100 Hz after the limiter, and the project document is unchanged

#### Scenario: Migrated project
- **WHEN** a classic project is opened and exported with default settings
- **THEN** the audio stream is at 48 000 Hz and the project has no sample-rate field

#### Scenario: Muted elements skipped
- **WHEN** one of two overlapping clips is muted
- **THEN** the exported audio contains only the other clip

#### Scenario: Transcription input
- **WHEN** auto captions request audio for a clip
- **THEN** they receive 16 kHz mono PCM of that clip's range

### Requirement: Mastering limiter
This capability is the single owner of the mastering limiter; `render-engine.Mastering limiter` references this definition. The master bus SHALL end with a limiter that is JAgentChill's own deterministic implementation (not the platform `DynamicsCompressorNode`), running at the 48 000 Hz internal rate: a true-peak limiter with ceiling 0.98 (linear, −0.18 dBTP) and unity gain below the ceiling. Detection is the inter-sample (true) peak of the linked channels, measured with 4× oversampling (48-tap polyphase FIR, the true-peak filter of ITU-R BS.1770-4); the gain is `min(1, 0.98 / peak)` — exactly 1 whenever the true peak is at or below the ceiling — smoothed with a 1 ms attack reached through a look-ahead of 48 samples (1 ms) and a 120 ms release, applied identically to every channel; a final hard clamp of samples to ±0.98 is a safety stage that conforming input never reaches. There is no fixed make-up or attenuation gain: the classic constant gain of 0.98 and the classic rule that skipped the limiter when the whole-mix peak was at or below 0.98 are both not ported, and no whole-mix peak is measured. The limiter is always in the path, in live playback and in export alike, with the same code and constants, so that both have the same level. Where the limiter runs, how its state is carried across mixdown blocks and when that state is reset are defined by `render-engine.Mastering limiter`. Neither live output nor exported audio contains samples beyond ±0.98, and the true peak of the output, measured with the same 4× oversampling, does not exceed 0.98 by more than 0.1 dB. Loudness is not normalised at the master; per-clip targets are defined by `Loudness normalisation`. [PORT AU-007] [NEW]

#### Scenario: Quiet mix passes at unity gain
- **WHEN** the true peak of the mix is 0.5
- **THEN** exported samples equal the mix samples (gain exactly 1), with no other change than the compensated look-ahead delay

#### Scenario: Hot mix limited
- **WHEN** two full-scale clips overlap
- **THEN** no exported sample exceeds ±0.98 and the true peak of the export measured at 4× oversampling is at most 0.98 plus 0.1 dB

#### Scenario: Mix just below the ceiling
- **WHEN** the true peak of the mix is 0.97
- **THEN** the output equals the mix sample for sample and the limiter's gain never leaves 1

#### Scenario: Deterministic across runs
- **WHEN** the same hot project is exported twice on the same device
- **THEN** the two audio streams are sample-identical before encoding

#### Scenario: Block boundaries are inaudible
- **WHEN** a continuous 1 kHz tone at +3 dBFS spans three mixdown blocks
- **THEN** the limited output has no sample-to-sample discontinuity larger than that of the tone itself at any block boundary

#### Scenario: Live playback and export have the same level
- **WHEN** the same snapshot, peaking at 0.5, is played live and exported
- **THEN** both outputs equal the mix at unity gain, and the integrated level of the two differs by less than 0.01 dB

### Requirement: Live playback scheduling
Live audio scheduling is owned by `render-engine`: the scheduler tick, look-ahead window and start accuracy by `render-engine.Audio scheduler lookahead`, the master clock by `render-engine.Audio clock as playback master`, late-chunk and drift handling by `render-engine.Audio drift and underrun handling`, and scrub audio (including its on/off preference) by `render-engine.Scrub audio`. This capability states no timing numbers of its own and adds only the audio-side obligations: every audible element — media clips, extracted audio, voiceovers, bundled and library sounds alike — is scheduled through `Audio signal chain`; all element timings (start time, duration, trims) are converted from ticks to seconds at the scheduling boundary, and the classic defect that left library-sound timings in ticks MUST NOT be reproduced; elements with keyframed volume, fades, pitch preservation, speed curves or reverse play through prepared buffers; and playback pauses at the end of the timeline as defined by `preview-canvas.End-of-timeline behaviour`. [PORT AU-014, AU-004] [NEW]

#### Scenario: Library sound plays on time
- **WHEN** a library sound element starts at 00:05.000 and playback starts from 00:00
- **THEN** the sound is first heard at 5.000 s after playback starts, within the start accuracy of `render-engine.Audio scheduler lookahead`

#### Scenario: Scrubbing with scrub audio off
- **WHEN** scrub audio is off and the user drags the playhead while paused
- **THEN** no audio is heard

#### Scenario: Scrubbing with scrub audio on
- **WHEN** scrub audio is on and the user drags the playhead while paused
- **THEN** snippets are heard as defined by `render-engine.Scrub audio`, mixed through `Audio signal chain`

#### Scenario: Latency compensation after drops
- **WHEN** five consecutive audio chunks arrive fully late during playback
- **THEN** the stream restarts from the current time with added latency compensation as defined by `render-engine.Audio drift and underrun handling`, and audio and picture are back within that requirement's sync bound

### Requirement: Audio metering
The editor SHALL show a stereo master meter (desktop/web: right edge of the timeline, 16 px per channel; mobile: at the top of the "Tracks" tab of `mobile-editor.Layers sheet` and in the voiceover recorder) with a scale from −60 to +6 dBFS, a peak bar per channel with 1.5 s peak hold, an RMS bar (300 ms window), colour zones green below −12 dB, yellow from −12 to −3 dB and red above −3 dB (design-system status tokens), and a clip indicator per channel that latches when the pre-limiter mix exceeds 0 dBFS and clears on click or when playback restarts. Each audio track header on desktop/web SHALL show a mono-sum peak meter 4 px wide. Meters SHALL update at 30 Hz or more during playback, fall to silence within 1 s after pause, and read the signal after track processing (track meters) and before the limiter (master). Whole-mix loudness analysis for export (integrated LUFS and true peak after "Analyse") is shown by `export-share.Export audio checks and credits`, which calls the measurement of `Loudness normalisation` on the mixdown. [NEW]

#### Scenario: Clip indicator latches
- **WHEN** the pre-limiter mix peaks at +2 dBFS during playback
- **THEN** the clip indicator lights and stays lit after the peak until the user clicks it

#### Scenario: Idle
- **WHEN** playback is paused
- **THEN** within 1 s both meters show no level

#### Scenario: Muted track meter
- **WHEN** a track is muted
- **THEN** its track meter shows no level during playback

### Requirement: Audio properties tab and mobile audio tools
On desktop/web the "Audio" inspector tab named in `preview-canvas.Inspector structure per element type` SHALL contain for an audio-capable element, in order: Volume (with keyframe toggle), Mute, Pan, Fade in, Fade out (with shapes), Normalise loudness, Reduce noise, Enhance voice, Vocal isolation, Voice effects, Pitch, Equaliser, Compressor, Voice switch (`isVoice`), Beats, and for video elements Extract/Recover audio and Lip sync. Sections SHALL be collapsible, each with a reset button. With several audio-capable elements selected the tab SHALL edit all of them, showing "Mixed" for differing values. On mobile, the Audio group of the root toolbar, the audio clip strip and the audio items of the video clip strip — their items, labels and order — are owned by `mobile-editor.Audio group and audio clip strips` and `mobile-editor.Video clip tool strip`; this capability defines only the panel each item opens: Sounds and Sound FX → the sheet of `Sounds library panel` on the Music or Sound effects sub-tab; Extract → `Extract audio from video`; Voiceover → the recorder of `Voiceover recording`; Copyright → `Audio licence check`; Volume → the percent slider of `Clip volume in decibels`; Fade → the two sliders of `Audio fades`; Speed → `speed-retime.Speed panel structure`; Beats → the Beats tool; Voice effects → `Voice changer`; Reduce noise → `Noise reduction`; Enhance voice → `Enhance voice`; Isolate vocals → `Vocal isolation`; Normalise → `Loudness normalisation`; Pitch → `Audio pitch shift`; Pan → a sheet with the slider of `Clip pan` and its keyframe toggle; Equaliser → a sheet with the three tabs Equaliser, Compressor and Ducking of `Equaliser, compressor and ducking` (Ducking edits the clip's track); Reverse → `speed-retime.Reverse`; track Mute, Solo, Volume and Pan → the "Tracks" tab of `mobile-editor.Layers sheet`, as defined by `Track volume, pan and solo`. Two items are hand-offs to voice tools owned by `ai-editing-tools`: "Text to audio" opens `ai-editing-tools.Text to speech with voice selection`, and the "AI voices" tile of `Voice changer` opens `ai-editing-tools.AI voice changer`. Every sheet SHALL leave the preview and a compact timeline visible and follow the ✓ / ✕ rules of `mobile-editor.Tool sheets never cover the preview`. [PORT AU-002, AU-003] [CAPCUT CC-211, CC-216] [NEW]

#### Scenario: Video without audio
- **WHEN** a video whose asset has no audio is selected
- **THEN** the Audio tab is not shown

#### Scenario: Mixed values
- **WHEN** two clips at −3 dB and −9 dB are selected
- **THEN** the Volume field shows "Mixed" and setting −6 dB applies to both in one undo step

#### Scenario: Mobile item opens its panel
- **WHEN** an audio clip is selected on mobile and the user taps the strip item "Normalise"
- **THEN** a sheet with the target presets and the measured loudness of `Loudness normalisation` opens above the compact timeline

#### Scenario: Text to audio hand-off
- **WHEN** the user taps "Text to audio" in the mobile Audio group
- **THEN** the flow of `ai-editing-tools.Text to speech with voice selection` opens and this capability starts no job of its own

### Requirement: Audio settings under editing operations
Splitting an audio-capable element SHALL give both parts the same volume, pan, processing settings and beat markers (in source time), divide volume and pan keyframes at the split with boundary keys so the envelope is unchanged, keep `fadeIn` on the left part and `fadeOut` on the right part, and create no fades at the split point. Duplicate and copy/paste SHALL copy all audio settings. Trimming SHALL keep fades at their durations, clamped as in `Audio fades`. Deleting an element SHALL remove the crossfade records it participates in (`project-document.Track transition records`). Linked video and audio pairs follow `timeline-editing.Video and audio linking`. All audio mutations SHALL be undoable commands, saved with the project, and exposed to agents through `jc_audio_edit`, `jc_audio_duck`, `jc_audio_crossfade`, `jc_audio_beats` and `jc_clip_detach_audio` (`agent-editing-tools.Tool naming and families`), with volume in dB and the ranges of this capability; a value outside its range is refused with `OUT_OF_RANGE` and never clamped by a tool (inspector fields clamp typed values). [PORT AU-001] [NEW]

#### Scenario: Split keeps the envelope
- **WHEN** a clip with a volume ramp from 0 dB to −20 dB over 4 s is split at 2 s
- **THEN** the left part ends at −10 dB and the right part starts at −10 dB

#### Scenario: Split and fades
- **WHEN** a clip with a 1 s fade in and a 1 s fade out is split in the middle
- **THEN** the left part has only the fade in and the right part has only the fade out

#### Scenario: Agent volume out of range
- **WHEN** `jc_audio_edit` sets a clip's volume to 40
- **THEN** the call fails with `OUT_OF_RANGE` naming `volume` with `min` −60 and `max` 20 (`agent-editing-tools.Validation`) and the stored volume is unchanged
