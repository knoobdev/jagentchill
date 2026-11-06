## ADDED Requirements

### Requirement: Export entry points and dialog
The editor SHALL expose an Export action in the top bar of the editor on every platform and as the rebindable keyboard action `export.open` (its default binding is stated only in `keyboard-shortcuts.Default bindings for project, application, session and lists`). On desktop and web it opens a modal dialog 880 px wide (full width below 960 px viewport width) that starts with a segmented control "Export type" with exactly six values in this order — Video (default), GIF, Audio, Image sequence, Still frame, Captions only — followed by the cover thumbnail and output summary on the left and the settings of the chosen type on the right, grouped into collapsible sections (Video, Audio, Captions, GIF, Destination and Provenance, each shown only for the types it applies to), plus a footer showing duration, estimated size, the target ("This device" or "Host: <name>") and the primary button "Export". The export type is the stored `exportSettings.type` (`export-share.Export settings persistence`) with the values `video`, `gif`, `audio`, `image-sequence`, `still`, `captions`; choosing a built-in preset sets it. "Captions only" writes the caption files of `export-share.Caption burn-in and sidecar options` and starts no video or audio encoder; it is disabled with "This project has no captions" when the project has no caption track. There is no "video" or "audio" checkbox anywhere in the dialog: what is produced is decided by the export type and, for Video, by "Include audio". On mobile the entry is the export settings chip and Export button of the mobile top bar, and the quick sheet and full settings sheet are laid out by `mobile-editor.Export sheet`, whose tabs are the same six types; this capability defines every option, value, default and behaviour shown there, and the mobile sheets MUST offer the same option set as the desktop dialog. Every string naming the remote target uses the word "host" — "Host: <name>", "Export on host", "Retry on host" — and never "Gateway", which appears only in diagnostics and developer-facing text. Closing the dialog or sheet MUST NOT cancel a running export. All visual styling uses `design-system` tokens. [PORT EX-001] [CAPCUT CC-244]

#### Scenario: Open export on desktop
- **WHEN** the user invokes the `export.open` action in the editor with a non-empty timeline
- **THEN** the export dialog opens with the last used settings for this project, focus on the file name field, and the estimated size shown

#### Scenario: Six export types
- **WHEN** the export dialog is opened on desktop, on web and on a phone
- **THEN** the export type control offers Video, GIF, Audio, Image sequence, Still frame and Captions only, in that order, on all three

#### Scenario: Close dialog during an export
- **WHEN** an export is running and the user closes the export dialog
- **THEN** the export continues
- **AND** a progress indicator stays visible in the editor top bar

#### Scenario: Same options on mobile
- **WHEN** the full settings sheet is opened on a phone
- **THEN** every export type, codec, container, audio, caption, range, cover and provenance option of the desktop dialog is reachable in it with the same values and defaults

#### Scenario: The UI says host
- **WHEN** the locale resources of the export dialog, sheets, failure views and notifications are scanned
- **THEN** no user-facing string contains the word "Gateway"

### Requirement: Built-in export presets
The export dialog SHALL offer these built-in presets, each with a stable id and each setting every field of the export settings: `match-project` "Match project" (project canvas size and frame rate, H.264, MP4, Recommended bitrate, AAC 192 kbps 48 kHz stereo; the default for a project with no saved export settings), `1080p` "1080p" (short side 1080, 30 fps), `4k` "4K" (short side 2160, project frame rate, Higher bitrate), `small-720p` "Small file 720p" (short side 720, 30 fps, Lower bitrate, AAC 128 kbps), `vertical-9x16` "Vertical 9:16 short video" (1080×1920, 30 fps, H.264, MP4), `wide-16x9` "Widescreen 16:9" (1920×1080, project frame rate), `square-1x1` "Square 1:1" (1080×1080, 30 fps), `webm` "WebM" (VP9 + Opus), `gif` "GIF", `audio-only` "Audio only" and `image-sequence` "Image sequence". The ids are the only preset identifiers accepted by `jc_export_start`, workflow export nodes and automations. A preset whose aspect ratio differs from the project canvas MUST show the warning "Aspect ratio differs from the project; the picture is fitted with bars" and render the project contain-fitted over the resolved background. Changing any field after choosing a preset shows the preset name as "Custom".

Every preset that names H.264 with AAC in MP4 SHALL resolve by one rule on every target — macOS, Windows, Linux, web, iOS, Android and the host — so that no platform silently gets a different file: (1) when the selected target has an H.264 encoder and an AAC encoder (`export-share.Encoder availability and licensing`), the output is H.264 + AAC in MP4; (2) otherwise, on the desktop app, when the built-in host on the same computer is healthy and its codec table reports H.264 and AAC `available`, the target is preselected as "Host: This computer" and the output is H.264 + AAC in MP4 produced there; (3) otherwise the preset resolves to VP9 + Opus in WebM on the device, the dialog shows before the export starts "H.264 with AAC is not available here; exporting VP9 with Opus as WebM" with the action "Export on host" when another host is connected, and the preset name stays as chosen. Opus in MP4 is never the result of this rule; it is written only when the user selects it explicitly in `export-share.Audio settings for video export`. On a desktop Linux system, where the app's runtime has no AAC encoder, the default export of a new project is therefore H.264 + AAC in MP4 through rule (2) when the built-in host has both, and VP9 + Opus in WebM through rule (3) otherwise. [NEW] [PORT N-008]

#### Scenario: Default preset
- **WHEN** the export dialog is opened for the first time on a 1920×1080 30 fps project on a device with H.264 and AAC encoders
- **THEN** the preset is "Match project" with resolution 1920×1080, 30 fps, H.264, MP4, Recommended bitrate and audio on

#### Scenario: Preset with a different aspect ratio
- **WHEN** the "Vertical 9:16 short video" preset is chosen for a 16:9 project
- **THEN** the aspect warning is shown
- **AND** the exported frames contain the 16:9 picture contain-fitted in 1080×1920 over the project background

#### Scenario: Unknown preset id from a tool
- **WHEN** a host-initiated export names preset id `1080p-h264`
- **THEN** it is refused with `INVALID_PARAMS` listing the eleven valid ids

#### Scenario: Linux desktop with the built-in host
- **WHEN** "Match project" is exported on a Linux desktop whose app runtime has no AAC encoder and whose built-in host reports H.264 and AAC `available`
- **THEN** the target reads "Host: This computer" and the file is an MP4 with an H.264 video track and an AAC audio track

#### Scenario: Linux desktop without a usable host encoder
- **WHEN** "Match project" is exported on a Linux desktop with no AAC encoder in the app runtime and a built-in host whose H.264 row reads `download_required`
- **THEN** the notice names VP9 with Opus as WebM, the file is a `.webm` with VP9 and Opus, and no MP4 with an Opus track is written

### Requirement: User-saved export presets
Users SHALL be able to save the current settings as a named preset (name 1–40 characters, unique case-insensitively per device), rename, overwrite and delete saved presets, with at most 30 saved presets per device. Saved presets are stored in user preferences, listed after the built-in presets, and included in settings backup. A saved preset that references a codec the current device cannot encode stays selectable and resolves through the codec fallback rules. [NEW]

#### Scenario: Save a preset
- **WHEN** the user chooses "Save as preset", enters "Client review" and confirms
- **THEN** "Client review" appears in the preset list and selecting it restores every saved field

#### Scenario: Duplicate name
- **WHEN** the user saves a preset named "client review" while "Client review" exists
- **THEN** the dialog asks whether to overwrite the existing preset and performs no change until confirmed

#### Scenario: Preset limit
- **WHEN** 30 saved presets exist and the user chooses "Save as preset"
- **THEN** the action is refused with the message "Preset limit reached (30). Delete a preset to save a new one."

### Requirement: Resolution options
Video export SHALL offer the resolutions 480p, 720p, 1080p, 2K (1440p) and 4K (2160p), defined by the short side (480, 720, 1080, 1440, 2160 px) with the long side derived from the project aspect ratio and rounded to the nearest even integer, plus "Project" (canvas size, rounded to even) and "Custom" (width and height each an even integer from 128 to 4 096). The engine renders at the output resolution (vector text and graphics are rasterised at that size), so a resolution above the project canvas is permitted and labelled "Upscaled" when any raster source is smaller than its on-screen size. A resolution the selected codec cannot encode on this device MUST be shown disabled with the reason and the action "Export on host" when a host with remote export is connected. [PORT EX-006, N-008] [CAPCUT CC-245]

#### Scenario: 4K for a vertical project
- **WHEN** 4K is selected for a 1080×1920 project
- **THEN** the output size is 2160×3840

#### Scenario: Odd custom size
- **WHEN** the user types a custom width of 1001
- **THEN** the field corrects to 1002 on blur and the estimated size updates

#### Scenario: Resolution not encodable on this device
- **WHEN** the device's H.264 encoder reports 3840×2160 as unsupported
- **THEN** the 4K option is disabled with the text "Not supported by this device's H.264 encoder"
- **AND** "Export on host" is offered when a capable host is connected

### Requirement: Frame rate options
Video export SHALL offer the frame rates 24, 25, 30, 50 and 60 fps and "Project" (the project rational, including 23.976, 29.97, 59.94, 48 and 120), defaulting to "Project". When the export frame rate differs from the project frame rate, output frame `i` MUST be the project frame whose interval contains the output frame time (no blending), and animated values are evaluated at the output frame time. Directly under the frame-rate control the dialog SHALL show the switch "Smooth motion" (default off, stored with the export settings of `export-share.Export settings persistence`, enabled only when at least one video element in the range has a source frame rate below the export frame rate and its `smooth` is `"none"`); when on, those elements are rendered with the interpolation of `speed-retime.Frame-rate matching at export` for this export only, and when the capability check of `speed-retime.Smooth slow motion` fails on the exporting device or on the render host of the selected target the switch is disabled with "Optical flow is not available on this device". Timestamps written to the container MUST be exact rationals of the output frame rate. [PORT EX-006, N-008] [CAPCUT CC-246, CC-085]

#### Scenario: 60 fps project exported at 30 fps
- **WHEN** a 10 s 60 fps project is exported at 30 fps
- **THEN** the file contains 300 frames and each equals every second project frame

#### Scenario: 29.97 project
- **WHEN** a 29.97 fps project is exported with frame rate "Project"
- **THEN** the container reports a frame rate of 30000/1001

#### Scenario: Smooth motion is offered
- **WHEN** a project containing one 24 fps clip at 1× with `smooth: "none"` is exported at 60 fps
- **THEN** the "Smooth motion" switch is enabled and off, and turning it on renders that clip with interpolated in-between frames while the project document stays unchanged

#### Scenario: Smooth motion has nothing to do
- **WHEN** every video element in the range has a source frame rate at or above the export frame rate
- **THEN** the "Smooth motion" switch is disabled

### Requirement: Bitrate modes
Video bitrate SHALL be selected as Lower, Recommended, Higher, Maximum or Custom. Recommended for H.264 equals `10 Mbps × (width × height / 2 073 600)^0.75 × (fps / 30)^0.5`, rounded to 0.1 Mbps; Lower is 0.5×, Higher 1.5× and Maximum 2.5× of Recommended. The codec factor multiplies the result: HEVC 0.65, VP9 0.70, AV1 0.55. Custom accepts 0.2–200 Mbps in 0.1 Mbps steps. Rate control is "VBR" (default) or "CBR". The classic quality levels map as low → Lower, medium → Recommended, high → Higher, very high → Maximum when importing settings. The computed bitrate in Mbps MUST be displayed next to the selected level. [PORT EX-004, N-008] [CAPCUT CC-247]

#### Scenario: Recommended at 1080p30 H.264
- **WHEN** resolution is 1920×1080, frame rate 30 and codec H.264 with level Recommended
- **THEN** the displayed video bitrate is 10.0 Mbps

#### Scenario: Higher at 4K60 HEVC
- **WHEN** resolution is 3840×2160, frame rate 60, codec HEVC and level Higher
- **THEN** the displayed video bitrate is 39.0 Mbps (10 × 2.828 × 1.414 × 1.5 × 0.65, rounded to 0.1)

#### Scenario: Custom out of range
- **WHEN** the user enters a custom bitrate of 500 Mbps
- **THEN** the value is clamped to 200 Mbps

### Requirement: Video codecs with capability detection and fallback
Video export SHALL support H.264 (AVC), H.265 (HEVC), VP9 and AV1. For each codec the dialog MUST query the platform encoder for the exact width, height, frame rate and bitrate (`VideoEncoder.isConfigSupported`, checked for hardware and software acceleration) before enabling the option, re-querying within 200 ms whenever resolution, frame rate or bitrate change. An unsupported codec is shown disabled with the reason "Not supported on this device" and, when a host whose codec table lists that codec as `available` is connected, the action "Export on host". If the selected codec becomes unsupported after a settings change, the selection MUST fall back in the order H.264 → VP9 → HEVC → AV1 to the first codec that is supported and compatible with the container, and an inline notice names the change. H.264 uses High profile at the lowest level that fits the resolution and frame rate. Hardware acceleration is "Auto" (default), "Prefer hardware" or "Prefer software". When no video encoder at all is available on the device, on-device video export is disabled with the reason and only host export, image sequence, still, audio and captions-only exports remain. Which encoders each target is expected to have is stated in `export-share.Encoder availability and licensing`. [PORT EX-002, EX-003] [CAPCUT CC-248, CC-249]

#### Scenario: HEVC not supported on device
- **WHEN** the device reports HEVC encoding as unsupported
- **THEN** the HEVC option is disabled with "Not supported on this device"

#### Scenario: Automatic fallback after changing resolution
- **WHEN** AV1 is selected and the user raises the resolution to 4K, which the AV1 encoder rejects while H.264 accepts it
- **THEN** the codec switches to H.264 and the notice "AV1 cannot encode 3840×2160 on this device; switched to H.264" is shown

#### Scenario: No encoder available
- **WHEN** no video encoder is supported by the device and no host is connected
- **THEN** the video Export button is disabled with the reason "This device cannot encode video" and audio, still, image-sequence and captions-only exports remain enabled

