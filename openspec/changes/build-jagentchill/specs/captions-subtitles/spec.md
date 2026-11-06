## ADDED Requirements

### Requirement: Captions panel
The Captions asset tab (desktop and web; tab ids and labels are owned by `app-shell-navigation.Editor asset panel tabs`) SHALL contain three sections: "Auto captions" (mode, source, language, model, "Run on", options, Generate), "Import" (file picker and drop zone for subtitle files) and "Captions" (the editable list of the active caption track with a track selector, Translate, Style, and Export buttons). With no caption track in the scene the list section SHALL show the empty state "No captions yet — generate them from speech or import a subtitle file." The word-level transcript is the content of the separate Transcript asset tab (`captions-subtitles.Transcript panel`). Mobile entry: see `mobile-editor.Captions, Stickers, Templates and AI tools groups`; this capability contributes the panel content only. [PORT CP-001] [CAPCUT CC-193, CC-283]

#### Scenario: Empty project
- **WHEN** the Captions tab is opened in a scene with no caption track
- **THEN** the Auto captions and Import sections are shown and the list shows the empty state

#### Scenario: Existing captions
- **WHEN** the scene has one caption track with 40 captions
- **THEN** the list shows 40 rows in time order, each with start time, end time and text

### Requirement: Caption track and caption elements
This capability is the only owner of the captions model. Captions SHALL be stored as elements of type `caption` on tracks of type `caption` in the overlay zone (design D5); no other representation of captions exists in a project. The stored shape is owned by `project-document` and is not restated here: a caption element is `project-document.Caption element` (`text`, optional `words[]`, `translation`, `speaker`, the partial `style` override, the `edited` flag and the optional per-caption `transform`), and a caption track carries the object `caption {language, translationLanguage?, sourceId?, mode, burnIn, showSpeakerLabels, styleId?, style, layout, highlight, bilingual}` of `project-document.Caption track fields` beside the ordinary track fields `hidden` and `locked` (`project-document.Track fields`). This capability owns the behaviour of those fields: `caption.language` is a BCP-47 tag or `und`; `caption.sourceId` names the caption source the track was generated from and is absent for imports; `caption.style` is the track style (a complete text style of `text-and-titles.Text parameter table` without bubble and tracking); `caption.layout`, `caption.highlight` and `caption.bilingual` are defined by `captions-subtitles.Caption default style and layout`, `captions-subtitles.Word-level highlight` and `captions-subtitles.Bilingual caption rendering`; `caption.styleId` names the catalogue style the track was created from; `caption.burnIn` defaults to true. Caption elements on one track SHALL NOT overlap in time (`timeline-editing.Overlap rule`). A scene SHALL support any number of caption tracks within the overlay track limit of `timeline-editing.Track creation and insert index`; a new caption track SHALL be inserted as the topmost overlay track. Generating or importing captions SHALL create the track and all its elements as one undo step. "Convert to text" on selected captions SHALL replace them with ordinary text elements carrying the resolved style on a text track, as one undo step. The compositor draws captions through `render-engine.Caption nodes`; retiming of clips under captions follows `speed-retime.Effect of retime on captions`. [PORT CP-006] [NEW]

#### Scenario: One undo for a whole import
- **WHEN** a subtitle file with 120 cues is imported and the user presses undo once
- **THEN** the caption track and all 120 captions are removed

#### Scenario: No overlap
- **WHEN** the user drags a caption so that it would overlap its neighbour on the same track
- **THEN** the move is resolved by `timeline-editing.Overlap rule` and the two captions do not overlap after the drop

#### Scenario: Convert to text
- **WHEN** the user converts three selected captions to text
- **THEN** three text elements with the same content, timing and appearance exist on a text track and the three captions are gone

#### Scenario: Caption on a non-caption track is refused
- **WHEN** a command tries to place a `caption` element on a `text` track
- **THEN** the command fails validation and nothing changes

### Requirement: Caption default style and layout
A new caption track SHALL use this style (catalogue style `classic`): font Arial (a baseline name rendered with the bundled font of `text-and-titles.Bundled fonts`), weight 700, `fontSize` 5, fill `#ffffff`, stroke enabled (black, width 6), center-aligned, background off, wrapped to a box of 80 % of the canvas width, anchored at the bottom with a margin of 5 % of the canvas height, at most 2 lines per caption when generated automatically. Track layout is the object `caption.layout {anchor, marginY, maxWidth, offset, scale}` of `project-document.Caption track fields`: `anchor` (top / middle / bottom, default bottom), `marginY` (0–50 % of canvas height, step 0.5, default 5), `maxWidth` (20–100 % of canvas width, step 1, default 80), `offset {x, y}` (canvas px added to the anchored position, default 0, 0) and `scale` (0.1–10, default 1). Captions SHALL be movable and scalable on the canvas: with "Apply to all" on, dragging or scaling one caption writes `caption.layout.offset` and `caption.layout.scale`, moving every caption of the track; with it off, the gesture writes that caption's own `transform` override. The controls for these fields are placed by `captions-subtitles.Caption inspector tab` (desktop and web) and `captions-subtitles.Captions on touch devices` (mobile). [PORT CP-009] [NEW]

#### Scenario: Default placement
- **WHEN** captions are generated on a 1080×1920 project
- **THEN** each caption is horizontally centred, no wider than 864 px, with its bottom edge 96 px above the bottom of the canvas

#### Scenario: Move all
- **WHEN** the user drags one caption upward by 200 px with "Apply to all" on
- **THEN** every caption on the track is rendered 200 px higher

### Requirement: Caption inspector tab
On desktop and web the Captions tab of a selected caption (`preview-canvas.Inspector structure per element type`) SHALL have four sub-tabs holding exactly these controls, so that every caption field has one home; the same controls are reachable on mobile through the caption style sheet of `captions-subtitles.Captions on touch devices`. A header row above the sub-tabs SHALL show the track selector, the switch "Apply to all" (default on; `captions-subtitles.Batch caption editing`) and, while the selection has overrides, the button "Reset to track style".