### Requirement: Container formats
Video export SHALL write MP4 (H.264, HEVC or AV1 with AAC audio; VP9 or AV1 with Opus audio on the host), MOV (H.264 or HEVC with AAC audio, or ProRes with PCM audio on the host) and WebM (VP9 or AV1 with Opus audio). Selecting a container MUST restrict the codec list to compatible codecs, and selecting a codec incompatible with the current container MUST switch the container to the first compatible one in the order MP4, MOV, WebM with an inline notice. File extensions are `.mp4`, `.mov` and `.webm` with MIME types `video/mp4`, `video/quicktime` and `video/webm`. MP4 and MOV files MUST be written non-fragmented with the `moov` box finalised by positioned writes, on every target: desktop writes positioned to the destination file; web writes positioned to the File System Access stream or the origin-private file; iOS and Android write positioned to a file in the engine's own origin-private storage and copy the finalised file out afterwards (`export-share.Streaming write to disk`); the host's FFmpeg writes to a seekable file. No target produces a fragmented MP4 as an export result. [PORT EX-002, EX-003] [CAPCUT CC-250, CC-251]

#### Scenario: Selecting WebM
- **WHEN** the container is changed to WebM while H.264 is selected
- **THEN** the codec changes to VP9, the audio codec to Opus, and the notice "WebM requires VP9 or AV1; switched to VP9" is shown

#### Scenario: MOV output
- **WHEN** a project is exported as MOV with H.264
- **THEN** the file has extension `.mov`, a `qt  ` major brand and plays in a QuickTime-compatible player

#### Scenario: Non-fragmented on a phone
- **WHEN** a 1080p MP4 is exported on an iPhone and on an Android phone
- **THEN** each file contains exactly one `moov` box and no `moof` box

### Requirement: Audio settings for video export
Video export SHALL include an "Include audio" toggle (default on) and, when on, audio codec (AAC for MP4 and MOV, Opus for WebM), audio bitrate (AAC: 96, 128, 192, 256 or 320 kbps, default 192; Opus: 64, 96, 128, 192 or 256 kbps, default 128), sample rate (44 100 or 48 000 Hz, default 48 000) and channels (Stereo default, Mono). This requirement is the single owner of the output sample rate: it is an export setting, there is no project-level sample rate, and the mixdown of `render-engine.Audio mixdown for export` renders at the requested rate. The audio bitrate is independent of the video bitrate level. When the selected target has no AAC encoder (`audioEncoders.aac` false in the capability report of `render-engine.Engine capability probe and ready handshake`), MP4 and MOV with AAC are not silently altered: the AAC option is disabled with "Not supported on this device", and the dialog offers, in this fixed order, each as an explicit choice the user makes before the export starts: (1) "Export on host" when a connected host reports AAC `available` — on the desktop app the built-in host is preselected by the rule of `export-share.Built-in export presets`; (2) "WebM (VP9 + Opus)" when both encoders exist; (3) "Opus in MP4", shown with the warning "Some players do not play Opus audio in MP4"; (4) "16-bit PCM in MOV". An MP4 with PCM audio MUST never be written, and Opus in MP4 MUST never be produced without the user having chosen option (3) for that export or saved it in the project's export settings. On iOS and Android, where `constraints.audioEncode` of `render-engine.Capability constraints from the WebView spike` reports the first available of `aac`, `opus`, `pcm-mov`, `gateway-only`, the same four choices are offered and none is applied silently. A timeline with no audible source and "Include audio" on produces a silent audio track. [PORT EX-005, EX-010]

#### Scenario: Audio off
- **WHEN** "Include audio" is off
- **THEN** the exported file contains no audio track

#### Scenario: AAC unavailable, user picks Opus in MP4
- **WHEN** an MP4 export is configured on a device without an AAC encoder and with an Opus encoder, no host is connected, and the user chooses "Opus in MP4"
- **THEN** the warning about players is shown before export
- **AND** the exported MP4 contains an Opus audio track

#### Scenario: AAC unavailable, nothing chosen
- **WHEN** an MP4 export is configured on a device without an AAC encoder and the user has made no choice
- **THEN** the Export button is disabled with "Choose how to encode audio" and no file is written

#### Scenario: Neither AAC nor Opus
- **WHEN** an MP4 export is configured on a device with neither encoder and no host
- **THEN** the only offered choice is "16-bit PCM in MOV", choosing it switches the container to MOV
- **AND** no MP4 file with PCM audio is produced

#### Scenario: No audio encoder path on the device
- **WHEN** the capability report states `constraints.audioEncode: "gateway-only"` and a host advertising `remote-export` is connected
- **THEN** on-device video export with audio is disabled with the reason and "Export on host" is the offered action

### Requirement: Colour space of exported video
Exported video SHALL be SDR Rec.709: the Video section shows a read-only row "Colour: SDR Rec.709" and the file is tagged as defined by `render-engine.Colour management`. When the timeline contains HDR sources the row shows "HDR sources are converted to SDR" with the count of affected clips. No HDR output option is offered: HDR output is a Non-goal of the proposal. [NEW] [CAPCUT CC-252 — declined, see proposal Non-goals]

#### Scenario: HDR source in the timeline
- **WHEN** the timeline contains two HLG clips and the export dialog is opened
- **THEN** the colour row reads "SDR Rec.709 — 2 HDR sources are converted to SDR"

#### Scenario: No HDR control
- **WHEN** every section of the export dialog is expanded on a device with an HDR display
- **THEN** no control selects HDR, wide gamut or 10-bit output

### Requirement: Estimated file size and duration
The dialog SHALL show the output duration (timeline or range) and an estimated file size equal to `(videoBitrate + audioBitrate) × duration / 8`, formatted in MB below 1 000 MB and in GB with two decimals above, prefixed with "≈", updated within 100 ms of any setting change. For GIF the estimate is `width × height × frameCount × 0.35` bytes; for WAV it is exact (`sampleRate × channels × bytesPerSample × duration + 44`); for image sequences it is shown as frame count only. When the estimate exceeds the free space of the destination the value is shown in the danger colour with the message "Not enough free space" and Export is disabled for on-device targets. [NEW] [CAPCUT CC-253]

#### Scenario: Estimate for a one-minute 1080p30 export
- **WHEN** video bitrate is 10.0 Mbps, audio 192 kbps and duration 60 s
- **THEN** the estimate shows "≈ 76.4 MB"

#### Scenario: Insufficient space
- **WHEN** the estimate is 3.2 GB and the destination has 1.0 GB free
- **THEN** the estimate is shown in the danger colour, "Not enough free space" is displayed, and the Export button is disabled

### Requirement: GIF export
The editor SHALL export animated GIF with: size by short side 240, 320, 480 or 640 px (default 480, long side from the project aspect ratio), frame rate 10, 12, 15, 20 or 25 fps (default 15), loop "Forever" (default), "Once" or a count from 2 to 100, palette "Per frame" (default) or "Global" with 256 colours, and dithering "Floyd–Steinberg" (default) or "None". GIF export has no audio and a maximum duration of 60 s; a longer timeline or range MUST be refused with "GIF export is limited to 60 seconds. Set an in/out range." GIF encoding runs on-device on every platform, including in degraded-encoder situations where no video encoder exists, and writes frames to the output stream incrementally. [PORT N-008] [CAPCUT CC-255]

#### Scenario: Default GIF
- **WHEN** a 4 s 16:9 range is exported as GIF with defaults
- **THEN** the file is a GIF89a of 854×480 with 60 frames, frame delays in GIF's 10 ms units repeating 70, 70, 60 ms (mean 66.7 ms) and infinite looping

#### Scenario: Too long for GIF
- **WHEN** GIF is selected for a 95 s timeline with no in/out range
- **THEN** Export is disabled with the 60-second limit message

### Requirement: Audio-only export
The editor SHALL export the timeline or range audio alone as MP3 (128, 192, 256 or 320 kbps; default 192), WAV (PCM 16-bit or 24-bit, default 16-bit), AAC in an `.m4a` container (96–320 kbps, default 192) or FLAC (compression level 5), at 44 100 or 48 000 Hz, stereo or mono, using the mixdown of `render-engine.Audio mixdown for export` and the limiter of `audio-editing.Mastering limiter`, exactly as video export does. WAV is always encoded on-device. AAC and FLAC use the platform `AudioEncoder` where supported; MP3 uses the separately loaded encoder module described in `export-share.Encoder availability and licensing`. A format with no on-device encoder MUST be shown with "Export on host" when a capable host is connected and otherwise disabled with the reason. A timeline with no audible source MUST be refused with "Nothing to export: the timeline has no audio." [PORT N-008] [CAPCUT CC-254]

#### Scenario: WAV export
- **WHEN** a 30 s range is exported as WAV 16-bit 48 kHz stereo
- **THEN** the file is exactly 5 760 044 bytes and its samples equal the export mixdown

#### Scenario: Silent timeline
- **WHEN** audio-only export is requested for a timeline whose tracks are all muted
- **THEN** the export is refused with the no-audio message

#### Scenario: FLAC unsupported on device
- **WHEN** the device has no FLAC encoder and no host is connected
- **THEN** the FLAC option is disabled with "Not supported on this device"

### Requirement: Image sequence export
The editor SHALL export the timeline or range as an image sequence in PNG (8-bit RGBA, alpha preserved under the conditions of `export-share.Alpha and intermediate codec export`) or JPEG (quality 1–100, default 90) at any supported resolution and frame rate. Files are named `<name>_<NNNNNN>.<ext>` with a six-digit, zero-padded, 1-based index. On desktop frames are written into a user-chosen folder; on web they are written into a folder chosen through the directory picker where available and otherwise streamed into a single ZIP (store method, no compression); on mobile they are streamed into a ZIP saved through the system file dialog. Sequences longer than 18 000 frames MUST require an explicit confirmation showing the frame count. [NEW] [PORT N-008]

#### Scenario: PNG sequence on desktop
- **WHEN** a 2 s range of a 30 fps project named "Promo" is exported as PNG sequence to a folder
- **THEN** the folder contains `Promo_000001.png` to `Promo_000060.png`

#### Scenario: Web without directory access
- **WHEN** the browser has no directory picker
- **THEN** the sequence is delivered as `Promo_frames.zip` written as a stream

### Requirement: Still frame export
The editor SHALL export the frame at the playhead as PNG or JPEG (quality 1–100, default 90) at the project canvas size or any video resolution option, using original media. The default file name is `<project>-<HH-MM-SS-FF>.<ext>`, where `<project>` is the project name passed through `export-share.Filename sanitisation` (which keeps letters of every script, so Vietnamese and Japanese names are preserved) and `HH-MM-SS-FF` is the playhead timecode with the frame number as the last field; this is the one naming rule for stills and it is also the name used by `preview-canvas.Save snapshot`, which is the same operation with the fixed settings PNG, project canvas size. The action is available from the export dialog (export type "Still frame") and from the snapshot action of `preview-canvas.Save snapshot`; on mobile the result can be saved to the photo library. A playhead at or beyond the timeline end exports the last frame. [NEW] [CAPCUT CC-257]

#### Scenario: Still at playhead
- **WHEN** the playhead is at 00:00:12:05 in project "Promo" and Still frame PNG is exported
- **THEN** the file `Promo-00-00-12-05.png` has the project canvas dimensions and equals the rendered frame at that time

#### Scenario: Vietnamese project name
- **WHEN** the project is named "Chuyến đi Đà Lạt" and a still is exported at 00:01:05:11
- **THEN** the default file name is `Chuyến đi Đà Lạt-00-01-05-11.png`

#### Scenario: Japanese project name
- **WHEN** the project is named "京都の旅" and a JPEG still is exported at 00:00:03:00
- **THEN** the default file name is `京都の旅-00-00-03-00.jpg`

#### Scenario: Playhead past the end
- **WHEN** the playhead sits at the timeline duration
- **THEN** the exported still is the last frame of the timeline

### Requirement: Range export
Every export type except Still frame SHALL offer the scope "Entire timeline" or "In/out range", the latter enabled when the timeline has an in/out range as defined by `timeline-editing.In/out range`. The range is snapped to frame boundaries of the output frame rate, MUST be at least one frame long, and is shown as start, end and duration timecodes that are editable in the dialog (edits update the timeline range as an undoable change). Video, audio, captions sidecar timing and cover selection all honour the range; sidecar caption times are offset so the range start is 0. [PORT N-008] [CAPCUT CC-256]

#### Scenario: Export a range
- **WHEN** the in/out range is 00:00:05:00–00:00:15:00 on a 30 fps project and scope "In/out range" is chosen
- **THEN** the exported video has 300 frames starting with the frame at 5 s
- **AND** exported audio starts at the timeline's 5 s position

#### Scenario: No range defined
- **WHEN** the timeline has no in/out range
- **THEN** "In/out range" is disabled with the hint "Set in and out points on the timeline"

### Requirement: Alpha and intermediate codec export
The editor SHALL export video with an alpha channel when the project default background is `transparent` (`projects.Transparent background`), no main-track clip overrides it with an opaque background, and the user selects "Include transparency": as a PNG image sequence on any device, and as ProRes 4444 in MOV through host export. ProRes 422 HQ in MOV (no alpha, PCM 24-bit 48 kHz audio) is offered through host export. These options are listed under Codec with the label "Host" and are disabled with "Requires a connected host" when none advertising `remote-export` is connected. Selecting transparency while the resolved background is opaque anywhere in the export range MUST show "The background is opaque; set the project background to None and remove per-clip backgrounds to export alpha." with the action "Open background settings". An export without an alpha channel of a transparent-background project flattens uncovered pixels onto black, and the dialog states "Transparent areas will be black in this format". [NEW] [CAPCUT CC-262]

#### Scenario: ProRes 4444 with alpha on the host
- **WHEN** a transparent-background project is exported as ProRes 4444 on a connected host
- **THEN** the resulting MOV has a `yuva444p10le`-class pixel format and pixels not covered by any element have alpha 0

#### Scenario: Opaque background blocks alpha
- **WHEN** "Include transparency" is selected for a project whose default background is a colour
- **THEN** the opaque-background message is shown with "Open background settings" and the Export button is disabled

#### Scenario: Flattening notice
- **WHEN** a transparent-background project is exported as H.264 MP4
- **THEN** the dialog shows "Transparent areas will be black in this format" and uncovered pixels in the file are black

#### Scenario: No host
- **WHEN** no host is connected
- **THEN** ProRes options are disabled with "Requires a connected host" and PNG sequence with transparency remains available

### Requirement: Pre-flight validation
Before an export starts the editor SHALL run a pre-flight check and block the export with an itemised list when any item of this table holds. The table is the single list of pre-flight items; every item has one code of `export-share.Export error codes`, used both in the dialog and as the failure code of a host-initiated job (`export-share.Host-initiated export`), and at most one waiver.

| Item | Code | "Export anyway" / waiver parameter | Other remedies |
|---|---|---|---|
| the timeline or range has no element ("Project is empty") | `export/empty` | none | — |
| the range is shorter than one frame | `export/range-too-short` | none | — |
| a used media file is missing or undecodable | `media/unavailable` | yes — `allowMissingMedia` (the clip renders transparent and silent) | "Locate media" |
| only a proxy is present for a used asset on an on-device export | `media/original-unavailable` | none | "Download originals" (`cross-device-sync.Originals for local export`), "Export on host" |
| a used font cannot be loaded | `export/font-unavailable` | yes — `allowFontFallback` (the fallback family is used) | "Replace font" |
| a text element uses a device font (flagged non-portable by `text-and-titles.System and local device fonts`) and the target is a host | `export/device-font` | yes — `allowFontFallback` (the fallback family is used on the host) | "Replace font", export on this device |
| a required cutout matte or analysis track is still processing | `export/matte-unavailable` | none | "Wait for processing"; for a person matte that only a body effect needs, "Export without body effects on this clip" (`visual-effects-filters.Body effects use the on-device person matte`) |
| a derived asset a clip needs (stem, stabilisation, frame-interpolation or retime result) failed or cannot be delivered to the engine | `export/derived-unavailable` | none | "Run again" on the clip, "Export on host" |
| `slate` stills of a draft timeline remain in the range ("{n} placeholder shots are still in the timeline") | `export/slates-present` | yes — `allowSlates` (slates are exported as they look) | replace the clips |
| a sticker whose pack item is not installed (`stickers-shapes.Missing sticker state`), or a font, sticker, LUT, effect, transition or animation referenced by a template or pack that fails to resolve (`templates.Missing resources in a template`) | `export/resource-missing` | yes — `allowMissingResources` (each resource falls back as its owner defines) | install the pack |
| a required slot of a project in template mode is empty (`templates.Use a template`) | `export/template-incomplete` | none | fill the slot |
| free space on the destination volume is below the estimated size — below 2 × the estimated size on iOS and Android, where the output exists twice during the copy-out (`mobile-editor.Engine binary return path`); on a host, below the estimated size within the export quota | `export/insufficient-space` | none | "Choose another location", "Export on host" |
| the destination is not writable | `export/write-failed` | none | "Choose another location" |
| the device has no GPU backend | `export/no-gpu` | none | "Export on host" |
| the requested codec has no encoder on the selected target | `export/codec-unavailable` | none | the alternatives listed by `export-share.Encoder availability and licensing` |

An empty OPTIONAL slot of a template project, or of a compound inserted from a template, is NOT a pre-flight item: it renders as `templates.Slot semantics and locked structure` defines, identically in preview and export. Each listed item names the affected clips. "Replace font" (for a font that cannot be loaded and for a device font) opens the font picker of `text-and-titles.Font picker` and applies the chosen bundled or imported family to every listed element in one undo step, after which pre-flight runs again. The slate item names the clips so that a draft timeline produced by `script-studio.Draft timeline from a script` is not exported by mistake. Pre-flight MUST complete within 2 000 ms for a project with 500 elements on the reference desktop of `diagnostics-quality.Performance budgets`. Everything accepted through "Export anyway" or a waiver parameter is recorded in `export-share.Export summary`. [PORT EX-012] [NEW]

#### Scenario: Empty project
- **WHEN** Export is pressed with no element on any track
- **THEN** the export does not start and the message "Project is empty" is shown

#### Scenario: Proxy-only media on a phone
- **WHEN** an on-device export is started on a phone that holds only proxies for 3 clips
- **THEN** pre-flight lists the 3 clips with the actions "Download originals" and "Export on host"

#### Scenario: Export anyway
- **WHEN** one clip's media is missing and the user chooses "Export anyway"
- **THEN** the export runs and that clip contributes no pixels and no audio

#### Scenario: Device font on a host export
- **WHEN** a host export is started for a project with one text element in a device font
- **THEN** pre-flight lists the element with "Export anyway", and choosing it renders that text in the fallback family on the host

#### Scenario: Replace font
- **WHEN** pre-flight lists 4 text elements using a font that cannot be loaded and the user chooses "Replace font" and picks a bundled family
- **THEN** the 4 elements use the chosen family after one undo step, pre-flight runs again and no longer lists them

#### Scenario: Slate stills remain
- **WHEN** an export range contains 3 clips whose media kind is `slate`
- **THEN** pre-flight lists "3 placeholder shots are still in the timeline" with the clip names and the action "Export anyway"

#### Scenario: Empty optional slot is not listed
- **WHEN** a template project has every required slot filled and one optional slot empty
- **THEN** pre-flight lists nothing for the slot and the export starts

#### Scenario: Empty required slot blocks
- **WHEN** a template project with one empty required slot is exported through an agent tool
- **THEN** the job fails with `export/template-incomplete` naming the slot, and no waiver parameter changes that

#### Scenario: Free space on a phone
- **WHEN** an on-device export with an estimated size of 800 MB is started on a phone with 1.2 GB free
- **THEN** pre-flight blocks with `export/insufficient-space` stating that 1.6 GB is needed

#### Scenario: No GPU on this device
- **WHEN** the engine reports `backend: "none"` and Export is pressed with target "This device"
- **THEN** pre-flight blocks with code `export/no-gpu` and offers "Export on host"

#### Scenario: Pre-flight time
- **WHEN** pre-flight runs on a 500-element project on the reference desktop
- **THEN** the result list is shown within 2 000 ms

### Requirement: Streaming write to disk
On-device exports SHALL be written to storage incrementally as encoded data is produced and MUST NOT hold the whole output in memory: peak memory attributable to the export output buffer MUST stay below 64 MiB regardless of output size, on every platform. Desktop writes through the Electron main process to the chosen path using positioned writes. Web writes through a File System Access writable stream when available and otherwise into an origin-private file that is offered for download on completion. iOS and Android (decision B5; engine side `render-engine.Mobile export path`) write the output with positioned writes into a file in the engine's own origin-private storage inside the engine WebView — the only place on mobile where the `moov` box can be finalised — and, after finalisation, stream the finished file out through one sink of `render-engine.Mobile binary return path` (chunks of at most 4 MiB, acknowledged, verified by SHA-256) into the app's export directory, as `mobile-editor.Engine binary return path` defines; this is the normal mobile path on both systems, the sink never carries an unfinalised container, and the 64 MiB bound covers the copy-out as well. The private copy is deleted when the destination file has been verified and when the job is cancelled; after a failed copy-out the finalised private copy is kept for 24 h so that "Save again" repeats only the copy; an unfinalised private file whose job no longer exists is deleted at the next app start. A partially written file carries the suffix `.part` (or lives in private storage) until finalisation and is renamed atomically on success. A write error (disk full, permission revoked, destination removed, sink verification mismatch) MUST fail the export with code `export/write-failed` and delete the partial destination file; while the finalised private copy exists on mobile, "Save again" repeats only the copy-out. [NEW] [PORT N-008]

#### Scenario: Long export stays within memory
- **WHEN** a 30-minute 1080p export producing a 2.2 GB file runs on the reference desktop
- **THEN** export output buffering never exceeds 64 MiB
- **AND** the finished file plays from start to end

#### Scenario: Disk fills during export
- **WHEN** the destination runs out of space mid-export
- **THEN** the job fails with code `export/write-failed`, the `.part` file is deleted, and the failure view offers "Choose another location"

#### Scenario: Browser without File System Access
- **WHEN** an export completes in a browser lacking `showSaveFilePicker`
- **THEN** the file is downloaded from origin-private storage under the sanitised file name and the private copy is deleted after the download is handed to the browser

#### Scenario: Mobile output is finalised, then copied out
- **WHEN** a 700 MB MP4 export completes on an iPhone and on an Android phone
- **THEN** on each the file in the export directory has the byte count and SHA-256 reported when the sink closed, contains a single `moov` box, and the copy in the engine's private storage no longer exists

#### Scenario: Orphaned private copy
- **WHEN** the app is terminated during an export and started again
- **THEN** the unfinalised private file of that export is deleted at start-up and the storage usage display no longer counts it

### Requirement: Output destination and file name
The Destination section SHALL contain a file name field (default: the project name) and, on desktop, a save location (default: the last used folder, initially the OS Videos folder under `JAgentChill`), with a "Browse" button. On web the save location is chosen through the browser's save dialog at export start where supported. On mobile the output is written to the app's export directory and offered to share targets on completion. The extension is appended automatically and is not editable. When a file with the same name exists at the destination, the name MUST be made unique by appending ` (2)`, ` (3)`, … unless the user confirmed overwrite in the system dialog. [PORT EX-011] [CAPCUT CC-244]

#### Scenario: Default name
- **WHEN** project "Summer trip" is exported as MP4 with no name edit
- **THEN** the output file is `Summer trip.mp4`

#### Scenario: Name collision on desktop
- **WHEN** `Summer trip.mp4` already exists in the save location
- **THEN** the new file is written as `Summer trip (2).mp4`

### Requirement: Filename sanitisation
Output file names SHALL be sanitised before use on every platform by one function that removes only what a file system forbids and keeps every letter, digit and mark of every script — Vietnamese, Japanese and every other language are preserved as typed: the name is normalised to Unicode NFC; characters `\ / : * ? " < > |` and control characters U+0000–U+001F and U+007F are replaced by `_`; leading and trailing spaces and dots are removed; runs of whitespace collapse to one space; the base name is truncated to 120 Unicode code points and to at most 200 UTF-8 bytes without splitting a code point or separating a combining mark from its base; the device names reserved by Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, case-insensitive) are prefixed with `_` on every platform — macOS, Windows, Linux, iOS, Android and web alike — so that a file exported on one system can be copied to any other; an empty result becomes `Untitled`. No character is replaced merely because it is outside ASCII. The same function is applied to video, audio, GIF, still, snapshot (`preview-canvas.Save snapshot`), sequence, sidecar and cover file names, and no other capability defines a file-name character rule for exported files. [NEW] [PORT EX-011]

#### Scenario: Illegal characters
- **WHEN** the project name is `Q3: Plan/Review?`
- **THEN** the output base name is `Q3_ Plan_Review_`

#### Scenario: Reserved name
- **WHEN** the file name is `con`
- **THEN** the output base name is `_con`

#### Scenario: Empty after sanitising
- **WHEN** the file name is `...`
- **THEN** the output base name is `Untitled`

#### Scenario: Vietnamese name is kept
- **WHEN** the project name is "Chuyến đi Đà Lạt"
- **THEN** the output base name is `Chuyến đi Đà Lạt` in NFC form, byte for byte the same on macOS, Windows, Linux, iOS, Android and web

#### Scenario: Japanese name is kept
- **WHEN** the project name is "京都の旅 #2"
- **THEN** the output base name is `京都の旅 #2`

#### Scenario: Truncation does not split a character
- **WHEN** the name is 100 repetitions of "旅" (300 UTF-8 bytes)
- **THEN** the base name is 66 repetitions of "旅" (198 bytes)

### Requirement: Progress and estimated time remaining
A running export SHALL report its stage (`Preparing`, `Preparing audio`, `Smoothing motion` — the wait for unfinished frame-interpolation results of clips with "Smooth motion", skipped when none is pending — `Mixing audio`, `Rendering`, `Finalising`, on iOS and Android additionally `Saving` — the copy-out of `render-engine.Mobile export path`, shown with bytes done of total and mapped to the last 2 % — and for host jobs additionally `Uploading media`, `Queued` and `Downloading`), a percentage, frames done of total, elapsed time and estimated time remaining. `Preparing audio` is the wait for unfinished derived audio of `audio-editing.Derived audio processing and caching` (shown with "<done> of <total> clips"; skipped when nothing is pending; cancelling the export during it does not cancel the derived-audio jobs). Percentage maps Preparing, Preparing audio and Mixing audio to 0–5 %, Rendering to 5–98 % proportional to frames encoded, and Finalising to 98–100 %; it MUST never decrease. The estimate is computed from the mean frame rate of the last 5 s of rendering, is first shown after 3 s of rendering, and updates at least once per second. For host jobs the values come from `jagentchill.job.updated` events as defined by `export-share.Gateway export progress and control`. Progress is shown in the export dialog, as a compact indicator in the editor top bar, on the Queue tab of `export-share.Exports screen`, on the desktop app icon (Dock progress on macOS, taskbar progress on Windows, launcher progress on Linux desktops that implement the launcher progress interface, and no icon progress elsewhere), and as a full-screen progress view on mobile. [PORT EX-007] [NEW]

#### Scenario: Progress is monotonic
- **WHEN** an export runs to completion
- **THEN** each reported percentage is greater than or equal to the previous one and the last value is 100

#### Scenario: Waiting for derived audio
- **WHEN** an export starts while noise reduction is still being prepared for 2 of 5 processed clips
- **THEN** the stage reads "Preparing audio" with "3 of 5 clips" and the stage changes to "Mixing audio" when the last clip is ready

#### Scenario: Remaining time appears
- **WHEN** rendering has run for 3 s at a steady 60 frames per second with 3 000 frames left
- **THEN** the estimate shows about 50 s remaining (±10 %)

### Requirement: Cancel export
A running or queued export SHALL be cancellable from the dialog, the Queue tab and the top-bar indicator. Cancelling a running on-device export MUST stop rendering within 500 ms, close encoders, delete the partial output and set the job state to `cancelled`; cancelling requires confirmation ("Cancel export? The partial file is deleted.") when progress is above 10 %. Cancelling a host job calls `jagentchill.export.cancel` and the job reaches `cancelled` within 5 s. A cancelled job is kept in history with "Export again". [PORT EX-008]