| Sub-tab | Controls (field written) |
|---|---|
| Style | the template gallery of `captions-subtitles.Caption style templates` with My styles and "Save as style" (`caption.styleId`, `caption.style`); the current style name |
| Layout | Anchor: top / middle / bottom (`caption.layout.anchor`); Margin (`caption.layout.marginY`); Maximum width (`caption.layout.maxWidth`); Scale (`caption.layout.scale`); "Reset position" (clears `caption.layout.offset`, or the caption's `transform` override); "Show speaker labels" (`caption.showSpeakerLabels`, default off; draws `speaker` followed by ": " before the text of captions that have one); "Burn-in" (`caption.burnIn`) |
| Highlight | Style: none, color, background, scale, underline, karaoke, reveal (`caption.highlight.style`); Highlight colour (`caption.highlight.color`); Text colour, shown for background (`caption.highlight.textColor`); Scale, shown for scale (`caption.highlight.scale`) |
| Bilingual | shown enabled when the track has a `translationLanguage`, otherwise with the hint "Translate this track to add a second language" and a Translate button: Show translation (`caption.bilingual.visible`); Order: below / above (`caption.bilingual.order`); Size (`caption.bilingual.scale`); Colour with "Same as text" (`caption.bilingual.color`) |

Font, size, fill, stroke, shadow, glow, background, alignment and spacing are in the caption's Text tab; In, Out and Loop animations in its Animation tab; speech generation in its Text-to-speech tab (`text-and-titles.Text-to-speech hand-off`). With "Apply to all" on, every control of the four sub-tabs and of the Text and Animation tabs writes the track's `caption` object; with it off, Style, Text and Animation controls write the selected captions' `style` override, Layout position and scale write their `transform` override, and Highlight, Bilingual, "Show speaker labels" and "Burn-in" — which exist only per track — are disabled with the tooltip "Applies to the whole track". Each change is one undo step. [CAPCUT CC-195, CC-196, CC-204] [NEW]

#### Scenario: Four sub-tabs
- **WHEN** a caption is selected on desktop
- **THEN** the Captions tab shows Style, Layout, Highlight and Bilingual with the controls of the table

#### Scenario: Speaker labels
- **WHEN** "Show speaker labels" is turned on for a track whose captions have `speaker: "Anna"`
- **THEN** each of those captions renders as "Anna: " followed by its text in preview and export, and captions without a speaker are unchanged

#### Scenario: Track-only controls with Apply to all off
- **WHEN** "Apply to all" is off
- **THEN** the Highlight and Bilingual controls and the Burn-in switch are disabled with the tooltip "Applies to the whole track"

#### Scenario: Reset to track style
- **WHEN** one caption has a colour override and the user presses "Reset to track style"
- **THEN** its `style` override is removed and it renders with the track style, as one undo step

#### Scenario: Bilingual without a translation
- **WHEN** the track has no `translationLanguage`
- **THEN** the Bilingual sub-tab shows the hint and the Translate button and no option control

### Requirement: Import SRT
Import SHALL accept `.srt` files. Parsing SHALL: split blocks on blank lines; treat the index line as not required; accept timestamps `HH:MM:SS,mmm` or `HH:MM:SS.mmm` separated by `-->`; keep multi-line text with `\n`; convert `<i>`, `<b>` and `<u>` tags to per-caption italic, bold and underline overrides when the whole cue is wrapped by the tag, and strip all other tags including `<font>` and `{\an…}`; count a cue with a malformed timestamp or a non-positive duration as skipped. When a cue overlaps the next one, its end SHALL be trimmed to the next cue's start. [PORT CP-007] [CAPCUT CC-201] [NEW]

#### Scenario: Valid file
- **WHEN** an SRT with 3 cues, the second using `.` as the millisecond separator, is imported
- **THEN** 3 captions are created with timings equal to the file to the millisecond

#### Scenario: Skipped cues
- **WHEN** an SRT contains 10 cues of which 2 have an end time before the start time
- **THEN** 8 captions are created and the import summary reads "8 captions imported, 2 skipped"

#### Scenario: Markup
- **WHEN** a cue's text is `<i>Hello</i> <font color="red">world</font>`
- **THEN** the caption text is "Hello world" with no tags

### Requirement: Import WebVTT
Import SHALL accept `.vtt` files beginning with the `WEBVTT` signature. Parsing SHALL: accept timestamps `HH:MM:SS.mmm` and `MM:SS.mmm`; skip `NOTE`, `STYLE` and `REGION` blocks; treat cue identifiers as not required; strip cue tags (`<c>`, `<v Speaker>`, `<b>`, `<i>`, `<u>`, `<ruby>`, `<lang>`), storing the `<v>` voice name as `speaker`; convert inline word timestamps (`<00:00:01.500>`) into `words[]`; honour the cue settings `line` (mapped to anchor top when below 50 %, otherwise bottom) and `align` (start/left → left, center/middle → center, end/right → right) as per-caption overrides; ignore `position`, `size`, `vertical` and `region` and report them once in the import summary. A file without the signature SHALL be rejected with "Not a valid WebVTT file". [CAPCUT CC-201] [NEW]

#### Scenario: Word timestamps
- **WHEN** a cue contains `Hello <00:00:01.500>world`
- **THEN** the caption has two entries in `words[]` and the second starts 1.5 s after the file origin minus the cue start

#### Scenario: Missing signature
- **WHEN** a `.vtt` file does not start with `WEBVTT`
- **THEN** no captions are created and the error "Not a valid WebVTT file" is shown

### Requirement: Import ASS
Import SHALL accept `.ass` and `.ssa` files. Honoured fields: `PlayResX` / `PlayResY` (defaults 384×288); from the style referenced by each Dialogue event — Fontname, Fontsize (converted as a ratio of PlayResY to the caption `fontSize`), PrimaryColour (`&HAABBGGRR`, alpha inverted), Bold, Italic, Underline, StrikeOut, Spacing, Alignment 1–9 (numpad layout mapped to anchor and `textAlign`), MarginL, MarginR, MarginV, OutlineColour and Outline (mapped to stroke colour and width when BorderStyle = 1), BackColour (mapped to the text background when BorderStyle = 3), Shadow (mapped to shadow distance with the default shadow colour); from events — Start, End, Style, Name (stored as `speaker`), Text with `\N` and `\n` as line breaks and `\h` as a non-breaking space. Ignored and reported once each in the import summary: all `{...}` override tags (stripped from the text), Angle, ScaleX, ScaleY, Encoding, event Layer, event Effect, karaoke tags, drawing commands, Comment and other non-Dialogue events, and events whose style is missing (which use the default caption style). The most frequent style among Dialogue events SHALL become the track style and other styles SHALL become per-caption overrides. [PORT CP-008] [CAPCUT CC-201] [NEW]

#### Scenario: Style mapping
- **WHEN** an ASS file with PlayResY 1080 and a style Fontsize 54, Bold −1, Alignment 8 is imported into a 1920×1080 project
- **THEN** captions are bold, anchored at the top centre, and their rendered font size is 54 px (`fontSize` 4.5)

#### Scenario: Override tags stripped
- **WHEN** a Dialogue text is `{\pos(100,200)\b1}Hi\Nthere`
- **THEN** the caption text is "Hi" and "there" on two lines and the summary lists "override tags ignored"

#### Scenario: Missing style
- **WHEN** an event references a style that is not defined
- **THEN** the caption is created with the default caption style and the summary lists the missing style name

### Requirement: Subtitle import flow and errors
Subtitle import SHALL accept files up to 10 MB by file picker on every platform and by drag-and-drop onto the Captions panel or the timeline on desktop and web. Text encoding SHALL be detected from a byte-order mark (UTF-8, UTF-16 LE/BE) and otherwise decoded as UTF-8; when UTF-8 decoding yields replacement characters the dialog SHALL offer an encoding select (UTF-8, UTF-16, Windows-1252, Shift_JIS, GBK, Big5, EUC-KR, Windows-1258) with a live preview of the first 5 cues. Before inserting, an import dialog SHALL show the cue count, the detected language field (editable), a time offset field (−24 h to +24 h, default 0, typed as timecode) and a "Start at playhead" switch (default off). After import a summary SHALL list imported, skipped and trimmed counts and every ignored-feature warning. Cues beyond the scene duration SHALL still be imported. A file with zero valid cues SHALL create nothing and show "No captions found in this file". [PORT CP-007, CP-008] [NEW]

#### Scenario: Offset
- **WHEN** the user imports with a time offset of +00:00:02:00 at 30 fps
- **THEN** every caption starts 2 s after its time in the file

#### Scenario: Oversized file
- **WHEN** the user selects a 25 MB `.srt`
- **THEN** the import is refused with "Subtitle files can be up to 10 MB"

#### Scenario: Unsupported extension
- **WHEN** the user drops a `.docx` file on the Captions panel
- **THEN** nothing is imported and the message lists the accepted formats SRT, VTT, ASS and SSA

### Requirement: Auto captions on device
"Generate" with "Run on: This device" SHALL transcribe speech on the device with a Whisper ONNX model (`captions-subtitles.Transcription model picker`) running in a background worker of the engine surface (on mobile inside the engine WebView of `mobile-editor.Engine view native module`), without sending audio anywhere. Transcription SHALL run per source asset, not on a timeline mixdown: for each distinct audible source asset of the chosen source (`captions-subtitles.Caption source selection`) the audio of the source range that is used on the timeline (plus 1 s of handle on each side) SHALL be decoded, resampled to 16 kHz mono and processed in 30 s chunks with a 5 s stride with word-level timestamps, producing or extending that asset's source transcript (`captions-subtitles.Source transcripts`); an asset whose transcript already covers the needed range for the same model and language option SHALL NOT be transcribed again. The caption track SHALL then be built by projecting each transcript word through the trim, retime and reverse of every clip that uses the asset (`render-engine.Source time mapping for retimed clips`), keeping words whose projected midpoint lies inside the clip's visible range, ordering all words by timeline time and grouping them by `captions-subtitles.Caption grouping`. The result SHALL be inserted as a new caption track with `words[]` populated, as one undo step, and the Captions list SHALL scroll to the first caption. If the scene already has a caption track with the same `sourceId` and language, a dialog SHALL ask "Replace existing captions" or "Add as new track". Accuracy SHALL be verified on the speech fixtures of `ai-editing-tools.AI acceptance fixtures`: word error rate at most 12 % with `small` and at most 20 % with `tiny` on the English fixture set, and a median word-start error of at most 150 ms. [PORT CP-002, CP-006] [CAPCUT CC-193]

#### Scenario: Generate
- **WHEN** the user generates captions for a 60 s clip from the English fixture set with a cached `small` model
- **THEN** a caption track appears whose captions carry word timings, the word error rate against the fixture reference is at most 12 %, and the device makes no network request

#### Scenario: Same asset in two clips
- **WHEN** one video asset is used by two clips on the timeline (source ranges 0–10 s and 20–30 s) and the user generates captions
- **THEN** the asset has one source transcript, no source second is transcribed twice, and both clips receive captions at their own timeline positions

#### Scenario: Retimed clip
- **WHEN** a clip plays its source at 2× and the word "hello" starts at source time 4.0 s inside the clip's range that begins at source time 0
- **THEN** the caption word "hello" starts 2.0 s after the clip's start on the timeline

#### Scenario: Existing track
- **WHEN** captions already exist and the user generates again from the same source
- **THEN** the Replace / Add as new track dialog is shown before any change

#### Scenario: No speech
- **WHEN** the source contains only music without vocals and no words are recognised
- **THEN** no track is created and the message "No speech was detected" is shown

### Requirement: Source transcripts
A source transcript SHALL be a derived artefact of one media asset: `{assetSha256, modelId, languageOption, language, coveredRanges[] {start, end}, words[] {text, start, end, confidence, speaker?}}` with times in source time (ticks) and `confidence` 0–1; `speaker` is a stable label (`S1`, `S2`, …) present only when the model or provider that produced the transcript reports diarisation (the `transcription {diarisation}` flag of `generation-providers.Capability metadata`; no on-device model of `captions-subtitles.Transcription model picker` does), and captions built from such a transcript start a new caption at every speaker change and carry the label as the caption's `speaker` field, shown as a prefix only when the user turns on "Show speaker labels". It SHALL be keyed by `(assetSha256, modelId, languageOption)`, stored in the derived-data store of the device (`project-storage.Cache management`, category "analysis") and, when produced on the host, in the host store, and it SHALL be the single transcript used by captions, the Transcript panel, translation, and the tools `dub`, `auto-cut`, `long-to-shorts` and `smart-search` of `ai-editing-tools.Auto captions hand-off and shared transcript`, which reference this requirement. Source transcripts are never part of the project document and are never synced as project content; deleting one from the cache SHALL only cause re-transcription when it is next needed. Editing a caption's text SHALL NOT modify the source transcript. [NEW]

#### Scenario: Transcript reused by another tool
- **WHEN** captions were generated for an asset and the user then runs `auto-cut` on a clip of the same asset with the same model and language option
- **THEN** no transcription job runs and `auto-cut` reads the existing source transcript

#### Scenario: Cache cleared
- **WHEN** the user clears the analysis cache and regenerates captions
- **THEN** the asset is transcribed again and the existing caption tracks are unchanged until the user confirms Replace

### Requirement: Caption source selection
The Auto captions section SHALL offer the source: "Whole timeline" (default; every audible, unmuted audio source), "Main track", "Voiceover and audio tracks", and "Selected clips" (enabled when at least one selected element has audio). The source resolves to a set of clips (video elements with audio, audio elements, and — recursively — the audible clips inside compound elements); muted elements, deactivated elements and elements on muted tracks SHALL be excluded. When an in/out range is set (`timeline-editing.In/out range`), a switch "Only in/out range" (default on) SHALL limit transcription and the resulting captions to that range. The chosen source is stored on the caption track as `sourceId`. [CAPCUT CC-194] [NEW]

#### Scenario: Selected clip only
- **WHEN** one video clip from 10 s to 20 s is selected and the source is "Selected clips"
- **THEN** every generated caption lies between 10 s and 20 s

#### Scenario: Muted source
- **WHEN** the only audio track is muted and the source is "Voiceover and audio tracks"
- **THEN** Generate is disabled with the no-audio diagnostic

#### Scenario: Range only
- **WHEN** an in/out range of 5–15 s is set, the switch is on and the source is "Whole timeline"
- **THEN** no caption starts before 5 s or ends after 15 s

### Requirement: Transcription language list
The language select SHALL offer "Auto detect" (default) and exactly these 24 languages: English, Spanish, Italian, French, German, Portuguese, Russian, Japanese, Chinese, Korean, Vietnamese, Indonesian, Malay, Thai, Turkish, Arabic, Hindi, Dutch, Polish, Ukrainian, Swedish, Filipino, Greek and Hebrew (codes `en, es, it, fr, de, pt, ru, ja, zh, ko, vi, id, ms, th, tr, ar, hi, nl, pl, uk, sv, fil, el, he`). With Auto detect the detected language SHALL be stored on the track and shown in the track selector. The last chosen language SHALL be remembered per device. [PORT CP-003] [CAPCUT CC-193]

#### Scenario: Explicit language
- **WHEN** the user picks Vietnamese and generates
- **THEN** the caption track's language is `vi`

#### Scenario: Auto detect
- **WHEN** Auto detect is used on Japanese speech
- **THEN** the track's language is `ja` and the captions are in Japanese script

#### Scenario: List size
- **WHEN** the language select is opened
- **THEN** it lists "Auto detect" followed by exactly 24 languages

### Requirement: Transcription model picker
This requirement is the only definition of the Whisper model list; `generation-providers.Local providers` and `ai-editing-tools.On-device model management` reference it. The same list SHALL be offered on devices and on the host:

| `modelId` | Label | Parameters | `peakMemoryMiB` (upper bound) | Licence | Default on |
|---|---|---|---|---|---|
| `tiny` | Whisper Tiny | 39 M | 300 | MIT | mobile |
| `base` | Whisper Base | 74 M | 500 | MIT | — |
| `small` | Whisper Small | 244 M | 1 000 | MIT | desktop, web, host |
| `medium` | Whisper Medium | 769 M | 3 000 | MIT | — |
| `large-v3-turbo` | Whisper Large v3 Turbo | 809 M | 3 000 | MIT | — |

Each model's file URL on the content host, byte size, SHA-256, licence and measured `peakMemoryMiB` SHALL come from `ai-editing-tools.Model manifest`; a shipped manifest value of `peakMemoryMiB` SHALL NOT exceed the bound in this table. The bounds in the table are working limits: the device run of spike S6 (`mobile-editor.WebView capability spike matrix`, on the reference devices of `diagnostics-quality.Reference devices`) measures each model's peak memory on iOS, on Android and on the reference desktop, the measured values are written to the manifest, and the table bound is replaced by the measured value plus 10 % in the same change. Model files SHALL be downloaded only through `ai-editing-tools.On-device model management` (consent dialog naming the content host and the size, SHA-256 verification) from the content host row of `security-privacy.Network egress control`; no model hub is contacted directly. Admission is the rule of `ai-editing-tools.On-device model management`, stated here for this list: a model SHALL be selectable on a device only when its manifest `peakMemoryMiB` is at most 25 % of the device memory and, on iOS and Android alike — where the model runs inside the engine WebView's content process next to the engine's own memory budget — additionally at most 400 MiB and at most the engine-process headroom measured by the inference row of spike S6 (`mobile-editor.WebView capability spike matrix`) minus the mobile cache pools of `render-engine.Memory ceilings per platform`; other models SHALL be disabled with the tooltip "Not enough memory on this device" and remain available under "Run on: host". With the working bounds of the table a phone therefore admits `tiny` only, and `base` and larger run on the host. Device memory is the physical memory reported by the platform (Electron and native: exact; browsers: `navigator.deviceMemory`, which reports at most 8 GiB, so `medium` and `large-v3-turbo` are not admitted in a browser; a browser that does not expose `deviceMemory` is treated as having 4 GiB). The model select SHALL show for each row the label, the download size, and a "Downloaded" badge when cached. The choice SHALL be remembered per device, falling back to the largest admitted model not above the platform default when the remembered model is not admitted. Downloaded models SHALL be listed with their sizes and a Delete button on `settings-preferences.Personal storage page`. [PORT CP-011] [NEW]

#### Scenario: Defaults
- **WHEN** the Auto captions section is opened for the first time on a phone and on a desktop with 16 GiB
- **THEN** the phone preselects `tiny` and the desktop preselects `small`

#### Scenario: Choose a model
- **WHEN** the user selects `medium` on a desktop with 16 GiB of memory and generates
- **THEN** transcription runs with `medium` and the choice is preselected next time

#### Scenario: Admission boundary
- **WHEN** the device reports 4 096 MiB of memory
- **THEN** `tiny`, `base` and `small` are selectable and `medium` and `large-v3-turbo` are disabled with the tooltip

#### Scenario: Phone admits only what fits the engine process
- **WHEN** the Auto captions sheet is opened on a phone with 6 GiB of memory, on iOS and on Android
- **THEN** `tiny` is selectable, `base` and `small` are disabled for "This device" with the tooltip although 25 % of 6 GiB is 1 536 MiB, and all models are offered for "Run on: host" when a host is connected

#### Scenario: Browser without deviceMemory
- **WHEN** the editor runs in a browser that does not expose `navigator.deviceMemory`
- **THEN** memory is taken as 4 096 MiB: `tiny`, `base` and `small` are selectable and `medium` and `large-v3-turbo` are disabled

#### Scenario: Browser cap
- **WHEN** the editor runs in a browser on a machine with 32 GiB
- **THEN** `medium` and `large-v3-turbo` are disabled and the "Run on" select still offers them on a connected host

#### Scenario: Manifest above the bound
- **WHEN** the model manifest lists `small` with `peakMemoryMiB` 1 200
- **THEN** the build check fails naming the model

### Requirement: Transcription progress and cancel
While generating, the panel SHALL show a determinate progress bar with a stage label: "Downloading model {percent} %" (only when the model is not cached; resumable after interruption), "Preparing audio", then "Transcribing {percent} %" where percent = processed audio duration / total audio duration over all assets to transcribe, updated at least once per processed chunk, with an estimated time remaining after the second chunk. A Cancel button SHALL stop the worker within 1 s, create no track and no undo step, and restore the Generate button; source transcripts of assets that completed before the cancel SHALL be kept in the cache. Progress SHALL continue while the user edits; closing the project SHALL cancel the job after confirmation. A failed model download SHALL show "The model download failed" with Retry; an out-of-memory, a worker crash or — on iOS and Android — the termination of the engine WebView's content process while the job runs SHALL be attributed to the transcription job: the engine surface is restored by `mobile-editor.Engine surface lifecycle` without the "Preview restarted" toast and without counting toward its restart-loop counter, and the panel SHALL show "Transcription failed on this device" with the actions "Try a smaller model" and, when a host with the `host-analysis` feature is connected, "Run on host". [PORT CP-004] [NEW]

#### Scenario: Transcribing percentage
- **WHEN** 90 s of a 180 s source has been processed
- **THEN** the label reads "Transcribing 50 %"

#### Scenario: Cancel
- **WHEN** the user presses Cancel at 30 %
- **THEN** within 1 s the progress disappears, no caption track exists and the undo history is unchanged

#### Scenario: Offline without the model
- **WHEN** the device is offline and the chosen model is not cached
- **THEN** generation does not start and the message "This model needs to be downloaded once while online" is shown

#### Scenario: Worker out of memory
- **WHEN** the transcription worker is terminated for memory during a run
- **THEN** the message "Transcription failed on this device" is shown with "Try a smaller model", and no track is created

### Requirement: No-audio diagnostic
Generate SHALL be disabled with the inline message "There is no audio to transcribe" when the chosen source contains no audible audio (no element with audio, or all such elements or their tracks muted). The condition SHALL be registered as the project-scope diagnostic `transcription.no_audio` (severity `caution`) in the diagnostics registry of `diagnostics-quality` (requirement "Diagnostics registry"), and the Generate button SHALL subscribe to it, so that the message updates when the source selection or the timeline changes. [PORT CP-010]

#### Scenario: Images only
- **WHEN** the timeline contains only image elements
- **THEN** Generate is disabled and the message is shown

#### Scenario: Audio added
- **WHEN** the user adds a clip with audio
- **THEN** Generate becomes enabled within 500 ms without reopening the panel

### Requirement: Host-side transcription
The Auto captions section SHALL have a "Run on" select with "This device" (default) and the connected host by name. The host option SHALL be enabled only while a paired host that advertises the feature `host-analysis` is connected and the device holds the scope `jagentchill.generation.run`; otherwise it SHALL be disabled with the requires-host hint of `ai-editing-tools.Offline and no-provider behaviour`. A host run SHALL transcribe per source asset exactly as `captions-subtitles.Auto captions on device` does: an asset whose blob is already on the host (`cross-device-sync.Content-addressed media blobs`) is transcribed there without upload; for any other asset the device uploads a 16 kHz mono audio extract of the needed range through `cross-device-sync.Chunked resumable upload`. The job SHALL run in the server's job queue (`server-api.Background job queue`, kind `generation.transcription`) with the provider and model routed for the `transcription` role (`orc-model-routing.Role catalogue`); with the local Whisper provider the model list and default (`small`) are those of `captions-subtitles.Transcription model picker`. Job states `queued`, `running`, `succeeded`, `failed` and `cancelled` SHALL be shown with progress, and the result SHALL be returned as source transcripts and inserted exactly as on-device generation does. When the routed provider is not local to the host machine, the consent of `generation-providers.Data leaving the machine` and the cost estimate and budgets of `generation-providers.Cost estimate` and `generation-providers.Budgets with hard stop` SHALL apply before anything is sent. If the connection drops, the job SHALL continue on the host and its result SHALL be offered when the device reconnects. [NEW]

#### Scenario: Host run
- **WHEN** the user generates with "Run on" set to the host while connected
- **THEN** progress reflects the host job state and the resulting caption track is inserted as one undo step

#### Scenario: Asset already on the host
- **WHEN** the clip's original blob is already stored on the host
- **THEN** no audio is uploaded for that asset

#### Scenario: Not connected
- **WHEN** no host is connected
- **THEN** the host option is disabled with the requires-host hint

#### Scenario: External provider consent
- **WHEN** the transcription role routes to a cloud provider and the user runs on the host for the first time
- **THEN** the consent card naming the provider is shown and nothing leaves the host until the user allows it

#### Scenario: Viewer device
- **WHEN** the device's role is viewer
- **THEN** the host option is disabled with the reason that this device cannot start jobs

### Requirement: Caption grouping
Recognised words SHALL be grouped into captions by these options (remembered per device): "Words per caption" 1–12 (default 3); "Minimum duration" 0.3–3 s (step 0.1, default 0.8 s); "Maximum characters per line" 10–80 (default 42); "Break at punctuation" (default on: a caption ends after `. ! ? 。 ！ ？` even when the word limit is not reached). For languages written without spaces (Chinese, Japanese, Thai) the unit SHALL be characters with a default of 12 per caption. Within a recognised segment, caption timing SHALL follow word timestamps; a caption shorter than the minimum duration SHALL be extended, and starts SHALL be pushed so that captions never overlap. "Regroup" in the Captions list SHALL re-apply new options to a track that has `words[]` as one undo step. Manual edits are known from the element flag `edited` (`project-document.Caption element`, set by any command that changes `text`, `translation` or `words` after generation): when at least one caption of the track has `edited: true`, Regroup SHALL first ask "{n} captions were edited by hand. Regrouping replaces their text." with Regroup and Cancel; with none edited it runs without a question. [PORT CP-005] [NEW]

#### Scenario: Default grouping
- **WHEN** the phrase "one two three four five six seven" is recognised without punctuation and with default options
- **THEN** three captions are produced: "one two three", "four five six", "seven"

#### Scenario: Minimum duration
- **WHEN** a caption's words span 0.3 s
- **THEN** the caption lasts 0.8 s and the next caption starts no earlier than its end

#### Scenario: Regroup
- **WHEN** the user changes Words per caption to 6 and presses Regroup on an unedited track
- **THEN** the track is rebuilt with up to 6 words per caption and one undo restores the previous captions

### Requirement: Edit caption text and timing
Each row of the Captions list SHALL show start and end timecodes and an editable text field. Clicking a row SHALL seek to the caption start and select the caption; during playback the row of the caption at the playhead SHALL be highlighted and kept in view. Editing: typing changes `text` (committed on blur as one undo step); Enter with the caret inside the text SHALL split the caption at the caret, placing the split time at the word boundary from `words[]` (or proportionally by character count when word timings are absent); Backspace at the start of a row or the "Merge with previous" button SHALL merge it with the previous caption; start and end fields accept timecodes and are clamped so that captions do not overlap and each lasts at least 1 frame; "Add caption" SHALL insert an empty 2 s caption at the playhead when that range is free (shortened to the free gap, refused with a toast when the gap is under 1 frame), creating a caption track when the scene has none; Delete removes the selected captions. Editing `text` SHALL re-distribute `words[]` over the same time span by character count. Trim, move, split and delete of caption bars on the timeline SHALL follow `timeline-editing.Trimming elements`, `timeline-editing.Moving elements`, `timeline-editing.Split` and `timeline-editing.Delete and ripple delete`. [CAPCUT CC-197] [NEW]

#### Scenario: Split at caret
- **WHEN** the caret is between "hello" and "world" in a caption "hello world" and the user presses Enter
- **THEN** two captions "hello" and "world" exist and the boundary is the start time of the word "world"

#### Scenario: Merge
- **WHEN** the user presses Backspace at the start of the second of two adjacent captions
- **THEN** one caption spans both time ranges with the texts joined by a space

#### Scenario: Timing clamp
- **WHEN** the user types an end time after the next caption's start
- **THEN** the end time becomes the next caption's start

#### Scenario: Add caption with no track
- **WHEN** the scene has no caption track and the user chooses "Add caption" at 3 s
- **THEN** a caption track is created with one empty caption from 3 s to 5 s, as one undo step

### Requirement: Batch caption editing
The Captions list SHALL support multi-selection (click, Shift-click range, Ctrl/Cmd-click toggle, Select all) and a batch bar with: Delete; Shift timing (± offset as timecode, applied to the selection or the whole track); Find and replace (plain text, with "Match case" and "Whole word" options, Replace and Replace all, showing the match count); Convert to text; Separate (moves the selection to a new caption track). An "Apply to all" switch (default on) SHALL make style, position and animation edits apply to the track style; with it off, edits SHALL be stored as overrides on the selected captions only, and overridden captions SHALL show a dot marker in the list with a "Reset to track style" action. Each batch action SHALL be one undo step. [CAPCUT CC-196] [NEW]

#### Scenario: Replace all
- **WHEN** the user replaces "color" with "colour" using Replace all and 7 captions match
- **THEN** 7 captions change, the dialog reports "7 replaced", and one undo reverts all 7

#### Scenario: Style applies to all
- **WHEN** "Apply to all" is on and the user changes the font size of one caption
- **THEN** every caption on the track renders with the new size

#### Scenario: Override one caption
- **WHEN** "Apply to all" is off and the user changes one caption's colour
- **THEN** only that caption changes and it shows the override marker

#### Scenario: Shift timing
- **WHEN** the user shifts the whole track by −0.5 s and the first caption starts at 0.2 s
- **THEN** the first caption starts at 0 with its end shifted by −0.5 s (minimum duration 1 frame), and all others move by −0.5 s

### Requirement: Caption style templates
The Style button SHALL open a gallery of exactly the 24 bundled caption styles enumerated in `captions-subtitles/catalog.md` (normative: id, name, font, weight, case, size, fill, stroke, shadow, glow, background, layout, highlight and animation), including the style `lyrics`, shown as animated thumbnails rendered by the engine from the style's real values with the sample line "The quick brown fox", plus "My styles". Bundled styles use only the bundled fonts of `text-and-titles.Bundled fonts` and the text animations of `text-and-titles.Text animations in, out and loop`. Choosing a style SHALL apply it to the track style and set the track's `styleId` (or apply it to the selected captions when "Apply to all" is off) as one undo step, preserving text and timing. "Save as style" SHALL store the current track style under My styles (name 1–60 characters, at most 200 items) per device, synced by `cross-device-sync.Library item sync` and exportable in a preset pack (`templates.Preset packs`). The Text and Animation inspector tabs of a caption (`preview-canvas.Inspector structure per element type`) SHALL expose the controls of `text-and-titles.Text inspector layout` (Basic section, without Bubble and Templates) and of `text-and-titles.Text animations in, out and loop`. [CAPCUT CC-196] [NEW]

#### Scenario: Exactly 24 offline
- **WHEN** the style gallery is opened on a fresh install with no network
- **THEN** it lists exactly 24 bundled styles whose ids equal the catalogue ids in order

#### Scenario: Apply a style
- **WHEN** the user picks the bundled style `boxed`
- **THEN** all captions on the track render in Arial 400 with a `#000000b3` background of corner radius 20 and no stroke, and their text and timing are unchanged

#### Scenario: Save and reuse
- **WHEN** the user saves the current style as "Podcast" and applies it in another project
- **THEN** the other project's captions take the same appearance

### Requirement: Word-level highlight
A caption track SHALL have the object `caption.highlight {style, color, textColor, scale}` (`project-document.Caption track fields`; written `highlight.*` below). `highlight.style` is one of: none (default), color (the active word takes `highlight.color`), background (a rounded box in `highlight.color` behind the active word, with the word in `highlight.textColor`), scale (the active word is scaled by `highlight.scale` 1.0–2.0, default 1.2), underline, karaoke (words fill progressively from the base colour to `highlight.color` left to right in step with their timing, already-spoken words staying filled), and reveal (words not yet spoken are hidden). `highlight.color` default `#ffd400`, `highlight.textColor` default `#000000`. The active word SHALL be the one whose `[start, end)` contains the playhead; between words the previous word stays active. When a caption has no `words[]`, timings SHALL be synthesised by distributing the caption duration over its words in proportion to their character counts. Highlight SHALL render identically in preview and export. [CAPCUT CC-204] [NEW]

#### Scenario: Colour highlight
- **WHEN** highlight style is color and the playhead is within the second word of a caption
- **THEN** only the second word is drawn in `#ffd400`

#### Scenario: Karaoke
- **WHEN** highlight style is karaoke and the playhead is halfway through the third word
- **THEN** words one and two are fully filled and the third word is filled over its left half

#### Scenario: Imported captions without word timings
- **WHEN** an SRT caption "ab cdef" lasting 3 s uses highlight style color
- **THEN** "ab" is active for the first 1 s and "cdef" for the remaining 2 s

### Requirement: Translate captions
This capability is the only owner of caption translation; the tool `translate` of `ai-editing-tools.Caption translation` is an entry point that opens this flow. "Translate" SHALL translate a caption track into a chosen target language using the provider routed for the `translation` role (`orc-model-routing.Role catalogue`) as a job of kind `generation.translation`; it needs a host and a device holding the scope `jagentchill.generation.run` (roles `editor` and `admin`), and SHALL otherwise be disabled with the requires-host state and string of `ai-editing-tools.Offline and no-provider behaviour`. Target languages SHALL be the 24 languages of `captions-subtitles.Transcription language list` intersected with the locales the routed model advertises, excluding the track's own language. The request SHALL send caption text in batches that preserve the caption boundaries and SHALL return exactly one translation per caption; a response with a different count for a batch SHALL be treated as a failure of that batch. Glossary: the dialog SHALL offer a glossary of up to 200 term pairs `{source, target}` (each side 1–80 characters), stored in the project's root field `glossaries {[targetLanguage]: [{source, target}]}` (`project-document.Project-level stores`); every glossary source term found in a caption (case-insensitive, whole word for space-separated scripts) SHALL be rendered with its target term. Re-wrap: each translation SHALL be wrapped to the track's "Maximum characters per line" (`captions-subtitles.Caption grouping`) and to at most 2 lines, breaking at word boundaries or, for scripts without spaces, between characters. Output mode: "Bilingual" (default; stores each result in `translation` and sets the track's `translationLanguage`) or "New track" (creates a separate caption track in the target language with the same timings). Consent, cost estimate and budgets are those of `generation-providers.Data leaving the machine`, `generation-providers.Cost estimate` and `generation-providers.Budgets with hard stop`. Progress, Cancel and partial failure SHALL be handled: captions whose translation failed SHALL be listed with a "Retry failed" action and SHALL keep an empty translation. The operation SHALL be one undo step. Spoken dubbing of translated captions is defined in `ai-editing-tools.Dubbing`. [CAPCUT CC-195, CC-203] [NEW]

#### Scenario: Bilingual translation
- **WHEN** an English track of 50 captions is translated to Japanese in Bilingual mode
- **THEN** all 50 captions have a Japanese `translation`, timings are unchanged, and one undo removes the translations

#### Scenario: Glossary term
- **WHEN** the glossary maps "Gateway" to "ゲートウェイ" and a caption reads "Open the gateway settings"
- **THEN** the caption's translation contains "ゲートウェイ"

#### Scenario: Glossary limit
- **WHEN** the glossary holds 200 pairs and the user adds another
- **THEN** the pair is refused with "Glossary limit reached (200)"

#### Scenario: Re-wrap
- **WHEN** "Maximum characters per line" is 20 and a translation is 34 characters of space-separated text
- **THEN** the translation is stored on two lines, neither longer than 20 characters

#### Scenario: Partial failure
- **WHEN** the provider fails for 3 of 50 captions
- **THEN** 47 translations are stored, the panel shows "3 captions were not translated" with "Retry failed"

#### Scenario: No host
- **WHEN** no host is connected
- **THEN** Translate is disabled with the requires-host state

#### Scenario: Language not offered by the model
- **WHEN** the routed model does not advertise Hebrew
- **THEN** Hebrew is absent from the target list

### Requirement: Bilingual caption rendering
When captions have a `translation`, the track SHALL render two blocks per caption: the primary text and the translation, stacked with a gap of 0.3 × the primary line height. Track options are the object `caption.bilingual {visible, order, scale, color?}` (`project-document.Caption track fields`; written `bilingual.*` below): `bilingual.visible` (default true), `bilingual.order` (`below` (default) or `above`), `bilingual.scale` (50–150 % of the primary font size, default 80), and `bilingual.color` (fill colour of the translation; absent = same as primary). Both blocks SHALL share the anchor and stay inside `maxWidth`. The translation SHALL be editable in a second text field on each list row. Word-level highlight SHALL apply to the primary text only. [CAPCUT CC-195] [NEW]