#### Scenario: Cancel mid-render
- **WHEN** the user confirms cancel at 40 % of an on-device export
- **THEN** rendering stops within 500 ms, no output or `.part` file remains at the destination, and the job shows `cancelled`

#### Scenario: Cancel a queued job
- **WHEN** a queued job is cancelled
- **THEN** it is removed from the queue without confirmation and recorded in history as `cancelled`

#### Scenario: Cancel a host job
- **WHEN** the user cancels a running host export
- **THEN** `jagentchill.export.cancel` is sent and a `jagentchill.job.updated` event with state `cancelled` arrives within 5 s

### Requirement: Pause and resume export
Pause and resume exist only for on-device exports; `paused` is a state of the device's own queue and is never a state of a host job (host exports are cancel-only, matching the job states of `server-api.Background job queue`). A running on-device export SHALL be pausable by the user: pause takes effect after the frame in flight, flushes the written bytes, keeps encoders, decoders, the partial file and the render session open, stops the elapsed timer, and shows state `paused`; resume continues from the next frame. A user pause has no time limit. A paused-and-resumed export MUST have the same frame count and duration as an uninterrupted one, and with a software encoder its decoded frames and audio samples MUST be bit-identical to an uninterrupted export.

This requirement is the single foreground/background rule for on-device exports on iOS and Android (decisions B5 and E13); `mobile-editor.Export sheet`, `mobile-editor.Engine surface lifecycle` and `render-engine.Mobile engine restart budget` reference it and state no rule of their own. The rule is written once for both systems; how long an export runs in the background is whatever each operating system grants, and the product adds no cap of its own (decision E13):
1. **Foreground.** The export runs only while it is `running`; the screen is kept awake.
2. **Leaving the foreground** (app switch, home, screen lock, incoming call screen). The app requests the operating system's background-execution grant through `beginBackgroundWork` of `mobile-editor.Engine view native module` (a background task on iOS; a media-processing foreground service with the ongoing notification "Exporting… <percent>" and a "Pause" action on Android). While the grant is held the export keeps running: on Android the foreground service is held until the export reaches a terminal state or is paused, so an export normally runs to completion in the background and finishes with the system notification "Export finished"; on iOS it runs for the background-task window the system grants. The app pauses the export automatically — exactly as a user pause — only when the grant ends: on the expiry notice (`onBackgroundExpiring`), or when the grant is refused (for example a foreground-service start the system does not allow, or the notification permission being denied on Android). No timer of the product ends the grant early. The partial file is kept in the engine's private storage.
3. **While an export is `running` or `paused`** — in the foreground or the background, for any length of time — the engine surface is NOT disposed, `memory.trim` is not sent, the 30 s background release of `mobile-editor.Engine surface lifecycle` does not run, and the idle timeout of sink streams does not run.
4. **Return to the foreground.** An export that was paused by rule 2 resumes automatically, without user action; one that the user had paused stays paused. Before resuming, the engine verifies the video encoder session, the audio encoder, every open decoder and the GPU device. The recovery itself is owned by `render-engine.Mobile export path`: lost decoders and a lost GPU device are re-created; a lost video encoder is re-created with the identical configuration and resumes with a key frame; when the new encoder's configuration differs from what is already written, the job fails with `export/interrupted`. Otherwise the export continues from the frame after the last one written.
5. **Termination.** When the operating system terminated the engine's content process or the app while the export was active, the job is `failed` with `export/interrupted` when the app is next in the foreground; the partial file is deleted.

`export/interrupted` offers "Retry", which starts again from frame 0: there is no resume from a partial file across an engine restart, because files are written non-fragmented. On desktop and web an on-device export is not paused by window or tab visibility (`export-share.Background export on desktop and web`). [NEW]

#### Scenario: Pause and resume on desktop
- **WHEN** an export using the software H.264 encoder of the desktop runtime is paused at frame 900 for 60 s and then resumed
- **THEN** rendering continues at frame 901
- **AND** every decoded frame and audio sample of the output equals that of an uninterrupted export of the same snapshot

#### Scenario: User pause of 60 s on a phone
- **WHEN** the user taps Pause on a phone at frame 450, keeps the app in the foreground for 60 s and taps Resume
- **THEN** the engine was not disposed, no stream was aborted, rendering continues at frame 451 and the file has the same frame count as an uninterrupted export

#### Scenario: Short trip to the background
- **WHEN** the user switches apps during an on-device export and returns after 10 s, on iOS and on Android
- **THEN** the export kept running while the grant was held, or was paused because the system ended or refused the grant, and in either case it is `running` again within 2 s of the return and completes

#### Scenario: Two minutes in the background, engine intact
- **WHEN** the app is in the background for 120 s during an on-device export and every encoder is valid or re-created with the identical configuration on return
- **THEN** on iOS the export was paused when the system's background-task window expired and resumes automatically on return, on Android it kept running under the foreground service for the whole 120 s, on both the engine surface still exists, and the finished file has the same frame count and duration as an uninterrupted export

#### Scenario: Android export completes in the background
- **WHEN** a 4-minute on-device export is started on the Android reference device and the app is sent to the background at 10 % and not opened again
- **THEN** the foreground-service notification shows the progress, the export completes without the app returning to the foreground, the notification changes to "Export finished", and the file is in the chosen destination

#### Scenario: Two minutes in the background, encoder lost
- **WHEN** the app is in the background for 120 s during an on-device export and the re-created hardware video encoder reports a configuration different from the one already written
- **THEN** the job is `failed` with `export/interrupted`, the partial file is deleted and "Retry" starts from frame 0

#### Scenario: Engine killed in the background
- **WHEN** the OS terminates the engine while the export is paused in the background
- **THEN** on return the job is `failed` with `export/interrupted`, the partial file is deleted and "Retry" starts from frame 0

#### Scenario: Same rule on both systems
- **WHEN** the background test (30 %, background for 120 s, return) runs on the iOS and on the Android reference device
- **THEN** each pauses only when its own system ends the grant (the iOS background-task expiry; on Android not at all within the 120 s), neither disposes the engine, no product timer paused either, and both end with a complete file or with the same failure for the same encoder outcome

#### Scenario: No pause for host jobs
- **WHEN** a host export is running
- **THEN** its row and dialog show Cancel and no Pause control

### Requirement: Background export on desktop and web
On desktop and web an on-device export SHALL run in an isolated render session (`render-engine.Export render session`) from an immutable snapshot of the project taken when the job is created, so the user can keep editing, switch project or return to the home screen while it runs; edits made after the snapshot MUST NOT affect the output. While an export is running, closing the desktop window or quitting the app, or closing or reloading the browser tab, MUST prompt "An export is in progress. Quit and cancel the export?" with the choices "Keep exporting" and "Quit and cancel". On desktop the export continues when the window is minimised or hidden; on web a hidden tab continues to export and a notice warns that the browser slows background tabs. [NEW]

#### Scenario: Edit while exporting
- **WHEN** an export is running and the user changes a text element's content
- **THEN** the editor responds normally and the exported file contains the text as it was when the export started

#### Scenario: Quit during export
- **WHEN** the user quits the desktop app while an export is at 50 %
- **THEN** the confirmation prompt appears and choosing "Keep exporting" leaves the app and the export running

### Requirement: Export queue
The app SHALL maintain an export queue per device, shown on the Queue tab of `export-share.Exports screen`, listing jobs with project name, summary of settings, target, state, progress and actions. On-device jobs have the states `queued`, `running`, `paused`, `succeeded`, `failed` and `cancelled`; host jobs appear in the same list with the host name and have exactly the host job states `queued`, `running`, `succeeded`, `failed` and `cancelled`. At most one on-device job runs at a time; further jobs wait in FIFO order, can be reordered by drag (desktop and web) or by "Move up"/"Move down" (every platform, keyboard-operable), and can be removed. The queue holds at most 20 non-finished on-device jobs; adding more is refused with "Export queue is full (20)" and code `export/queue-full`. Queued jobs keep their project snapshot and survive app restart; a job that was `running` or `paused` when the app exited is restored as `failed` with code `export/interrupted` and a "Retry" action. host jobs follow the host's concurrency and are not counted in the limit of 20. [NEW]

#### Scenario: Second export is queued
- **WHEN** an on-device export is running and the user starts another
- **THEN** the second job appears as `queued` and starts automatically when the first finishes

#### Scenario: Restart with queued jobs
- **WHEN** the app is restarted with one running and two queued on-device jobs
- **THEN** the formerly running job is `failed` with `export/interrupted` and the two queued jobs are still `queued` and start in order

#### Scenario: Queue is full
- **WHEN** 20 non-finished on-device jobs exist and the user starts a twenty-first
- **THEN** no job is added and "Export queue is full (20)" is shown

#### Scenario: Reorder
- **WHEN** the user chooses "Move up" on the third queued job
- **THEN** it becomes the second queued job and runs before the job it passed

### Requirement: Exports screen
The export queue, the export history and the list of share links SHALL be shown on one screen at the route `/exports` with the tabs Queue, History and Links (`/exports/queue`, `/exports/history`, `/exports/links`), whose frame and route are defined by `app-shell-navigation.Route map`. The screen is opened from the Exports button of the sidebar footer (`app-shell-navigation.Sidebar footer`), from the top-bar export indicator of the editor (which opens the Queue tab), and from export notifications. Queue and History work with no host; the Links tab shows the requires-host state with "Connect a host to share by link" when none is connected. A running-job badge on the Exports button shows the count of queued and running jobs on this device and on the active host. [NEW]

#### Scenario: Open from the top bar
- **WHEN** the user activates the export progress indicator in the editor top bar
- **THEN** `/exports/queue` opens with the running job's row focused

#### Scenario: Links without a host
- **WHEN** `/exports/links` is opened with no host connected
- **THEN** the tab shows "Connect a host to share by link" with a link to connection settings and no list

#### Scenario: Badge count
- **WHEN** one on-device job is running and two host jobs are queued
- **THEN** the Exports button shows the badge 3

### Requirement: On-device export on mobile
On phones and tablets an on-device export SHALL suspend the preview (the engine surface stays alive and is used by the export; it is never disposed while the export is `running` or `paused`), show the export progress view (cover thumbnail, percentage, estimated time remaining, the text "Keep the app open until the export finishes", Pause / Resume and Cancel), keep the screen awake for the duration, and restore the editor at the same playhead on completion or cancel. The export options reflect the device constraints of `render-engine.Capability constraints from the WebView spike`: an option the device cannot encode is disabled with the reason and "Export on host" is offered when a host advertising `remote-export` is connected; when `constraints.onDeviceVideoExport` is `false`, the target "This device" is disabled for video and "Host: <name>" is preselected. The output is written inside the engine's private storage and copied out after finalisation (`export-share.Streaming write to disk`), which needs free space of twice the estimated size (`export-share.Pre-flight validation`); the copy-out is shown as the stage `Saving`. Foreground and background behaviour is exactly that of `export-share.Pause and resume export`, identical on iOS and Android. On completion the view shows "Saved" with the actions of `export-share.Mobile share targets` and "Done". The layout of the sheet and progress view is defined by `mobile-editor.Export sheet`. [NEW] [CAPCUT CC-245]

#### Scenario: Export on a phone
- **WHEN** the user taps Export with 1080p selected on a phone
- **THEN** the progress view appears, the screen does not auto-lock, and on completion the share targets and "Done" are shown

#### Scenario: Cancel on a phone
- **WHEN** the user cancels at 30 %
- **THEN** the editor returns with the playhead where it was, no file is left in the export directory and none in the engine's private storage

#### Scenario: Device cannot encode video
- **WHEN** the capability report has `constraints.onDeviceVideoExport: false` and a host advertising `remote-export` is connected
- **THEN** "This device" is disabled for video with the reason "This device cannot encode video" and "Host: <name>" is selected

#### Scenario: Saving stage
- **WHEN** a 500 MB on-device export finishes encoding on a phone
- **THEN** the progress view shows the stage `Saving` while the file is copied out and "Saved" only after the destination file has been verified

### Requirement: Remote export contract
This capability is the single owner of export on the host; `cross-device-sync.Remote export hand-off` states only its pre-conditions and no other capability defines an export RPC, event, route or retention value. The contract on channel P SHALL be exactly: `jagentchill.export.capabilities {}` → `{encoders: {h264, hevc, vp9, av1, aac, opus}, containers[], proRes: boolean}` where `encoders` is the codec table of `server-api.Host encoder policy and codec table` unchanged (each `{state: "available" | "download_required" | "unavailable", encoder?, hardware, reason?}`); `jagentchill.export.create {projectId, revision, sceneId?, range?, settings, codecPreference?, sequence?, provenance?, aiLabel?, allowMissingMedia?, allowFontFallback?, allowSlates?, allowMissingResources?, idempotencyKey}` → `{jobId}` (`codecPreference` and the four waivers as defined by `export-share.Encoder availability and licensing` and `export-share.Host-initiated export`); `jagentchill.export.get {jobId}` → the job record; `jagentchill.export.list {projectId?, state?, cursor?, limit}` (limit 1–100, default 50); `jagentchill.export.cancel {jobId}`; `jagentchill.export.delete {jobId}` (terminal jobs only; removes the record and the output). `create`, `cancel` and `delete` require scope `jagentchill.export.run`; `capabilities`, `get`, `list` and the download route require `jagentchill.projects.read`. The job record is `{jobId, kind: "export.remote" | "export.sequence", state, stage, framesDone, frameCount, encodedBytes, createdBy: {kind: "device" | "agent" | "workflow" | "film" | "automation", id}, created_ms, started_ms?, finished_ms?, output?: {fileName, mime, size, sha256, expires_ms?}, codecUsed?: {video, audio, container}, summary?, error?: {code, message}}`. Jobs run in the single queue of `server-api.Background job queue` with the states `queued → running → succeeded | failed | cancelled` and no other state. Progress and state changes are delivered only by the `jagentchill.job.updated` event; there is no export-specific event. The output is fetched only through `GET /jagentchill/v1/exports/{jobId}/file`. Output retention is `storage.exportRetentionDays` (default 30; 1–90, or `forever`) and `storage.exportQuotaBytes` (default 21 474 836 480 bytes = 20 GiB), both registered in `server-api.Server configuration`. The same retention and quota apply to every other file the host produces for download under an export-class job — the outputs of `export.sequence` jobs and the ZIP archives of `film-production` (built by a `film.step` job) — and such files are listed on the History tab of `export-share.Exports screen` with their kind. Rendering is done by the render host of `render-engine.Render host`; `create` fails with `RENDERER_UNAVAILABLE` when it is unhealthy, `FFMPEG_UNAVAILABLE` when no FFmpeg is usable and `export/codec-unavailable` when the requested codec is not `available`; the host advertises feature flag `remote-export` whenever the render host is healthy and FFmpeg is present, whatever the state of any single codec. All of these methods travel on channel P, the single client channel (`server-api.Single client channel`); the server checks the device role and scope and a device holds no other credential. The whole remote export path — queue, render host, FFmpeg, download and share links — belongs to JAgentChill Server and involves no call to the OpenClaw Gateway that the server supervises: it keeps working, and `remote-export` stays advertised, while that Gateway is restarting or down (`server-api.Gateway supervision and lifecycle`). Jobs created by a device are cancelled with reason `device_revoked` when that device is revoked (decision D2). [NEW]