#### Scenario: Two lines
- **WHEN** a caption has text "Hello" and translation "こんにちは" with default options
- **THEN** "Hello" is drawn above "こんにちは", which is rendered at 80 % of the primary size

#### Scenario: Hide the translation
- **WHEN** `bilingual.visible` is turned off
- **THEN** only the primary text is rendered and the stored translations are kept

### Requirement: Auto lyrics
The Auto captions section SHALL have a mode switch "Speech" (default) / "Lyrics". Lyrics mode SHALL: default the source to the selected audio element or, when none is selected, the audio tracks; group by sung line instead of by word count (a line ends at a gap of 0.6 s or more between the end of one word and the start of the next, and after at most 10 words); omit the sentence punctuation `. , ! ? ; :` and their full-width forms; and apply the bundled caption style `lyrics` of `captions-subtitles/catalog.md`. All other behaviour (per-asset transcription, language, model, progress, cancel, host option, undo) SHALL equal Speech mode. On the lyrics fixture of `ai-editing-tools.AI acceptance fixtures` every generated line break SHALL lie within 0.3 s of a labelled line break. [CAPCUT CC-198] [NEW]

#### Scenario: Lyrics from a music clip
- **WHEN** the user selects a song on an audio track, switches to Lyrics and generates
- **THEN** captions are grouped per sung line with the `lyrics` style (karaoke highlight) and no trailing full stops