#### Scenario: One create method
- **WHEN** a client starts a host export
- **THEN** the request method is `jagentchill.export.create` with an `idempotencyKey`, and the response carries a `jobId` whose record has `kind: "export.remote"` and `state: "queued"`

#### Scenario: Idempotent create
- **WHEN** the same `jagentchill.export.create` request is sent twice with the same `idempotencyKey` within 24 hours
- **THEN** both responses carry the same `jobId` and exactly one job exists

#### Scenario: Viewer cannot create
- **WHEN** a device with role `viewer` calls `jagentchill.export.create`
- **THEN** the response is an error with code `SCOPE_DENIED`

#### Scenario: Host export while the OpenClaw Gateway is down
- **WHEN** the supervised OpenClaw Gateway is in a crash loop and a paired device calls `jagentchill.export.create`
- **THEN** the job is created, rendered and encoded, and its file can be downloaded

#### Scenario: Render host unhealthy
- **WHEN** `jagentchill.export.create` is called while the render host probe is failing
- **THEN** the response is an error with code `RENDERER_UNAVAILABLE` and no job is created

#### Scenario: Delete a running job
- **WHEN** `jagentchill.export.delete` is called for a job in state `running`
- **THEN** the response is an error with code `CONFLICT` and the job keeps running

### Requirement: Gateway export hand-off
When the user selects the target "Host: <name>" (available only while a paired host advertising the `remote-export` feature is connected), the client SHALL: (1) satisfy the pre-conditions of `cross-device-sync.Remote export hand-off` (operations pushed, the exported revision equals the host head, every original media blob complete on the host), uploading missing blobs resumably in 4 MiB chunks while showing stage `Uploading media` with bytes sent of total; (2) call `jagentchill.export.create` of `export-share.Remote export contract` with the project id, revision, scene id, range and the full export settings, receiving a job id. Any export setting whose codec the host reports as `available` in `jagentchill.export.capabilities` is accepted, including codecs the device cannot encode; a codec that is `download_required` or `unavailable` is disabled in the dialog with the strings of `export-share.Encoder availability and licensing`. When no host is connected the target selector shows "Host (not connected)" disabled with a link to connection settings; when the connected host does not advertise `remote-export` it shows "Host: <name> (cannot export)" disabled with the missing component named. [NEW]

#### Scenario: Hand-off with missing media
- **WHEN** a host export is started and the host lacks 2 of 9 media blobs
- **THEN** only those 2 blobs are uploaded, progress shows `Uploading media`, and the job is created after upload completes

#### Scenario: Host not connected
- **WHEN** the export dialog is opened with no host connection
- **THEN** the host target is disabled and labelled "Host (not connected)"

#### Scenario: Upload interrupted
- **WHEN** the connection drops at 60 % of the media upload and returns 30 s after
- **THEN** the upload resumes from the last acknowledged chunk and the job is created without re-sending completed chunks

#### Scenario: Host lacks an encoder
- **WHEN** the connected host's capabilities report no HEVC encoder
- **THEN** HEVC is disabled for the host target with "This host has no HEVC encoder"