#### Scenario: Line break rule
- **WHEN** recognised words have gaps of 0.2 s, 0.2 s, 0.7 s and 0.2 s between them
- **THEN** two captions are produced, the first with three words and the second with two

#### Scenario: Fixture line breaks
- **WHEN** the lyrics fixture is transcribed in Lyrics mode
- **THEN** each generated caption boundary is within 0.3 s of a labelled line break

### Requirement: Transcript panel
This capability owns transcript editing. The Transcript asset tab (desktop and web; mobile entry: see `mobile-editor.More sheet` and `mobile-editor.Captions, Stickers, Templates and AI tools groups`) SHALL show, for the active caption track when it has `words[]`: the full text as flowing paragraphs (a new paragraph at a gap of 2 s or more, or at a speaker change) in which every word is clickable (click seeks to the word start), the word at the playhead is highlighted during playback, and a search field highlights matches with next/previous navigation. Double-clicking a word SHALL edit its text in place (1–80 characters), updating the caption that contains it as one undo step. Fillers and pauses SHALL be marked visually with the counters "{n} fillers" and "{n} pauses"; which words are fillers (per-language lists) and where pauses are (silence analysis) is detected by the tool `auto-cut` of `ai-editing-tools.Auto cut by silence, fillers and script`, with the pause threshold set in this panel (0.2–5.0 s, step 0.1, default 0.5 s) and padding (0–1.0 s, step 0.05, default 0.1 s kept on each side of a cut). Three edit actions SHALL exist: selecting a word range and pressing Delete; "Remove fillers"; and "Remove pauses". "Remove fillers" and "Remove pauses" SHALL first show the review list of `auto-cut` (each candidate with a checkbox, a play button and its duration; all checked by default) and apply on confirmation. Each action SHALL remove the corresponding timeline time ranges through the range-removal command of `timeline-editing.Transcript-driven cuts` (which owns the timeline result: ripple, linked elements, transitions) and SHALL remove or re-time the affected caption words, all as one undo step. A track without `words[]` SHALL show "Transcript needs word timings — generate captions to use it" and no removal actions; a scene with no caption track SHALL show the empty state "No transcript yet" with a "Generate captions" button that opens the Auto captions section. [CAPCUT CC-202, CC-070, CC-071] [NEW]

#### Scenario: Click a word
- **WHEN** the user clicks a word whose timing starts at 12.4 s
- **THEN** the playhead is at 12.4 s snapped to the nearest frame

#### Scenario: Delete a word range
- **WHEN** the user selects the words spanning 5.0–7.5 s and presses Delete
- **THEN** the timeline range 5.0–7.5 s is removed by the range-removal command, the content after it moves 2.5 s earlier, the captions no longer contain those words, and one undo restores everything

#### Scenario: Remove fillers with review
- **WHEN** detection reports 6 fillers, the user chooses "Remove fillers", unchecks one candidate and confirms
- **THEN** 5 time ranges are removed from the timeline, the captions no longer contain those 5 words, and one undo restores everything

#### Scenario: Pause threshold
- **WHEN** the pause threshold is 0.5 s with padding 0.1 s and two words are separated by 1.4 s of silence
- **THEN** "Remove pauses" removes 1.2 s between them, leaving 0.1 s on each side

#### Scenario: Correct a word
- **WHEN** the user double-clicks the word "there" and types "their"
- **THEN** the caption containing it reads "their" at the same time span and the source transcript is unchanged

#### Scenario: Track without word timings
- **WHEN** the active track was imported from SRT without word timestamps
- **THEN** the Transcript tab shows the hint and no removal actions