### Requirement: Gateway render parity
A host export SHALL produce frames with the same engine as an on-device export: the job renders in the render host of `render-engine.Render host` (the product's Electron binary started with `--render-host` by the server; never a window of the desktop app and never a paired client), with `exact` decoding from original or mezzanine media, and the server pipes the raw frames and the mixed audio to an FFmpeg process (`server-api.FFmpeg worker`) that encodes and muxes to the requested codec and container. Acceptance has two fixed thresholds: pre-encode frames of the render host and of an on-device export of the same snapshot meet the cross-device rule of `render-engine.Golden-frame determinism` (golden tolerance for frames without text; SSIM of at least 0.98 for frames that contain text); and frames decoded from an H.264 encode of at least 40 Mbit/s from each side have SSIM of at least 0.98. [NEW]

#### Scenario: Pre-encode parity
- **WHEN** frame 150 of the same snapshot, containing no text, is captured before encoding on a desktop device and on the host render host
- **THEN** at least 99.5 % of pixels differ by 2 or less per channel, no pixel differs by more than 16 and SSIM is at least 0.99

#### Scenario: Decoded parity
- **WHEN** the same snapshot is exported at 1080p as H.264 at 40 Mbit/s on a desktop device and on the host and frame 150 is decoded from both files
- **THEN** the two frames have SSIM of at least 0.98

#### Scenario: FFmpeg missing on the host
- **WHEN** the host has no usable FFmpeg binary
- **THEN** the host does not advertise `remote-export`
- **AND** the target selector names "FFmpeg" as the missing component

### Requirement: Gateway export progress and control
While an `export.remote` or `export.sequence` job runs, the host SHALL publish `jagentchill.job.updated` events for it to subscribed devices holding `jagentchill.projects.read` on the project, at most 4 per second per job and at least once per second, each carrying job id, kind, state, stage, frames done, frame count and encoded bytes; the terminal event is never dropped and carries `output` or `error`. Events are not replayed: after a reconnect or a sequence gap the client MUST reconcile its queue with `jagentchill.export.list` and `jagentchill.export.get`. Control is cancel and delete only. A job continues when the originating device disconnects. Jobs survive a host restart: an interrupted job is re-queued and restarts from frame 0, each restart counting against `maxAttempts` 3, after which it is `failed` with code `export/host-restarted`. Completion and failure raise the notification defined by `notifications.Export completion signal`. [NEW]

#### Scenario: Device disconnects during a host export
- **WHEN** the phone that started a host export loses its connection for 10 minutes
- **THEN** the job keeps running on the host
- **AND** on reconnect the phone's queue shows the job's current state within 2 s, obtained from `jagentchill.export.list`

#### Scenario: Server restart
- **WHEN** the host restarts while a job is at 70 %
- **THEN** the job is re-queued, restarts from frame 0 and its state returns to `running`

#### Scenario: Restart limit
- **WHEN** the host restarts during the third attempt of the same job
- **THEN** the job becomes `failed` with code `export/host-restarted` and is not queued again

#### Scenario: Event rate
- **WHEN** a host export renders for 10 s
- **THEN** between 10 and 40 `jagentchill.job.updated` events are delivered for it

### Requirement: Gateway export download
A succeeded host export SHALL be downloadable by any paired device holding `jagentchill.projects.read` on the project through the signed route `GET /jagentchill/v1/exports/{jobId}/file` (per-request signature of `device-pairing-signing.Per-request HTTP signature`, bytes delivered as defined by `server-api.Authenticated media delivery`), which supports single-range requests; the client downloads to the chosen destination as a stream with resume after interruption and verifies the SHA-256 reported by the job before finalising the file. The device that created the job downloads automatically on completion when "Download when finished" is on (default on for desktop and web, off for mobile on a metered connection). Output files are retained for `storage.exportRetentionDays` after the job finished or until the job is deleted; when the retained outputs exceed `storage.exportQuotaBytes` the oldest finished outputs are evicted first. An expired or evicted output answers 410 and the job record shows `export/output-expired`. [NEW]

#### Scenario: Resume an interrupted download
- **WHEN** a 1.5 GB download is interrupted at 900 MB and the connection returns
- **THEN** the client continues with a Range request from byte 900 MB and the final file's SHA-256 matches the job's

#### Scenario: Expired output
- **WHEN** a device requests the file of a job finished 31 days ago under the default retention
- **THEN** the route responds 410 and the job shows "Output expired" with "Export again"

#### Scenario: Quota eviction
- **WHEN** retained outputs total 19 GiB and a new 2 GiB export finishes under the default quota
- **THEN** the oldest finished outputs are deleted until the total is at or below 20 GiB, and the new output is kept

#### Scenario: Retention set to forever
- **WHEN** `storage.exportRetentionDays` is `forever` and a job finished 400 days ago
- **THEN** its output is still downloadable while the quota is not exceeded

#### Scenario: Unsigned request
- **WHEN** the file route is requested without a valid device signature
- **THEN** the response is 401 and no bytes of the file are sent

### Requirement: Host-initiated export
Exports created by an agent tool (`jc_export_start`), a workflow export node (`agent-workflows.Export node`), the film studio or an automation SHALL be host jobs created through the same `jagentchill.export.create` handler with `createdBy.kind` set to `agent`, `workflow`, `film` or `automation`, and they run only on the host's render host: there is no parameter that selects a client device as the renderer. Settings are given as a built-in preset id of `export-share.Built-in export presets` or a full settings object, optionally with `codecPreference[]` (`export-share.Encoder availability and licensing`); the job result reports `codecUsed`. When the host lacks `remote-export`, creation fails before any work with `RENDERER_UNAVAILABLE` or `FFMPEG_UNAVAILABLE`, and the calling step applies the no-renderer rule of `render-engine.Render host` (the step ends `skipped` with reason `no_renderer`; the project stays openable). The output is always written under the project's host export folder defined by `server-api.Host data store` — never to another path; a caller that wants the file elsewhere (an automation's destination folder) copies the finished file afterwards as its own step — is listed on every paired device like any host job, and follows the same retention.

Pre-flight for host-initiated jobs runs on the host replica with the checks of `export-share.Pre-flight validation`; a blocking item fails the job with that item's code from the table there — every item has one, so no pre-flight outcome is without a code — and `error.details.items[]` lists every blocking item `{code, elementIds[], message}`, the job's `error.code` being the first. The caller accepts waivable items in advance with these parameters of `jagentchill.export.create` and `jc_export_start`, each `boolean`, default `false`: `allowMissingMedia` (`media/unavailable`), `allowFontFallback` (`export/font-unavailable` and `export/device-font`), `allowSlates` (`export/slates-present`), `allowMissingResources` (`export/resource-missing`). Items with no waiver (`export/empty`, `export/range-too-short`, `export/template-incomplete`, `export/insufficient-space`, `export/matte-unavailable`, `export/derived-unavailable`, `export/codec-unavailable`) always fail the job. Everything waived is recorded in `export-share.Export summary`. An agent flow that drafts a timeline from a script (`script-studio.Draft timeline from a script`) and then exports therefore either passes `allowSlates: true` deliberately or receives `export/slates-present` naming the placeholder clips. [NEW]

#### Scenario: Agent starts an export
- **WHEN** an agent calls `jc_export_start` with preset `1080p` for the bound project on a host advertising `remote-export`
- **THEN** a job with `kind: "export.remote"` and `createdBy.kind: "agent"` is queued and appears on the Queue tab of every paired device

#### Scenario: Automation on a host without a renderer
- **WHEN** an automation's export instruction runs on a host without a healthy render host
- **THEN** job creation fails with `RENDERER_UNAVAILABLE`, the step ends `skipped` with reason `no_renderer`, and no paired device is asked to render

#### Scenario: Missing media on the host
- **WHEN** a workflow export node runs for a project one of whose originals is absent on the host and `allowMissingMedia` is unset
- **THEN** the job fails with `media/unavailable` naming the asset

#### Scenario: Slates after a draft timeline
- **WHEN** an agent exports a draft timeline that still holds 3 slate clips without `allowSlates`
- **THEN** the job fails with `export/slates-present` and `error.details.items[0].elementIds` names the 3 clips

#### Scenario: Slates accepted
- **WHEN** the same export is created with `allowSlates: true`
- **THEN** the job runs, the slates are rendered as they look, and the export summary lists "3 placeholder shots exported"

#### Scenario: Device font on a host job
- **WHEN** a workflow export runs for a project with a text element in a device font and `allowFontFallback` is unset
- **THEN** the job fails with `export/device-font` naming the element

#### Scenario: Not enough space on the host
- **WHEN** the estimated output exceeds the free space of the host's export volume
- **THEN** the job fails with `export/insufficient-space` before any frame is rendered

#### Scenario: Output path is fixed
- **WHEN** an automation with a destination folder outside the server's data directory starts an export
- **THEN** the export job writes inside the project's host export folder and the job record's `output.fileName` names that file

### Requirement: Multi-project sequence export
The host SHALL export several projects as one file (the whole-film export of `film-production.Final film export`): `jagentchill.export.create` with `sequence {projectIds[] (2–200, in output order), gapTicks (0 for a cut, or 60 000–360 000 ticks = 0.5–3 s of black with silence)}` creates one job of kind `export.sequence`. Every project MUST have the same canvas size and frame rate as the first, otherwise creation fails with `export/sequence-mismatch` naming the first differing project. Each project is rendered by the render host with identical settings as a segment, gaps are rendered as black segments with the same settings, and the segments are joined by a `media.concat` job using stream copy; when stream copy is refused by the muxer the whole sequence is re-encoded once. Progress is weighted by segment duration; cancel cancels every child job; a failed segment fails the sequence with that segment's error and its project id. Sequence export runs only on the host and requires `remote-export`. The output carries the provenance of `export-share.Provenance metadata` computed over all segments. **One codec for the whole sequence.** A sequence export accepts `codecPreference[]` like any host export (`export-share.Host-initiated export`); the codec is resolved once, at creation, against the host's codec table (`server-api.Host encoder policy and codec table`), every segment — including black gap segments — is encoded with that one video codec, audio codec and container, the job result reports the single `codecUsed`, and when no codec of the preference is `available` creation fails with `export/codec-unavailable` before any segment is rendered; the codec never changes between segments, also when the table changes while the job runs (the job then fails with `export/codec-unavailable` and keeps no partial sequence). [NEW]

#### Scenario: Three episodes with a cut
- **WHEN** three projects of 60 s, 90 s and 30 s at 1920×1080 30 fps are exported as a sequence with `gapTicks: 0`
- **THEN** one MP4 of 180 s ± 1 frame is produced whose content is the three projects in order

#### Scenario: Black gap
- **WHEN** the same sequence is exported with `gapTicks: 120000`
- **THEN** the output is 182 s ± 1 frame and each of the two joins shows 1 s of black with silence

#### Scenario: Mismatched project
- **WHEN** the second project is 1080×1920
- **THEN** creation fails with `export/sequence-mismatch` naming the second project and no segment is rendered

#### Scenario: Progress weighting
- **WHEN** the first of two segments, 30 s of a 120 s sequence, has finished rendering
- **THEN** reported progress of the Rendering stage is 25 % ± 2 %

#### Scenario: One codec across segments
- **WHEN** a sequence of three projects is exported on a host without H.264 with `codecPreference` `["h264", "vp9"]`
- **THEN** all three segments and the gaps are encoded as VP9 with Opus in WebM, the join uses stream copy, and the result reports `codecUsed: "vp9"`

### Requirement: Cover embedding
The export dialog SHALL show the project cover with an "Edit cover" action that opens the cover editor defined by `projects.Cover editor` (this capability defines no cover editing), and an "Embed cover" toggle (default on when a cover exists). When on, MP4 and MOV outputs embed the cover as artwork metadata (`covr`, JPEG, long side at most 1 280 px, quality 90) and M4A and MP3 outputs embed it as album art; WebM, GIF, WAV, FLAC, stills and image sequences do not embed a cover and the toggle is disabled with "Not supported for this format". "Save cover image" writes the cover as `<name>_cover.jpg` beside the output. A project with no cover uses the frame at the start of the export range for the dialog thumbnail and embeds nothing. [NEW] [CAPCUT CC-012, CC-244]

#### Scenario: Cover embedded in MP4
- **WHEN** a project with a cover is exported as MP4 with "Embed cover" on
- **THEN** the file's metadata contains one JPEG artwork whose long side is at most 1 280 px

#### Scenario: WebM
- **WHEN** WebM is selected
- **THEN** the "Embed cover" toggle is disabled with "Not supported for this format"

#### Scenario: No cover
- **WHEN** a project without a cover is exported as MP4
- **THEN** the dialog thumbnail is the first frame of the range and the file contains no artwork

### Requirement: Caption burn-in and sidecar options
Caption semantics are owned by `captions-subtitles.Burn-in and sidecar captions at export` (the stored per-track `burnIn` switch) and `captions-subtitles.Export captions` (file contents); this requirement defines the dialog. The Captions section SHALL offer, when the project has caption tracks: a master switch "Burn captions into video" (default on; on means each visible caption track is burned according to its own `burnIn`, off means no track is burned for this export) and "Also save caption files" (default off) with a format choice SRT, VTT, ASS or TXT, a track selector (default: every caption track that has captions, visible and hidden alike, as `captions-subtitles.Burn-in and sidecar captions at export` states) and, for bilingual tracks, a content choice Primary, Translation or Both (two lines per cue in one file). Sidecar files are named `<videoFileName>.<language>.<ext>`, where `<language>` is the track's BCP 47 tag and is always present (`und` when unknown), are written beside the video and honour the export range with cue times relative to the range start. With the export type "Captions only" (`export-share.Export entry points and dialog`) the same format, track and content choices are shown without the master switch, only the caption files are written, named `<fileName>.<language>.<ext>` from the file name field, and no encoder is started. A project with no caption track shows the section disabled with "This project has no captions". [NEW] [PORT N-015] [CAPCUT CC-199, CC-200]

#### Scenario: Sidecar with burn-in off
- **WHEN** a project with one English caption track is exported as `Promo.mp4` with the master switch off and SRT sidecar on
- **THEN** the video frames contain no caption pixels and `Promo.en.srt` is written beside the video with cue times relative to the export range start

#### Scenario: Per-track burn-in under the master switch
- **WHEN** the master switch is on, track A has `burnIn` on and track B has `burnIn` off
- **THEN** only track A's captions appear in the exported frames

#### Scenario: ASS sidecar for a track of unknown language
- **WHEN** ASS is chosen for a caption track with no language set and the video is `Clip.mp4`
- **THEN** the file `Clip.und.ass` is written

#### Scenario: Bilingual both
- **WHEN** a bilingual track is exported as VTT with content "Both"
- **THEN** one file is written in which each cue has the primary line followed by the translation line

#### Scenario: Captions only
- **WHEN** the export type is "Captions only" with format TXT
- **THEN** only the caption text files are written and no video encoder is started

### Requirement: Export audio checks and credits
The Audio section of the export dialog SHALL surface the audio checks defined by `audio-editing`: when any track is soloed it shows the notice "Solo is ignored when exporting" (`audio-editing.Track volume, pan and solo`); a "Licence check" button runs `audio-editing.Audio licence check` over the export range and lists each sound with its licence and any restriction; an "Analyse loudness" button mixes the range and shows integrated loudness in LUFS and true peak in dBTP as defined by `audio-editing.Audio metering`, completing at 20× real time or faster on the reference desktop. When the range uses at least one asset whose licence requires attribution, the dialog shows "Save credits file" (default on) which writes `<name>.credits.txt` beside the output with one line per asset: title, author, licence name and source URL. [NEW]

#### Scenario: Solo notice
- **WHEN** one audio track is soloed and the export dialog is opened
- **THEN** "Solo is ignored when exporting" is shown and the exported audio contains every unmuted track

#### Scenario: Credits file
- **WHEN** a project using two CC BY sounds is exported as `Trip.mp4` with "Save credits file" on
- **THEN** `Trip.credits.txt` is written with two lines, each containing title, author, licence and source URL

#### Scenario: No attribution needed
- **WHEN** the range uses only CC0 and user-recorded audio
- **THEN** "Save credits file" is not shown and no credits file is written

#### Scenario: Loudness analysis
- **WHEN** "Analyse loudness" is pressed for a 10-minute range on the reference desktop
- **THEN** integrated LUFS and true peak are shown within 30 s

### Requirement: Export summary
Every finished export SHALL carry a summary, stored on the job and shown in the completion view and in history details, listing everything that differs from a clean render: fonts replaced by the fallback family, media rendered transparent because it was missing, stickers rendered transparent because their pack item was missing (`stickers-shapes.Missing sticker state`), template resources that failed to resolve (`templates.Missing resources in a template`), transitions that held a frame for lack of handle material, HDR sources converted to SDR, `slate` stills exported, the audio codec or container fallback applied, an automatic switch from hardware to software encoding, and a visible AI label when one was burned in. An export with none of these shows "No issues". The same summary object is returned in the job record of `export-share.Remote export contract` for host jobs. [NEW]

#### Scenario: Fallback font is reported
- **WHEN** an export completes after "Export anyway" for one missing font
- **THEN** the completion view lists "1 font replaced: <family>" and the history entry shows the same line

#### Scenario: Missing sticker and template resource
- **WHEN** an export completes after "Export anyway" for one sticker whose pack item is missing and one unresolved template LUT
- **THEN** the summary lists "1 sticker missing" and "1 template resource missing: <name>"

#### Scenario: Clean export
- **WHEN** an export completes with no fallback of any kind
- **THEN** the summary shows "No issues"

#### Scenario: Held transition frame
- **WHEN** a transition lacks handle material on its outgoing side
- **THEN** the summary lists "1 transition held a frame" with the clip names

### Requirement: Provenance metadata
Every exported video, image and audio file SHALL embed provenance metadata that no export option removes. The export computes `digitalSourceType` over the elements inside the export range, where an element is AI-generated when its asset carries the generation provenance of `media-library.AI-generated asset provenance` or the element carries a `filmLink` or `workflowLink` to a generated asset: when every visual element is AI-generated the value is the IPTC term `http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia`; when at least one but not all are, or when only audio is AI-generated, it is `http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia`; when none is, the property is omitted. The file also records the software name and version. Encoding per format: MP4, MOV, PNG, JPEG and GIF carry an XMP packet with `Iptc4xmpExt:DigitalSourceType` and `xmp:CreatorTool`; WebM carries the Matroska tags `DIGITAL_SOURCE_TYPE` and `ENCODER`; MP3, M4A, FLAC and WAV carry the same two values in a comment tag. Image sequences carry the packet in every frame. The Provenance section of the dialog shows the computed value in words ("AI-generated", "Contains AI-generated media", "No AI-generated media") read-only. Host-initiated jobs pass or compute the same record, and `film-production.Content provenance labels` and `prompt-to-video-workflow.Content provenance of workflow outputs` rely on this requirement for exported files. [NEW]

#### Scenario: Fully generated timeline
- **WHEN** a project whose every visual element is an AI-generated asset is exported as MP4
- **THEN** the file's XMP contains `Iptc4xmpExt:DigitalSourceType` equal to the `trainedAlgorithmicMedia` term and `xmp:CreatorTool` naming the product and version

#### Scenario: Mixed timeline
- **WHEN** a project with one camera clip and one AI-generated image is exported as PNG sequence
- **THEN** every PNG carries the `compositeWithTrainedAlgorithmicMedia` term

#### Scenario: No generated media
- **WHEN** a project containing only user footage is exported
- **THEN** the file carries `xmp:CreatorTool` and no `DigitalSourceType` property

#### Scenario: Metadata cannot be switched off
- **WHEN** every control of the export dialog is inspected
- **THEN** no control removes or edits the provenance record

### Requirement: AI label burn-in
The Provenance section SHALL offer the switch "Add visible AI label" (default off; default on for exports started from a film whose setting "Visible AI label on exports" is on, per `film-production.Content provenance labels`), enabled whenever the computed provenance reports AI-generated media. When on, the export renders the localised text "AI-generated" as the top-most layer of every frame, in the first family of the glyph fallback chain of `text-and-titles.Bundled fonts`, in the bottom-right corner with a margin of 2.5 % of the frame's short edge, a text height of 2.5 % of the short edge, white with a black outline of one twelfth of the text height, at 60 % opacity. The label applies to video, GIF, still and image-sequence exports, is part of the exported picture only (the project is unchanged) and is rendered identically on device and on the host. Host-initiated jobs set it with `aiLabel: true`. [NEW]

#### Scenario: Label size and position
- **WHEN** a 1920×1080 export runs with the label on
- **THEN** every frame shows "AI-generated" with a text height of 27 px ± 1 px whose right and bottom edges are 27 px ± 2 px from the frame edges

#### Scenario: Label disabled without AI media
- **WHEN** the computed provenance is "No AI-generated media"
- **THEN** the switch is disabled with "This export contains no AI-generated media"

#### Scenario: Project is unchanged
- **WHEN** an export with the label on completes
- **THEN** the project document has no new element and its revision is unchanged

### Requirement: Completion view and desktop share targets
When an on-device export or a host download succeeds, the app SHALL show a completion view with the cover, file name, size, duration, elapsed time and the summary of `export-share.Export summary`, and on desktop these actions: "Show in folder", "Open", "Copy path", "Share…" (macOS: the system share sheet anchored to the button; Windows: the system Share dialog opened by the desktop main process for the file; Linux, where desktops provide no common share surface: a menu with "Copy file" — the file is placed on the clipboard as a file reference that a file manager, mail or chat application accepts by paste — and "Open with…", which opens the desktop's application chooser for the file), "Copy link" (share link, when a host advertising `share-links` is connected), "Publish…" (when a publishing connector is connected, see `export-share.Publishing connectors`) and the hand-off shortcuts of `export-share.Publishing hand-off`. The view is also reachable for any succeeded job from the Queue and History tabs of `export-share.Exports screen`. [NEW] [PORT EX-011]

#### Scenario: Show in folder
- **WHEN** the user chooses "Show in folder" after an export
- **THEN** the OS file manager opens with the exported file selected

#### Scenario: Share on each desktop system
- **WHEN** the user chooses "Share…" after an export on macOS, on Windows and on Linux
- **THEN** macOS shows the system share sheet and Windows the system Share dialog, each offering the exported file, and Linux shows the menu with "Copy file" and "Open with…"

#### Scenario: File moved since export
- **WHEN** the exported file was deleted outside the app and the user chooses "Open"
- **THEN** the message "File not found at <path>" is shown with "Export again"

### Requirement: Web share targets
On web the completion view SHALL offer "Download" (always), "Share…" when `navigator.canShare({files})` accepts the output file, "Copy link" when a host advertising `share-links` is connected, "Publish…" when a publishing connector is connected, and the hand-off shortcuts of `export-share.Publishing hand-off`. When the output was written directly to a user-chosen file through File System Access, "Download" is replaced by the text "Saved to <file name>". Sharing a file larger than the browser accepts MUST fall back to showing "Download" only with an explanatory message. [NEW]

#### Scenario: Browser supports file sharing
- **WHEN** an export completes in a browser where `navigator.canShare` accepts the file
- **THEN** "Share…" opens the system share sheet with the file attached

#### Scenario: Browser without Web Share
- **WHEN** `navigator.share` is undefined
- **THEN** "Share…" is not rendered and "Download" is available

### Requirement: Mobile share targets
On iOS and Android the completion view SHALL offer "Save to Photos" (video, GIF and still outputs; requests add-only photo library permission on first use), "Share…" (the OS share sheet with the file, which is how the file reaches any installed app), "Save to Files", "Copy link" when a host advertising `share-links` is connected, "Publish…" when a publishing connector is connected, and "Done". A user preference "Save to Photos automatically after export" (default on) performs the save without a tap. When photo library permission is denied the action shows "Photo access is off" with a button that opens the app's system settings, and the file stays available through "Share…" and "Save to Files". Audio-only outputs offer "Save to Files", "Share…" and "Done" only. The actions behave the same on both systems through their own mechanisms: "Save to Photos" adds the file to the iOS photo library (add-only permission) and to the Android shared media collection shown by gallery apps (no permission prompt on Android 10 and newer; on a device where the system does require one, the same "Photo access is off" handling applies); "Save to Files" opens the iOS document picker in export mode and the Android Storage Access Framework create-document picker; "Share…" opens the iOS share sheet and the Android share chooser. [NEW] [CAPCUT CC-258, CC-259, CC-260]

#### Scenario: Save to photo library
- **WHEN** an MP4 export completes on a phone with photo permission granted and automatic save on
- **THEN** the video appears in the device photo library and the view shows "Saved to Photos"

#### Scenario: Permission denied
- **WHEN** photo library permission is denied
- **THEN** "Save to Photos" shows "Photo access is off" with "Open Settings", and "Share…" still works

#### Scenario: Share to an installed app
- **WHEN** the user taps "Share…" and selects an installed social app in the OS sheet
- **THEN** that app receives the exported video file

### Requirement: Publishing hand-off
For destinations without a connected publishing connector the product SHALL hand the file to the user rather than upload it: on mobile through the OS share sheet; on desktop and web through shortcut buttons, one per entry of this fixed list, that reveal the exported file (desktop) or start its download (web) and open the destination's page in the default browser: TikTok `https://www.tiktok.com/upload`, YouTube `https://studio.youtube.com`, Instagram `https://www.instagram.com`, Facebook `https://www.facebook.com`, WhatsApp `https://web.whatsapp.com`. Destination names are plain text labels: no third-party logo, icon or brand colour is bundled. A caption panel holds a title (up to 100 characters) and a description (up to 2 200 characters) saved with the project, each with a "Copy" button; the same two fields pre-fill the publish form of `export-share.Publishing connectors`. No request is sent to any of these hosts by the app itself. [NEW] [CAPCUT CC-258, CC-259, CC-260]

#### Scenario: YouTube shortcut on desktop
- **WHEN** the user clicks the YouTube shortcut after an export with no YouTube connector connected
- **THEN** the file manager reveals the exported file and the default browser opens `https://studio.youtube.com`

#### Scenario: Copy description
- **WHEN** the user clicks "Copy" beside the description
- **THEN** the clipboard holds the saved description text and a toast confirms the copy

#### Scenario: Text labels only
- **WHEN** the completion view is rendered
- **THEN** each shortcut shows the destination name as text with a generic external-link icon and no brand image

#### Scenario: Title too long
- **WHEN** the user types a 101st character into the title field
- **THEN** the character is not accepted and the counter shows "100 / 100"

### Requirement: Publishing connectors
The product SHALL publish an exported video directly to an account through a host connector when one is connected. Connectors `youtube` and `tiktok` are registered and authorised as defined by `server-api.Connectors` (user-supplied OAuth client id and secret stored as host secrets, authorisation-code flow with PKCE through `GET /jagentchill/v1/connectors/{connectorId}/callback`), are configured by an `admin` device on the page of `settings-preferences.Host connectors settings`, and exist only when the host advertises feature flag `connectors`; their hosts are listed in `security-privacy.Network egress control`. "Publish…" opens a form per destination. YouTube: title (1–100 characters, required), description (0–5 000), visibility (Private default, Unlisted, Public), "Made for kids" (Yes or No, required, no default), tags (0–500 characters in total). TikTok: caption (0–2 200 characters), privacy (the options the connector reports for the account, the most restrictive preselected), and the switches "Allow comments", "Allow duets" and "Allow stitches" (each default off, hidden when the account reports it unavailable). Submitting calls `jagentchill.connector.publish {connectorId, source: {jobId} | {blobSha256}, fields, idempotencyKey}` (scope `jagentchill.export.run`), which creates a job of kind `connector.transfer` reporting upload progress through `jagentchill.job.updated`; a file that exists only on the device is first uploaded to the host as a blob. On success the job record holds the destination's item id and URL, shown in history with "Open". A destination rejection fails the job with `export/publish-rejected` and the destination's message; an expired authorisation fails with `export/connector-not-authorised` and offers "Reconnect" (admin) or "Ask an admin to reconnect". Publishing is never started by an agent or automation without the approval defined by `agent-editing-tools.Approval for out-of-project effects`. [NEW] [CAPCUT CC-258, CC-259, CC-260]

#### Scenario: Publish to YouTube as unlisted
- **WHEN** a YouTube connector is connected and the user submits title "Launch", visibility Unlisted and "Made for kids: No" for a succeeded host export
- **THEN** a `connector.transfer` job uploads the file from the host and, on success, history shows the video URL with "Open"

#### Scenario: Required field missing
- **WHEN** the YouTube form is submitted with "Made for kids" unanswered
- **THEN** the form is not submitted and the field shows "Choose Yes or No"

#### Scenario: Device-only file
- **WHEN** the user publishes a file exported on the device that is not on the host
- **THEN** the file is first uploaded as a blob with progress, and the publish job starts after the upload completes

#### Scenario: Destination rejects the upload
- **WHEN** the destination answers that the daily upload limit is reached
- **THEN** the job fails with `export/publish-rejected` showing the destination's message, and nothing is retried automatically

#### Scenario: No connector
- **WHEN** no publishing connector is connected or the host lacks the `connectors` flag
- **THEN** "Publish…" is not shown and the hand-off shortcuts remain

#### Scenario: Viewer role
- **WHEN** a device with role `viewer` calls `jagentchill.connector.publish`
- **THEN** the response is an error with code `SCOPE_DENIED`

### Requirement: Share link through the Gateway
With a connected host that advertises feature flag `share-links` the user SHALL be able to create a share link for an exported file. Share links are an explicit unsigned exception to request signing, listed as such in `server-api.Signed HTTP route surface`: the two routes `GET /jagentchill/v1/share/{token}` (player page) and `GET /jagentchill/v1/share/{token}/file` (bytes, single-range capable) are authenticated by the token alone plus the optional passcode, and exist only while the host setting `http.shareLinks.enabled` is on (default off; changed with scope `jagentchill.config.write`). `jagentchill.share.create {source: {jobId} | {blobSha256, fileName, mime}, expiresIn, passcode?, allowDownload, mode, idempotencyKey}` → `{linkId, url, expires_ms}`, `jagentchill.share.list {cursor?, limit}` and `jagentchill.share.revoke {linkId}` require scope `jagentchill.export.run`; a file that is only on the device is uploaded to the host as a blob first. `token` is 32 random bytes in base64url, stored on the host only as its SHA-256. The URL is `<host base URL>/jagentchill/v1/share/<token>`, where the base URL is the scheme and address through which the creating client reaches the host (never a hard-coded scheme). Options: expiry 1 hour, 24 hours (default), 7 days or 30 days; an optional passcode of 4–32 characters, checked in constant time and presented by the visitor through HTTP Basic authentication (user name `share`), so that range requests of the player carry it without a cookie or a query parameter; "Allow download" (default on; when off the page has no download control and the file is served with `Content-Disposition: inline`); and mode "Review" (player page with file name and duration) or "Presentation" (full-window player, autoplay muted, no other chrome). The page loads no third-party resource and is served with `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`. Each link is limited to 120 requests per minute per client address (HTTP 429 beyond), and 10 wrong passcode attempts lock the link for 15 minutes (HTTP 429). Links are listed on the Links tab of `export-share.Exports screen` with file name, creation time, expiry and view count, and can be revoked, after which the URL returns 404 within 1 s; an expired link returns 410. Creating and revoking a link is written to the audit log of `server-api.Audit log`. The create dialog MUST state that the link works only for people who can reach the host address (same network or tailnet). [NEW] [CAPCUT CC-261]

#### Scenario: Create and open a link
- **WHEN** the user creates a 24-hour review link and opens it in a browser on the same network
- **THEN** the page plays the exported video and shows its file name, with no signature header on any request

#### Scenario: Share links are off
- **WHEN** the user opens the create dialog while `http.shareLinks.enabled` is off
- **THEN** the dialog shows "Share links are turned off on this host" with "Turn on" for an `admin` device and "Ask an admin" otherwise, and no link is created

#### Scenario: Passcode required
- **WHEN** a visitor opens a passcode-protected link without credentials
- **THEN** the response is 401 with a Basic authentication challenge and no file bytes are served

#### Scenario: Passcode lock-out
- **WHEN** an eleventh wrong passcode is presented within 15 minutes of the tenth
- **THEN** the response is 429 and the correct passcode is also refused until the 15 minutes have passed

#### Scenario: Rate limit
- **WHEN** one client address sends a 121st request to a link within one minute
- **THEN** that request is answered 429

#### Scenario: Download not allowed
- **WHEN** a link created with "Allow download" off is opened
- **THEN** the page shows no download control and the file response carries `Content-Disposition: inline`

#### Scenario: URL scheme follows the connection
- **WHEN** the creating client is connected to the host at `http://100.64.0.5:18910` over a tailnet
- **THEN** the returned URL begins with `http://100.64.0.5:18910/jagentchill/v1/share/`

#### Scenario: Revoked link
- **WHEN** a link is revoked and then requested
- **THEN** the host responds 404

#### Scenario: Expired link
- **WHEN** a link is requested 25 hours after creation with the default expiry
- **THEN** the host responds 410 and no file bytes are served

#### Scenario: No host
- **WHEN** no host is connected
- **THEN** "Copy link" is shown disabled with "Connect a host to share by link"

### Requirement: Batch export
The app SHALL support batch export in two forms: (a) from the projects page, the bulk action "Export video…" of `projects.Bulk actions` with 2–20 projects selected opens the preset picker, applies one chosen preset to each project and enqueues one job per project in selection order; (b) from the export dialog, "Add another output" lets the user add up to 5 output configurations for the current project (for example 16:9 1080p MP4 and a GIF), enqueued as separate jobs sharing one snapshot. Each job runs pre-flight individually; jobs failing pre-flight are listed in a summary with reasons and the remaining jobs are enqueued. Batch output names follow the project names with collision suffixes. Jobs that would exceed the queue limit of `export-share.Export queue` are not enqueued and are listed in the summary with "Export queue is full (20)". [NEW] [CAPCUT CC-263]

#### Scenario: Export three projects
- **WHEN** three projects are selected on the projects page and exported with "1080p"
- **THEN** three jobs are added to the queue in selection order

#### Scenario: One project fails pre-flight
- **WHEN** one of the three projects is empty
- **THEN** two jobs are enqueued and the summary lists the empty project with "Project is empty"

#### Scenario: Twenty-one projects
- **WHEN** 21 projects are selected on the projects page
- **THEN** "Export video…" is disabled with the tooltip "Select at most 20 projects"

#### Scenario: Sixth output
- **WHEN** five output configurations exist in the export dialog
- **THEN** "Add another output" is disabled with "5 outputs maximum"

### Requirement: Export history
The app SHALL keep an export history per device of the most recent 200 jobs, shown on the History tab of `export-share.Exports screen`, with project name and id, settings summary, target (device or host name), output path or location, size, duration, start and end times (`_ms` timestamps), state, the summary of `export-share.Export summary`, published item URLs, and error code where present. History is searchable by project and file name and filterable by state and type. Row actions: "Show in folder" / "Open" / share and publish actions for succeeded jobs whose file still exists (rows whose file is gone show "File missing"), "Export again" (opens the dialog with the same settings against the current project state), "Copy settings as preset", "View details" and "Remove from history" (with an option to delete the file). History persists across restarts and is not synced to other devices; host jobs are listed from `jagentchill.export.list` on every paired device and their removal calls `jagentchill.export.delete`. Beyond 200 entries the oldest entries are removed. [NEW]

#### Scenario: Re-export from history
- **WHEN** the user chooses "Export again" on a succeeded entry
- **THEN** the export dialog opens for that project with every setting of the entry restored

#### Scenario: File missing
- **WHEN** an entry's output file no longer exists
- **THEN** the row shows "File missing" and offers "Export again" and "Remove from history" only

#### Scenario: Empty history
- **WHEN** no export has been made on the device
- **THEN** the history view shows "No exports yet" with a button that returns to the projects page

#### Scenario: History limit
- **WHEN** a 201st job is recorded
- **THEN** the oldest entry is removed and 200 entries remain

### Requirement: Failure diagnostics and retry
A failed export SHALL show a failure view with a human-readable message, the error code (from `export-share.Export error codes`), and the actions "Retry" (same settings, new snapshot of the current project unless "Retry with the same snapshot" is chosen), "Retry on host" (when a host advertising `remote-export` is connected), "Copy details" and "Close". Copied details contain: error code and message, stage, frame index, export settings, encoder configuration, engine backend, platform and app version, free disk space, and the last 50 engine diagnostics; they MUST NOT contain media content, file contents, share-link tokens or API keys. Every failure is recorded in history and in the local diagnostics log. [PORT EX-009]

#### Scenario: Copy details
- **WHEN** an export fails with `export/encoder-error` at frame 1 204 and the user chooses "Copy details"
- **THEN** the clipboard text contains the code, the frame index 1204, the encoder configuration and the app version
- **AND** contains no file contents

#### Scenario: Retry
- **WHEN** the user chooses "Retry" on a failed job
- **THEN** a new job with the same settings starts and the failed job stays in history

#### Scenario: Retry on host
- **WHEN** an on-device export failed with `export/no-gpu` and a host advertising `remote-export` is connected
- **THEN** "Retry on host" starts the hand-off of `export-share.Gateway export hand-off` with the same settings

### Requirement: Export error codes
Export failures SHALL use exactly this closed set of domain codes, registered by name in the `export/<kebab>` family of `server-api.RPC error envelope`: `export/empty`, `export/range-too-short`, `export/no-gpu`, `export/write-failed`, `export/insufficient-space`, `export/encoder-unsupported`, `export/encoder-error`, `export/codec-unavailable`, `export/font-unavailable`, `export/device-font`, `export/matte-unavailable`, `export/derived-unavailable`, `export/slates-present`, `export/resource-missing`, `export/template-incomplete`, `export/device-lost`, `export/engine-panic`, `export/interrupted`, `export/out-of-memory`, `export/queue-full`, `export/host-restarted`, `export/upload-failed`, `export/download-failed`, `export/output-expired`, `export/sequence-mismatch`, `export/share-disabled`, `export/publish-rejected` and `export/connector-not-authorised`. Export operations additionally surface, unchanged, the engine codes `media/unavailable`, `media/original-unavailable` and `engine/encoder-unavailable` (`render-engine.Engine error codes`) and the general codes `RENDERER_UNAVAILABLE`, `FFMPEG_UNAVAILABLE`, `QUOTA_EXCEEDED`, `SCOPE_DENIED`, `INVALID_PARAMS`, `NOT_FOUND`, `CONFLICT`, `CANCELLED` and `RATE_LIMITED`. An engine reply `engine/no-gpu` to `export.start` is reported to the user as `export/no-gpu`; `export/derived-unavailable` is raised when a derived asset the frame needs (`render-engine.Derived asset delivery to the engine`: a matte, stem, stabilisation or retime result) cannot be delivered to the engine. Each code has one localised message and one primary remedy: `export/no-gpu`, `export/encoder-unsupported`, `export/out-of-memory` → "Export on host"; `export/codec-unavailable` → "Choose another codec" listing `details.available[]` (and, for an `admin` device when `details.downloadRequired[]` is not empty, "Open host diagnostics"); `export/write-failed`, `export/insufficient-space` → "Choose another location"; `export/interrupted`, `export/host-restarted`, `export/device-lost`, `export/engine-panic`, `export/encoder-error` → "Retry"; `export/font-unavailable`, `export/device-font`, `export/matte-unavailable`, `export/derived-unavailable`, `export/slates-present`, `export/resource-missing`, `export/template-incomplete`, `media/unavailable`, `media/original-unavailable` → the pre-flight remedies of `export-share.Pre-flight validation`; `export/output-expired` → "Export again"; `export/share-disabled` → "Turn on" (admin); `export/connector-not-authorised` → "Reconnect"; `RENDERER_UNAVAILABLE`, `FFMPEG_UNAVAILABLE` → "Open host diagnostics". [NEW]

#### Scenario: Unknown code is a test failure
- **WHEN** a test build records an export failure whose code is not in the listed sets
- **THEN** the test run fails naming the code

#### Scenario: Every pre-flight item has a code
- **WHEN** the contract test walks the item table of `export-share.Pre-flight validation`
- **THEN** every row's code is a member of the sets listed here

#### Scenario: Engine no-GPU maps to the export code
- **WHEN** the engine replies `engine/no-gpu` to `export.start`
- **THEN** the job fails with `export/no-gpu` and the failure view offers "Export on host"

#### Scenario: Share links disabled
- **WHEN** `jagentchill.share.create` is called while `http.shareLinks.enabled` is off
- **THEN** the response is an error with code `export/share-disabled`

### Requirement: Automatic encoder fallback on failure
When a hardware video encoder throws during an on-device export, the exporter SHALL retry once automatically from frame 0 with `hardwareAcceleration: "prefer-software"` and the same codec, showing the notice "Hardware encoder failed; retrying with software encoding". If the software encoder also fails or is unsupported, the job fails with `export/encoder-error` and the failure view offers "Retry on host" when connected and "Try H.264" when another supported codec exists. An out-of-memory condition MUST fail the job with `export/out-of-memory` and offer a retry at the next lower resolution. [NEW]

#### Scenario: Hardware encoder error
- **WHEN** the hardware HEVC encoder errors at frame 300
- **THEN** the export restarts with software encoding once and the notice is shown

#### Scenario: Both encoders fail
- **WHEN** the software retry also errors
- **THEN** the job fails with `export/encoder-error` and "Retry on host" is offered when a host is connected

### Requirement: Encoder availability and licensing
The product SHALL state which encoder produces each output, on which target it is expected, and under which licence terms it is used; no export ever waits for a prompt, a download or a person.

**Expected encoders per target.** A CI job per target runs the capability probe on that target's reference machine and fails when a cell marked "required" is missing; "optional" cells are reported, never assumed; "absent" cells fail the job when present (a licence regression).

| Target | H.264 hardware | H.264 software | HEVC | VP9 | AV1 | AAC | Opus | FLAC | MP3 |
|---|---|---|---|---|---|---|---|---|---|
| Desktop app, macOS | required (VideoToolbox) | required (runtime) | optional (hardware) | required | optional | required | required | required | required (bundled module) |
| Desktop app, Windows | optional | required (runtime) | optional (hardware) | required | optional | required | required | required | required (bundled module) |
| Desktop app, Linux | optional (VA-API) | required (runtime) | absent | required | optional | absent | required | required | required (bundled module) |
| Web, Chromium-based browser | optional | optional | optional | required | optional | optional | required | optional | required (bundled module) |
| iOS and iPadOS app | required | absent | required (hardware) | optional | optional | required | optional | optional | required (bundled module) |
| Android app | required | optional | optional (hardware) | optional | optional | required | optional | optional | required (bundled module) |
| Host (bundled FFmpeg; macOS, Windows, Linux, container) | optional — `available` with a verified hardware encoder | optional — `available` once OpenH264 is installed, else `download_required` | optional (hardware only) | required (libvpx) | required (SVT-AV1) | required (FFmpeg native AAC) | required (libopus) | required | required (LAME, LGPL) |

**Devices.** On devices, video and AAC, Opus and FLAC audio are encoded only through WebCodecs by the encoders of the runtime the app runs in. On the desktop app and in the render host that runtime is the product's Electron binary: its Chromium contains a compiled-in software H.264 encoder (OpenH264, BSD-2-Clause, built from source into the runtime) which WebCodecs uses when no hardware encoder exists, so the desktop app does distribute a software H.264 encoder as part of its runtime — the product adds no other video encoder of its own. The licence position for that encoder (patent-licence responsibility of the distributor for a self-built OpenH264) SHALL be recorded as a decision in `docs/decisions/` before the first desktop release and the encoder SHALL be listed in `THIRD_PARTY_NOTICES.md`; when the recorded decision is not to distribute it, the Electron runtime is built without it on all three desktop systems alike and the table cell "H.264 software" for the desktop rows becomes "absent" in the same change. GIF and WAV encoders are project code. The MP3 encoder is a LAME-derived module under the LGPL (version 2.1 or newer), shipped as a separately loaded, replaceable wasm file with its source offer in `THIRD_PARTY_NOTICES.md`, as allowed by `platform-skeleton.Licence and third-party notices`.

**Host.** On the host every encode is done by FFmpeg as an external process under `server-api.Host encoder policy and codec table`, which owns the policy this capability presents: the royalty-free path (VP9 or AV1 with Opus) always exists; H.264 is `available` with a verified hardware encoder or an installed OpenH264 and `download_required` otherwise; OpenH264 is fetched only as a host-setup action an admin accepted (desktop first-run dialog on macOS, Windows and Linux; host CLI; `JAGENTCHILL_ACCEPT_OPENH264=1`), never compiled into a distributed FFmpeg and never requested at export time; HEVC is hardware-only; a user-supplied FFmpeg of version 6.1 or newer is accepted (`server-api.FFmpeg worker`). The feature `remote-export` is advertised whenever the render host is healthy, whatever the H.264 state.

**Codec table in the UI.** The export dialog and sheets read the host's codec table (`encoders {h264, hevc, vp9, av1, aac, opus}`, each `{state: "available" | "download_required" | "unavailable", encoder?, hardware, reason?}`) and show, for the target "Host: <name>": an `available` codec as selectable; a `download_required` codec disabled with "This host needs the OpenH264 encoder" and, for an `admin` device, the action "Open host diagnostics" (where "Download" lives) — the export dialog itself never starts the download; an `unavailable` codec disabled with "This host has no <codec> encoder". For the target "This device" an unsupported codec reads "Not supported on this device". A codec with no encoder on the selected target is never substituted silently.

**Fail fast and preference.** A job whose requested codec is not `available` on its target fails at creation — or at start when the state changed in between — with `export/codec-unavailable` and `details {requested, available[], downloadRequired[]}`; it is never left `queued`. `jagentchill.export.create`, `jc_export_start`, workflow export nodes and automation export instructions accept `codecPreference[]`, an ordered list of 1–6 entries `{video, audio, container}`; the first entry whose codecs are all `available` and container-compatible is used and reported as `codecUsed` in the job record and the tool result; with none available the job fails with `export/codec-unavailable`. When a host-initiated job names a preset and no `codecPreference`, the default preference is `[{h264, aac, mp4}, {vp9, opus, webm}]`, so an unattended export on a host without H.264 produces a WebM instead of failing or waiting. [NEW]

#### Scenario: MP3 encoder is a separate file
- **WHEN** the web build is inspected
- **THEN** the MP3 encoder is a separate wasm file that is fetched only when an MP3 export starts, and the notices file lists it with its LGPL source offer

#### Scenario: No prompt at export time
- **WHEN** an H.264 export is created on a host with no hardware H.264 encoder and no installed OpenH264, with no `codecPreference`  and explicit settings naming H.264
- **THEN** creation fails at once with `export/codec-unavailable`, `details.downloadRequired` lists `h264`, `details.available` lists `vp9` and `av1`, no device is asked anything and no job is left `queued`

#### Scenario: Automation falls back along its preference
- **WHEN** an automation's export instruction with preset `1080p` runs on that same host
- **THEN** the job uses VP9 with Opus in WebM, succeeds, and its record reports `codecUsed {video: "vp9", audio: "opus", container: "webm"}`

#### Scenario: Download-required codec in the dialog
- **WHEN** an `editor` device opens the export dialog with the target "Host: Studio" whose H.264 row reads `download_required`
- **THEN** H.264 is disabled with "This host needs the OpenH264 encoder", VP9 and AV1 are selectable, and the dialog offers no download button

#### Scenario: HEVC on a host without a hardware encoder
- **WHEN** the host has no hardware HEVC encoder and the bundled FFmpeg is in use
- **THEN** the codec table reports HEVC `unavailable` and the dialog shows "This host has no HEVC encoder"

#### Scenario: Per-target encoder check
- **WHEN** the encoder CI job runs on the Linux desktop reference machine and finds no VP9 encoder, or finds an AAC encoder
- **THEN** the job fails naming the cell that differs from the table

#### Scenario: Desktop software H.264 is declared
- **WHEN** the release check inspects the desktop build on macOS, Windows and Linux
- **THEN** it fails unless the notices file lists the runtime's software H.264 encoder and `docs/decisions/` holds the licence decision, or the runtime contains no such encoder on any of the three

#### Scenario: Bundled FFmpeg build check
- **WHEN** the release pipeline inspects the configuration of the FFmpeg binary it is about to distribute and finds `--enable-gpl`
- **THEN** the pipeline fails

### Requirement: Export settings persistence
The last used export settings SHALL be stored per project in the root field `exportSettings {type?, presetId?, values}` of the project document (`project-document.Project-level stores`; synced with the project), and the last used settings overall per device (used as the default for projects with none). `type` is one of `video`, `gif`, `audio`, `image-sequence`, `still`, `captions`. `values` SHALL hold exactly these keys, all optional: `resolution {width, height}`, `frameRate {numerator, denominator}`, `bitrateMode`, `bitrateKbps`, `rateControl`, `videoCodec`, `container`, `hardwareAcceleration`, `smoothMotion`, `includeAudio`, `audioCodec`, `audioBitrateKbps`, `sampleRate`, `channels`, `audioFallback` (the explicit choice of `export-share.Audio settings for video export`), `burnCaptions`, `sidecar {enabled, format, trackIds[], content}`, `embedCover`, `aiLabel`, `creditsFile`, `range` (`all` or `in-out`), `includeTransparency`, `gif {width, frameRate, loop, dither}`, `imageSequence {format, quality}`, `still {format, quality}`, `audioOnly {format, bitrateKbps}`, `target` (`device` or `host`). They never hold the absolute save path — stored per device only in `local.exportSavePath` (`project-document.Device-local section`) — nor a share-link token or passcode, which the document validator refuses. The publish caption of `export-share.Publishing hand-off` is the root field `publish {title, description}`. Unknown keys read from stored settings MUST be preserved on write. [NEW]

#### Scenario: Settings restored per project
- **WHEN** project A was last exported as 720p WebM and project B as 4K MP4
- **THEN** opening the export dialog in A shows 720p WebM and in B shows 4K MP4

#### Scenario: Project opened on another device
- **WHEN** project A is opened on a second device after sync
- **THEN** the dialog shows 720p WebM and the save location is that device's default

#### Scenario: Unknown field survives
- **WHEN** stored settings contain a key `extraOption: 3` unknown to this app version and the user exports once
- **THEN** `exportSettings.values` written afterwards still contains `extraOption: 3`

#### Scenario: Path is refused
- **WHEN** a writer tries to store `values.path: "/Users/me/Movies"` in the project
- **THEN** the change is rejected with `document/field-not-allowed`

### Requirement: Keyboard access and accessibility of export
The export dialog, queue, history and completion view SHALL be fully operable by keyboard on desktop and web: Tab order follows the visual order, Enter on the primary button starts the export, Escape closes the dialog without cancelling a running job, and every control has an accessible name. Progress is exposed as a `progressbar` with `aria-valuenow` and announced by a polite live region at each 10 % step and on completion or failure. On mobile every control is reachable by the screen reader with touch targets of at least 44×44 pt. All strings come from locale resources (en, vi, ja). [NEW]

#### Scenario: Keyboard-only export
- **WHEN** a keyboard user opens the dialog, tabs to Export and presses Enter
- **THEN** the export starts without any pointer interaction

#### Scenario: Progress announcement
- **WHEN** progress passes 50 %
- **THEN** the live region announces "Export 50 percent"

### Requirement: Export completion notification
Export completion and failure notices are owned by `notifications.Export completion signal` (kinds `export.finished` and `export.failed` with `target: "device" | "gateway"`); this capability SHALL raise that signal for every job that reaches `succeeded` or `failed` while its dialog is closed, the editor is not focused, or the job runs on the host, and activating the notification opens the completion or failure view of the job. [NEW]

#### Scenario: Desktop window in background
- **WHEN** an export finishes while the desktop window is minimised
- **THEN** one `export.finished` signal with `target: "device"` is raised and activating its notification opens the completion view

#### Scenario: host job fails
- **WHEN** a host export fails while no device has the dialog open
- **THEN** one `export.failed` signal with `target: "gateway"` is raised and activating it opens the failure view