### Requirement: Export captions
The Export button of the Captions section SHALL export a caption track as SRT, WebVTT, ASS or TXT, encoded as UTF-8 without BOM with `\n` line endings (SRT with `\r\n`); the same writer produces the sidecar files of `captions-subtitles.Burn-in and sidecar captions at export`. Options: track; content — Primary, Translation, or Both (the primary text on the first line and the translation on the second line of the same cue, in one file); range (whole scene or in/out range); for TXT, "Include timestamps" (default off; when off, one caption per line; when on, each line is prefixed with `[HH:MM:SS.mmm]`). Timestamps SHALL be the element times rounded to the nearest millisecond; cues SHALL be numbered from 1 in time order; hidden tracks SHALL be exportable; empty captions SHALL be omitted. WebVTT SHALL include inline word timestamps when `words[]` exist and "Include word timings" is on (default off). ASS SHALL carry one style derived from the track style (font, size relative to PlayResY = canvas height, primary colour, bold, italic, outline, shadow, alignment, vertical margin). The default file name SHALL be `<projectName>.<language>.<ext>`, where the language segment is always present and is `und` when the track language is unknown, and the name is sanitised by `export-share.Filename sanitisation`. Caption files SHALL be exportable without rendering the video and without a host. Exporting a track with no captions SHALL be refused with "There are no captions to export". [PORT N-015] [CAPCUT CC-199, CC-200] [NEW]

#### Scenario: SRT content
- **WHEN** a track with captions at 1.0–2.5 s "Hi" and 3.0–4.0 s "Bye" is exported as SRT
- **THEN** the file is `1\r\n00:00:01,000 --> 00:00:02,500\r\nHi\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nBye\r\n`

#### Scenario: TXT without timestamps
- **WHEN** the same track is exported as TXT with timestamps off
- **THEN** the file contains exactly the two lines "Hi" and "Bye"

#### Scenario: Bilingual export
- **WHEN** content "Both" is chosen for a bilingual track exported as VTT
- **THEN** one file is written in which each cue has the primary text on its first line and the translation on its second

#### Scenario: Unknown language in the file name
- **WHEN** a track with language `und` in project "Trip" is exported as SRT
- **THEN** the default file name is `Trip.und.srt`

#### Scenario: Round trip
- **WHEN** an exported SRT is imported into an empty project
- **THEN** the captions have the same text and timings to the millisecond

### Requirement: Burn-in and sidecar captions at export
This capability owns burn-in semantics; the export dialog that presents them is owned by `export-share.Caption burn-in and sidecar options`. Each caption track SHALL have the stored switch `caption.burnIn` (default on), editable on the track header and in the Layout sub-tab of `captions-subtitles.Caption inspector tab` (desktop and web), in the Captions panel, and on mobile — which has no track header — in the caption row of the Tracks tab of `mobile-editor.Layers sheet`, in the Layout tab of the caption style sheet and through `bcap.burn-in` of `mobile-editor.Caption tool strips`. At video export a caption track SHALL be rendered into the picture if and only if all of these hold: the export's master switch "Burn captions into video" is on (default on; off burns no track); the track's `burnIn` is on; and the track is not hidden. A track with `burnIn` off remains visible in the preview with a "sidecar" badge on its header. The export option "Also save caption files" SHALL offer the formats SRT, VTT, ASS and TXT, a track selector (default: every track with captions) and the content choice Primary / Translation / Both of `captions-subtitles.Export captions`, and SHALL write one file per selected track next to the video, named `<videoFileName>.<language>.<ext>` with the language segment always present (`und` when unknown; when two selected tracks share a language the second and further files insert `-2`, `-3` before the extension). Sidecar files SHALL be written for visible and hidden tracks alike and SHALL NOT depend on the master switch. Burned-in captions SHALL match the full-quality preview within the preview-versus-export tolerance of `render-engine.Golden-frame determinism`. Agent exports use the parameter `captions {burn, sidecar?}` of `agent-editing-tools.Export tools` with the same meaning as the master switch and the sidecar format. [NEW]

#### Scenario: Sidecar only
- **WHEN** a track has `burnIn` off and the export is made with "Also save caption files: SRT"
- **THEN** the video has no caption pixels and `<videoFileName>.<language>.srt` is written next to it

#### Scenario: Burned in
- **WHEN** a visible track has `burnIn` on and the master switch is on
- **THEN** the exported frames contain the captions as in the full-quality preview within the stated tolerance

#### Scenario: Master switch off
- **WHEN** two visible tracks have `burnIn` on and the master switch is off
- **THEN** the exported frames contain no caption pixels and both tracks still have `burnIn` on in the project

#### Scenario: Hidden track
- **WHEN** a hidden track has `burnIn` on and is selected for a VTT sidecar
- **THEN** it is not rendered into the picture and its `.vtt` file is written

#### Scenario: Two tracks in one language
- **WHEN** two English tracks are selected for SRT sidecars of `clip.mp4`
- **THEN** the files are `clip.en.srt` and `clip.en-2.srt`

### Requirement: Captions on touch devices
On mobile the caption tools are reached through `mobile-editor.Captions, Stickers, Templates and AI tools groups` and `mobile-editor.Caption tool strips`, which own the strips; this requirement defines the content of the sheets they open. Auto captions and Auto lyrics SHALL open a sheet with mode, source, language, model and "Run on" controls and a Generate button; progress SHALL be shown in the sheet and, when the sheet is closed, as a chip above the timeline that reopens it. "Edit captions" SHALL open the list editor as a list sheet of `mobile-editor.Tool sheets never cover the preview` (full height below a preview pinned at exactly 35 % of the screen height), supporting the same edit, split, merge, multi-select and batch actions as the desktop list. Style (`ccap.style`, `bcap.style`, `cap.styles`) SHALL open the **caption style sheet**, a `canvasInteractive` sheet with an "Apply to all" switch in its header (default on; the switch of `captions-subtitles.Batch caption editing`) and the tabs: Templates (the gallery of `captions-subtitles.Caption style templates` with My styles and "Save as style"); Text (font, size, fill, stroke, shadow, glow, background, alignment and spacing — the Style tab of the text sheet of `text-and-titles.Text on touch devices` without Bubble, curve and box); Layout (anchor, marginY, maxWidth, "Show speaker labels", "Burn-in", and "Reset position"); Highlight (the style list and `highlight.color`, `highlight.textColor`, `highlight.scale`); Bilingual (shown when the track has a `translationLanguage`: visible, order, scale, colour). Every control writes the field the same control writes on desktop (`captions-subtitles.Caption inspector tab`); with "Apply to all" off the edits are overrides on the selected captions and a "Reset to track style" button appears in the header. Dragging or pinching a caption in the preview while the sheet is open follows `captions-subtitles.Caption default style and layout`. Transcript SHALL open `captions-subtitles.Transcript panel` as a list sheet of the same kind, where a word range is selected by long-press and drag and the three edit actions are buttons under the text. Translate SHALL open the translation dialog as a sheet including the glossary editor. Import and export SHALL use the system document picker and share sheet. [CAPCUT CC-193, CC-197] [NEW]

#### Scenario: Generate on a phone
- **WHEN** the user taps Captions, Auto captions and Generate
- **THEN** progress is shown and the caption bars appear on the timeline when it completes

#### Scenario: Caption style sheet on a phone
- **WHEN** one caption is selected on a phone and the user taps Style, opens Highlight and picks karaoke
- **THEN** `caption.highlight.style` of the track is `karaoke`, the preview shows it, and ✓ commits one undo step

#### Scenario: Override on a phone
- **WHEN** the user turns "Apply to all" off in the sheet header and changes the fill colour
- **THEN** only the selected caption's `style.color` is written and "Reset to track style" is offered

#### Scenario: Batch edit on a phone
- **WHEN** the user opens Edit captions, selects 5 rows and taps Delete
- **THEN** the 5 captions are removed as one undo step while the preview stays visible

#### Scenario: Transcript on a phone
- **WHEN** the user opens Transcript, long-presses a word, drags across three words and taps Delete
- **THEN** the three words' time range is removed from the timeline as one undo step
