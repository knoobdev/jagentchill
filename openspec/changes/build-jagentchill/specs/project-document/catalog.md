# project-document — normative catalogue (schema 32)

This file is normative for capability `project-document`. It is the complete field list of the project document at
`schemaVersion: 32`. A field that is not in this file does not exist at schema 32. The requirement
`project-document.Canonical field list` makes every table below binding; the other requirements of the capability cite
the sections by number.

Column meaning in every field table:

- **Field** — the stored key, written exactly as stored (camelCase; nested keys are shown with dots).
- **Type** — a value type of §1, a literal union, or a structure defined in the named section.
- **Unit / range** — unit and inclusive range; "step" is the registry step used when a writer coerces a value.
- **Default** — the value a reader uses when the field is absent. "required" means the field is always present.
  "absent" means the field is omitted when it has no value.
- **Anim** — `yes` when the field has an animation path in §11; `no` otherwise.
- **Owner** — the capability that defines the field's BEHAVIOUR (meaning, UI, rendering parameters). This capability
  owns the name, type, range, default and position of every field.

## 1. Value types

| Type | Definition |
|---|---|
| `Id` | string, 1–64 characters from `A–Z a–z 0–9 _ . : -`. Ids created by JAgentChill are lowercase UUID v4. Ids read from OpenCut classic are kept unchanged. |
| `Ticks` | integer media time, 120 000 ticks per second, 0 … 10 368 000 000 (24 h) unless a narrower range is stated. Never fractional. |
| `Rational` | `{numerator, denominator}`, both integers 1 … 1 000 000, reduced by their greatest common divisor. |
| `Ms` | integer Unix UTC milliseconds, 0 … 8 640 000 000 000 000; only in fields whose key ends in `_ms`. |
| `Color` | string `#rrggbb` or `#rrggbbaa`, lowercase hexadecimal. Readers accept upper case; writers store lower case. |
| `ColorRgb` | string `#rrggbb` (no alpha), lowercase. |
| `Db` | number in decibels, stored rounded to 0.01. |
| `Percent` | number on a 0–100 scale unless a range is stated. |
| `Fraction` | number 0–1 unless a range is stated. |
| `Degrees` | number of degrees. |
| `Sha256` | string of 64 lowercase hexadecimal characters. |
| `Lang` | BCP-47 language tag, or `und`. |
| `Text(n)` | string of at most `n` Unicode code points, NFC-normalised, line separator `\n`. |
| `Vec2` | `{x, y}`, two numbers. |

## 2. Project (document root)

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `format` | `"jagentchill.project"` | constant | required | no | project-document |
| `schemaVersion` | integer | ≥ 32 | required | no | project-storage |
| `minReaderSchemaVersion` | integer | 32 … `schemaVersion` | required | no | project-document |
| `version` | integer | legacy classic version (≤ 31); never read after migration | absent | no | project-storage |
| `metadata.id` | `Id` | the project id | required | no | projects |
| `metadata.name` | `Text(120)` | 1–120 characters after trim | required | no | projects |
| `metadata.duration` | `Ticks` | derived: the end of the last element of the main scene | required | no | timeline-editing |
| `metadata.created_ms` | `Ms` | | required | no | projects |
| `metadata.updated_ms` | `Ms` | set on every committed change | required | no | project-storage |
| `metadata.pinned_ms` | `Ms` | when the project was pinned in the Projects screens; absent while it is not pinned; never read by editing or rendering | absent | no | projects |
| `metadata.importedFrom` | `{source: "opencut-classic", id: Id}` | written by `project-storage.Classic bundle ingestion`: the classic project id of an imported project; never read by editing or rendering | absent | no | project-storage |
| `metadata.thumbnail` | `null` | always `null` at schema 32 (the image lives in the thumbnail store) | `null` | no | projects |
| `settings` | Settings (§3.1) | | required | no | projects |
| `cover` | Cover (§3.3) or `null` | | `null` | no | projects |
| `filmLink` | `{filmId: Id, episodeId: Id}` | | absent | no | film-production |
| `workflowLink` | `{runId: Id}` | | absent | no | agent-workflows |
| `scriptLinks` | array of `{scriptId: Id}` | 0–20 entries, unique `scriptId` | `[]` | no | script-studio |
| `template` | TemplateMode (§3.4) | | absent | no | templates |
| `scenes` | array of Scene (§4) | 1–200, array order is scene order | required | no | timeline-editing |
| `media` | MediaSection (§12) | | required | no | media-library |
| `glossaries` | map `Lang` → array of `{source: Text(80), target: Text(80)}` | ≤ 24 languages, ≤ 200 pairs each | `{}` | no | captions-subtitles |
| `exportSettings` | ExportSettings (§3.5) | | absent | no | export-share |
| `publish` | `{title: Text(100), description: Text(2200)}` | | absent | no | export-share |
| `local` | Local (§16) | device-local; excluded from the canonical form | absent | no | project-storage |

### 3.1 Settings

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `settings.fps` | `Rational` | frames per second | `{30, 1}` | no | projects |
| `settings.canvasSize.width` | integer | px, even, 16–7680 | 1920 | no | projects |
| `settings.canvasSize.height` | integer | px, even, 16–7680; width × height ≤ 33 177 600 | 1080 | no | projects |
| `settings.canvasSizeMode` | `"preset" \| "custom"` | | `"preset"` | no | projects |
| `settings.lastCustomCanvasSize` | `{width, height}` or `null` | same ranges as `canvasSize` | `null` | no | projects |
| `settings.originalCanvasSize` | `{width, height}` or `null` | the size adopted from the first media | `null` | no | projects |
| `settings.adoptCanvasFromFirstMedia` | boolean | adoption armed for canvas size | `true` | no | projects |
| `settings.adoptFrameRateFromFirstMedia` | boolean | adoption armed for frame rate | `true` | no | projects |
| `settings.background` | Background (§3.2) | the project default background | `{kind: "color", color: "#000000"}` | no | projects |
| `settings.useProxies` | boolean | "Use proxies for preview" | `true` | no | media-library |
| `settings.colorPipeline` | `"sdr-rec709-8bit"` | constant at schema 32 | `"sdr-rec709-8bit"` | no | render-engine |

### 3.2 Background (canvas background union)

Used by `settings.background` and by the per-clip `background` of video, image and compound elements (§7.4). The
discriminator is `kind`.

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `kind` | `"color" \| "gradient" \| "blur" \| "image" \| "transparent"` | | required | no | projects |
| `color` | `ColorRgb` | `kind: "color"` only | required for `color` | no | projects |
| `css` | `Text(4000)` | `kind: "gradient"` only; a CSS gradient string, never rewritten | required for `gradient` | no | projects |
| `blurIntensity` | integer | `kind: "blur"` only; 0–1000, step 10 | 200 | no | projects |
| `mediaId` | `Id` | `kind: "image"` only; an image asset of §12 | required for `image` | no | projects |
| `fit` | `"cover" \| "contain" \| "stretch"` | `kind: "image"` only | `"cover"` | no | projects |

### 3.3 Cover

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `cover.source` | `"frame" \| "image"` | | required | no | projects |
| `cover.sceneId` | `Id` | `source: "frame"` | absent | no | projects |
| `cover.time` | `Ticks` | `source: "frame"`; frame-aligned | absent | no | projects |
| `cover.mediaId` | `Id` | `source: "image"` | absent | no | projects |
| `cover.crop` | `{x: Fraction, y: Fraction, zoom: number}` | centre of the crop in the image; zoom 1–8 | `{0.5, 0.5, 1}` | no | projects |
| `cover.texts` | array of CoverText | 0–5 | `[]` | no | projects |
| `cover.texts[].id` | `Id` | | required | no | projects |
| `cover.texts[].style` | TextStyle (§10.4, without `textAnimation`, `tracking`, `bubble`) | | required | no | text-and-titles |
| `cover.texts[].content` | `Text(500)` | | required | no | projects |
| `cover.texts[].position` | `Vec2` | canvas px from the canvas centre | `{0, 0}` | no | projects |
| `cover.texts[].scale` | number | 0.01–100 | 1 | no | projects |
| `cover.texts[].rotation` | `Degrees` | −3600…3600 | 0 | no | projects |
| `cover.image.sha256` | `Sha256` | the rendered cover in the cover store | required | no | projects |
| `cover.image.mime` | `"image/jpeg" \| "image/png"` | | required | no | projects |
| `cover.image.width` | integer | px, ≤ 1920 on the long side | required | no | projects |
| `cover.image.height` | integer | px | required | no | projects |

### 3.4 TemplateMode

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `template.templateId` | `Id` | the template the project was created from | required | no | templates |
| `template.locked` | boolean | `true` = template mode (structure locked) | required | no | templates |
| `template.sceneId` | `Id` | the scene that holds the slots | required | no | templates |
| `template.slots` | array of Slot | 0–200, unique `slotId`, ordered by `index` | `[]` | no | templates |
| `template.slots[].slotId` | `Id` | | required | no | templates |
| `template.slots[].elementId` | `Id` | a video or image element of `template.sceneId` | required | no | templates |
| `template.slots[].index` | integer | 1-based fill order, unique | required | no | templates |
| `template.slots[].accepts` | `"video" \| "image" \| "any"` | | `"any"` | no | templates |
| `template.slots[].duration` | `Ticks` | equals the slot element's `duration` | required | no | templates |
| `template.slots[].required` | boolean | | `true` | no | templates |
| `template.slots[].label` | `Text(80)` | | `""` | no | templates |
| `template.slots[].filled` | boolean | `false` = the element has no media source | `false` | no | templates |
| `template.slots[].framing.zoom` | number | 1–5 | 1 | no | templates |
| `template.slots[].framing.panX` | number | −1…1, fraction of the free travel | 0 | no | templates |
| `template.slots[].framing.panY` | number | −1…1 | 0 | no | templates |
| `template.slots[].sourceOffset` | `Ticks` | 0 … `sourceDuration − duration` | 0 | no | templates |
| `template.editableTexts` | array of `{elementId: Id, label: Text(80), maxLength: integer 1–10 000}` | 0–200 | `[]` | no | templates |
| `template.audioSlots` | array of `{elementId: Id, label: Text(80), replaceable: boolean}` | 0–50 | `[]` | no | templates |
| `template.themeColors` | array of `Color` | 0–6 | `[]` | no | templates |
| `template.variables` | array of `{id: Id, label: Text(80), type: "text" \| "color" \| "image" \| "number", defaultValue, value, maxLength?: integer 1–10 000, bindings: array of {elementId: Id, field: Text(200)} (0–500)}` | 0–200; filling one sets every bound field in one undo step | `[]` | no | templates |
| `template.colorBindings` | array of `{colorIndex: integer, elementId: Id, field: string}` | 0–500; `colorIndex` is an index into `themeColors`; `field` is the stored path of a `Color` field of that element (for example `color`, `stroke.color`, `background.color`, `params.fill`); a pair (`elementId`, `field`) appears at most once | `[]` | no | templates |

### 3.5 ExportSettings

Behaviour is owned by `export-share.Export settings persistence`; the key names, types and forbidden content are fixed
here. A key of `values` that is not listed is an unknown field (`project-document.Unknown-field preservation`).

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `exportSettings.type` | `"video" \| "audio" \| "gif" \| "sequence" \| "still"` | | absent | no | export-share |
| `exportSettings.presetId` | `Id` | | absent | no | export-share |
| `exportSettings.values` | object | exactly the keys below; MUST NOT contain a file-system path, a share-link token or a passcode | `{}` | no | export-share |
| `exportSettings.values.resolution` | `{width: integer, height: integer}` or `"match"` | even integers 16–7680 | `"match"` | no | export-share |
| `exportSettings.values.frameRate` | `Rational` or `"match"` | | `"match"` | no | export-share |
| `exportSettings.values.bitrateMode` | `"auto" \| "cbr" \| "vbr"` | | `"auto"` | no | export-share |
| `exportSettings.values.bitrate` | integer | bits per second, 100 000–200 000 000; read when `bitrateMode` is not `auto` | absent | no | export-share |
| `exportSettings.values.codec` | string | a codec id of `export-share.Encoder availability and licensing`, ≤ 40 characters | absent | no | export-share |
| `exportSettings.values.container` | string | a container id of `export-share.Container formats`, ≤ 40 characters | absent | no | export-share |
| `exportSettings.values.audio` | `{enabled: boolean, codec?: string, bitrate?: integer, sampleRate?: integer, channels?: 1 \| 2}` | | `{enabled: true}` | no | export-share |
| `exportSettings.values.captions` | `{burnIn: boolean, sidecar: "none" \| "srt" \| "vtt" \| "ass"}` | | `{burnIn: true, sidecar: "none"}` | no | export-share |
| `exportSettings.values.embedCover` | boolean | | `false` | no | export-share |
| `exportSettings.values.aiLabel` | boolean | the visible AI label switch | `false` | no | export-share |
| `exportSettings.values.creditsFile` | boolean | | `false` | no | export-share |
| `exportSettings.values.scope` | `"project" \| "range" \| "scene"` | | `"project"` | no | export-share |
| `exportSettings.values.target` | `"device" \| "host"` | where the export runs | `"device"` | no | export-share |
| `exportSettings.values.smoothMotion` | boolean | frame-rate matching of `speed-retime.Frame-rate matching at export` | `false` | no | export-share |

## 4. Scene

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `id` | `Id` | | required | no | timeline-editing |
| `name` | `Text(80)` | 1–80 characters | required | no | timeline-editing |
| `isMain` | boolean | exactly one scene has `true` | required | no | timeline-editing |
| `kind` | `"timeline" \| "compound" \| "multicam"` | | `"timeline"` | no | timeline-editing |
| `compoundBackground` | `"none" \| "own"` | read only when the scene renders as a compound source | `"none"` | no | render-engine |
| `tracks.overlay` | array of Track (§5) | 0–99; index 0 is the topmost layer | `[]` | no | timeline-editing |
| `tracks.main` | Track (§5) of type `video` | exactly one | required | no | timeline-editing |
| `tracks.audio` | array of Track (§5) of type `audio` | 0–99 | `[]` | no | timeline-editing |
| `markers` | array of Marker | 0–1 000, sorted by `time`, one per frame | `[]` | no | timeline-editing |
| `markers[].id` | `Id` | | required | no | timeline-editing |
| `markers[].time` | `Ticks` | frame-aligned | required | no | timeline-editing |
| `markers[].note` | `Text(2000)` | | absent | no | timeline-editing |
| `markers[].color` | integer 1–8 or `ColorRgb` | palette token index or custom colour | 1 | no | timeline-editing |
| `markers[].duration` | `Ticks` | > 0 | absent | no | timeline-editing |
| `inPoint` | `Ticks` | frame-aligned; `inPoint < outPoint` when both exist | absent | no | timeline-editing |
| `outPoint` | `Ticks` | frame-aligned | absent | no | timeline-editing |
| `multicam` | Multicam (§4.1) | present if and only if `kind: "multicam"` | absent | no | timeline-editing |
| `created_ms` | `Ms` | | required | no | timeline-editing |
| `updated_ms` | `Ms` | | required | no | timeline-editing |

### 4.1 Multicam (scene-level multi-camera definition)

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `multicam.syncMethod` | `"audio" \| "start" \| "playhead"` | the method used at creation | required | no | timeline-editing |
| `multicam.angles` | array of Angle | 2–8, unique `id`, array order is angle order | required | no | timeline-editing |
| `multicam.angles[].id` | `Id` | | required | no | timeline-editing |
| `multicam.angles[].name` | `Text(80)` | default "Angle {n}" | required | no | timeline-editing |
| `multicam.angles[].trackId` | `Id` | a `video` track of this scene; one angle per track | required | no | timeline-editing |
| `multicam.angles[].syncOffset` | integer | ticks, −3 600 000 … 3 600 000 (±30 s); the offset applied by the sync method | 0 | no | timeline-editing |
| `multicam.angles[].syncConfidence` | `Fraction` | peak correlation for `syncMethod: "audio"` | absent | no | timeline-editing |
| `multicam.audioAngleId` | `Id` | the angle whose audio is heard | first angle | no | timeline-editing |
| `multicam.audioFollowsVideo` | boolean | when `true` the active angle of each clip supplies the audio | `false` | no | timeline-editing |

## 5. Track

Zone is not a stored field: it is the container (`tracks.overlay`, `tracks.main`, `tracks.audio`).

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `id` | `Id` | | required | no | timeline-editing |
| `name` | `Text(80)` | 1–80 characters | required | no | timeline-editing |
| `type` | `"video" \| "text" \| "audio" \| "graphic" \| "effect" \| "adjustment" \| "caption"` | | required | no | timeline-editing |
| `locked` | boolean | every track type | `false` | no | timeline-editing |
| `pinned` | boolean | every track type; a pinned empty track is not pruned | `false` | no | timeline-editing |
| `hidden` | boolean | every type except `audio` | `false` | no | timeline-editing |
| `muted` | boolean | `video` and `audio` tracks | `false` | no | audio-editing |
| `solo` | boolean | `video` and `audio` tracks | `false` | no | audio-editing |
| `volume` | `Db` | `video` and `audio` tracks; −60…+12, −60 = silence | 0 | no | audio-editing |
| `pan` | integer | `video` and `audio` tracks; −100 (left) … +100 (right) | 0 | no | audio-editing |
| `ducking.enabled` | boolean | `audio` tracks | `false` | no | audio-editing |
| `ducking.amount` | number | dB, 0–30 | 12 | no | audio-editing |
| `ducking.attack` | integer | ms, 10–1000 | 200 | no | audio-editing |
| `ducking.release` | integer | ms, 50–3000 | 500 | no | audio-editing |
| `ducking.mode` | `"full" \| "voice-band"` | `voice-band` lowers only about 300 Hz–4 kHz of the music under speech | `"full"` | no | audio-editing |
| `transitions` | array of TransitionRecord (§5.1) | 0–2 000 | `[]` | no | transitions |
| `elements` | array of Element (§6–§10) | 0–5 000, sorted by `startTime` then `id` | `[]` | no | timeline-editing |
| `caption` | CaptionTrack (§5.2) | present if and only if `type: "caption"` | absent | no | captions-subtitles |

### 5.1 TransitionRecord (picture transitions and audio crossfades)

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `id` | `Id` | | required | no | transitions |
| `kind` | `"transition" \| "crossfade"` | `transition` on `video` tracks; `crossfade` on `audio` tracks | required | no | transitions |
| `fromElementId` | `Id` | the outgoing element (ends at the cut) | required | no | transitions |
| `toElementId` | `Id` | the incoming element (starts at the cut) | required | no | transitions |
| `duration` | `Ticks` | frame-aligned; `transition`: 0.1–5.0 s and at least 2 frames; `crossfade`: 0.05–10 s and at least 2 frames | 60 000 (0.5 s) | no | transitions / audio-editing |
| `type` | `Id` | `transition` only: a registered transition id | required for `transition` | no | transitions |
| `params` | map string → number, boolean or string | `transition` only: values of the type's definition | `{}` | no | transitions |
| `easing` | `"linear" \| "ease-in" \| "ease-out" \| "ease-in-out"` | `transition` only | `"ease-in-out"` | no | transitions |
| `audioCrossfade` | boolean | `transition` only: pair the clips' source audio | `true` | no | transitions |
| `shape` | `"linear" \| "equal-power" \| "s-curve" \| "logarithmic" \| "exponential"` | `crossfade` records, and the paired crossfade of a `transition` | `"equal-power"` | no | audio-editing |

### 5.2 CaptionTrack

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `caption.language` | `Lang` | | `"und"` | no | captions-subtitles |
| `caption.translationLanguage` | `Lang` | | absent | no | captions-subtitles |
| `caption.sourceId` | `Id` | the caption source it was generated from | absent | no | captions-subtitles |
| `caption.mode` | `"speech" \| "lyrics"` | | `"speech"` | no | captions-subtitles |
| `caption.burnIn` | boolean | | `true` | no | captions-subtitles |
| `caption.showSpeakerLabels` | boolean | | `false` | no | captions-subtitles |
| `caption.styleId` | `Id` | the catalogue or saved style it was created from | absent | no | captions-subtitles |
| `caption.style` | TextStyle (§10.4, without `tracking` and `bubble`) | track style; defaults are the caption style `classic` | required | no | captions-subtitles |
| `caption.layout.anchor` | `"top" \| "middle" \| "bottom"` | | `"bottom"` | no | captions-subtitles |
| `caption.layout.marginY` | `Percent` | 0–50 % of canvas height, step 0.5 | 5 | no | captions-subtitles |
| `caption.layout.maxWidth` | `Percent` | 20–100 % of canvas width, step 1 | 80 | no | captions-subtitles |
| `caption.layout.offset` | `Vec2` | canvas px moved by "Apply to all" drags | `{0, 0}` | no | captions-subtitles |
| `caption.layout.scale` | number | 0.01–100 | 1 | no | captions-subtitles |
| `caption.highlight.style` | `"none" \| "color" \| "background" \| "scale" \| "underline" \| "karaoke" \| "reveal"` | | `"none"` | no | captions-subtitles |
| `caption.highlight.color` | `Color` | | `#ffd400` | no | captions-subtitles |
| `caption.highlight.textColor` | `Color` | | `#000000` | no | captions-subtitles |
| `caption.highlight.scale` | number | 1.0–2.0 | 1.2 | no | captions-subtitles |
| `caption.bilingual.visible` | boolean | | `true` | no | captions-subtitles |
| `caption.bilingual.order` | `"below" \| "above"` | position of the translation | `"below"` | no | captions-subtitles |
| `caption.bilingual.scale` | `Percent` | 50–150 % of the primary font size | 80 | no | captions-subtitles |
| `caption.bilingual.color` | `Color` | | absent (same as primary) | no | captions-subtitles |

## 6. Element — common fields

Present on every element type.

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `id` | `Id` | unique in the document | required | no | timeline-editing |
| `type` | `"video" \| "image" \| "audio" \| "text" \| "caption" \| "sticker" \| "graphic" \| "effect" \| "adjustment" \| "compound"` | | required | no | timeline-editing |
| `name` | `Text(200)` | 1–200 characters | required | no | timeline-editing |
| `startTime` | `Ticks` | frame-aligned | required | no | timeline-editing |
| `duration` | `Ticks` | frame-aligned, at least 1 frame, at most 2 592 000 000 (6 h) | required | no | timeline-editing |
| `trimStart` | `Ticks` | source time skipped at the head | 0 | no | timeline-editing |
| `trimEnd` | `Ticks` | source time skipped at the tail | 0 | no | timeline-editing |
| `sourceDuration` | `Ticks` | video, audio, compound; duration of the source | absent | no | timeline-editing |
| `hidden` | boolean | every type except `audio` | `false` | no | timeline-editing |
| `groupId` | `Id` or `null` | shared by ≥ 2 elements of one scene | `null` | no | timeline-editing |
| `linkId` | `Id` or `null` | shared by exactly 2 elements of one scene | `null` | no | timeline-editing |
| `transitionIn` | `Id` or `null` | a TransitionRecord of the same track whose `toElementId` is this element | `null` | no | transitions |
| `transitionOut` | `Id` or `null` | a TransitionRecord of the same track whose `fromElementId` is this element | `null` | no | transitions |
| `filmLink` | `{filmId, episodeId, panelId?, lineId?, cueId?, assetVersionId}` (all `Id`) | | absent | no | film-production |
| `workflowLink` | `{runId, stepId, shotId?, artifactVersionId}` (all `Id`) | | absent | no | agent-workflows |
| `scriptLink` | `{scriptId, sceneId, shotId?, lineId?, versionId}` (all `Id`) plus `syncedHash: Sha256` | | absent | no | script-studio |
| `animations` | AnimationStore (§11) | map path → channel | absent | no | keyframe-animation |
| `timingAnchor` | `{elementId: Id, edge: "start" \| "end", offsetTicks: integer}` | the start follows that element's edge plus the offset (± 2 592 000 000); no cycles | absent | no | timeline-editing |

## 7. Element — visual fields

Applicability per element type is in §10.1.

### 7.1 Transform, opacity, blend, crop, flip

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `transform.position.x` | number | canvas px from the canvas centre, + right; −100 000…100 000, step 1 | 0 | yes | preview-canvas |
| `transform.position.y` | number | canvas px, + down; −100 000…100 000, step 1 | 0 | yes | preview-canvas |
| `transform.scale.x` | number | multiplier of the fitted size; 0.01–100, step 0.01 (the static value is always positive; a keyframe value of −100…−0.01 is valid on a channel migrated from classic) | 1 | yes | preview-canvas |
| `transform.scale.y` | number | 0.01–100, step 0.01 | 1 | yes | preview-canvas |
| `transform.rotation` | `Degrees` | clockwise; −3600…3600, step 0.1 | 0 | yes | preview-canvas |
| `opacity` | `Fraction` | 0–1, step 0.01 (displayed 0–100 %) | 1 | yes | masks-blending-keying |
| `blendMode` | `"normal" \| "darken" \| "multiply" \| "color-burn" \| "lighten" \| "screen" \| "plus-lighter" \| "color-dodge" \| "overlay" \| "soft-light" \| "hard-light" \| "difference" \| "exclusion" \| "hue" \| "saturation" \| "color" \| "luminosity"` | 17 modes | `"normal"` | no | masks-blending-keying |
| `crop.left` | `Fraction` | fraction of the source; 0–0.99, step 0.001 | 0 | yes | preview-canvas |
| `crop.top` | `Fraction` | 0–0.99 | 0 | yes | preview-canvas |
| `crop.right` | `Fraction` | 0–0.99; `left + right ≤ 0.99` | 0 | yes | preview-canvas |
| `crop.bottom` | `Fraction` | 0–0.99; `top + bottom ≤ 0.99` | 0 | yes | preview-canvas |
| `flip.horizontal` | boolean | | `false` | no | preview-canvas |
| `flip.vertical` | boolean | | `false` | no | preview-canvas |

### 7.2 Motion blur and clip animation

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `motionBlur.enabled` | boolean | | `false` | no | visual-effects-filters |
| `motionBlur.strength` | `Percent` | 0–100, step 1 (shutter = strength / 100 × 1 frame) | 50 | yes | visual-effects-filters |
| `motionBlur.samples` | `4 \| 8 \| 16` | | 8 | no | visual-effects-filters |
| `clipAnimation.in` | ClipAnimationSlot | exclusive with `combo` | absent | no | keyframe-animation |
| `clipAnimation.out` | ClipAnimationSlot | exclusive with `combo` | absent | no | keyframe-animation |
| `clipAnimation.combo` | ClipAnimationSlot | exclusive with `in` and `out` | absent | no | keyframe-animation |
| ClipAnimationSlot `.type` | `Id` | a registered clip animation id | required | no | keyframe-animation |
| ClipAnimationSlot `.duration` | `Ticks` | frame-aligned; in/out 0.1 s … min(5 s, element duration), `in + out ≤ duration`; combo 0.1 s … element duration | 60 000 (in/out) | no | keyframe-animation |
| ClipAnimationSlot `.strength` | `Percent` | 0–100, step 1 | 100 | no | keyframe-animation |
| ClipAnimationSlot `.followsDuration` | boolean | `combo` only: duration tracks the element duration | `true` | no | keyframe-animation |

### 7.3 Effects entries (`effects[]`)

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `effects` | array of EffectEntry | 0–16; at most 1 entry of `kind: "filter"` | `[]` | no | visual-effects-filters |
| `effects[].id` | `Id` | | required | no | visual-effects-filters |
| `effects[].type` | `Id` | a registered effect or filter definition id | required | no | visual-effects-filters |
| `effects[].kind` | `"effect" \| "filter"` | | required | no | visual-effects-filters |
| `effects[].enabled` | boolean | | `true` | no | visual-effects-filters |
| `effects[].params` | map string → number, boolean or string | keys and ranges of the definition (`visual-effects-filters/catalog.md`) | definition defaults | yes (`effects.<id>.params.<key>`) | visual-effects-filters |

### 7.4 Per-clip canvas background

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `background` (video, image, compound) | Background (§3.2) | rendered only while the element is on the main track | absent (= project default) | no | timeline-editing |

On a `text` element the key `background` is the text background object of §10.4. The two never coexist because a
text element is never a video, image or compound element.

### 7.5 Masks (`masks[]`)

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `masks` | array of Mask | 0–8, array order is combine order | `[]` | no | masks-blending-keying |
| `masks[].id` | `Id` | | required | no | masks-blending-keying |
| `masks[].type` | `"split" \| "mirror" \| "cinematic-bars" \| "rectangle" \| "ellipse" \| "heart" \| "diamond" \| "star" \| "text" \| "freeform"` | | required | no | masks-blending-keying |
| `masks[].enabled` | boolean | | `true` | no | masks-blending-keying |
| `masks[].combine` | `"add" \| "subtract" \| "intersect" \| "exclude"` | | `"add"` | no | masks-blending-keying |
| `masks[].tracking` | MaskTracking | | absent | no | masks-blending-keying |
| `masks[].tracking.trackId` | `Id` | a motion track of the element's own asset (§12.2) | required | no | ai-editing-tools |
| `masks[].tracking.followPosition` | boolean | | `true` | no | masks-blending-keying |
| `masks[].tracking.followScale` | boolean | | `true` | no | masks-blending-keying |
| `masks[].tracking.followRotation` | boolean | | `true` | no | masks-blending-keying |
| `masks[].tracking.offset` | `Vec2` | mask centre offset from the tracked point, in `centerX` / `centerY` units | `{0, 0}` | no | masks-blending-keying |
| `masks[].params.feather` | number | 0–1000, step 1 (displayed ÷ 10 as %) | 0 | yes | masks-blending-keying |
| `masks[].params.inverted` | boolean | | `false` | no | masks-blending-keying |
| `masks[].params.opacity` | `Percent` | 0–100, step 1 | 100 | yes | masks-blending-keying |
| `masks[].params.strokeWidth` | number | reference-canvas px, 0–100, step 1 | 0 | yes | masks-blending-keying |
| `masks[].params.strokeColor` | `Color` | | `#ffffff` | yes | masks-blending-keying |
| `masks[].params.strokeAlign` | `"inside" \| "center" \| "outside"` | box-like masks | `"center"` | no | masks-blending-keying |
| `masks[].params.centerX` | number | fraction of the element width from its centre, −1…1 (displayed × 100 as −100…100 %); every type | 0 | yes | masks-blending-keying |
| `masks[].params.centerY` | number | fraction of the element height from its centre, −1…1 | 0 | yes | masks-blending-keying |
| `masks[].params.rotation` | `Degrees` | 0–360, step 1; every type | 0 | yes | masks-blending-keying |
| `masks[].params.width` | number | fraction of the element's short side, ≥ 0.01; rectangle, ellipse, heart, diamond, star, cinematic-bars | 0.6 | yes | masks-blending-keying |
| `masks[].params.height` | number | ≥ 0.01; same types | 0.6 | yes | masks-blending-keying |
| `masks[].params.scale` | number | 0.01–5 (displayed 1–500 %); every type except split and mirror | 1 | yes | masks-blending-keying |
| `masks[].params.cornerRadius` | `Percent` | rectangle; 0–100 | 0 | yes | masks-blending-keying |
| `masks[].params.points` | integer | star; 3–12 | 5 | no | masks-blending-keying |
| `masks[].params.innerRatio` | number | star; 0.1–0.95, step 0.01 | 0.45 | yes | masks-blending-keying |
| `masks[].params.size` | number | mirror; band thickness, 0.01–5 | 0.4 | yes | masks-blending-keying |
| `masks[].params.content` | `Text(2000)` | text mask | `"Mask"` | no | masks-blending-keying |
| `masks[].params.fontFamily` | string | text mask | the default family of §10.3 | no | masks-blending-keying |
| `masks[].params.fontSize` | number | text mask; 5–300 % of the element's short side | 15 | yes | masks-blending-keying |
| `masks[].params.fontWeight` | `"normal" \| "bold"` | text mask | `"normal"` | no | masks-blending-keying |
| `masks[].params.fontStyle` | `"normal" \| "italic"` | text mask | `"normal"` | no | masks-blending-keying |
| `masks[].params.textDecoration` | `"none" \| "underline" \| "line-through"` | text mask | `"none"` | no | masks-blending-keying |
| `masks[].params.letterSpacing` | number | text mask; −100…500, thousandths of an em | 0 | yes | masks-blending-keying |
| `masks[].params.lineHeight` | number | text mask; 0.1–10 | 1.2 | yes | masks-blending-keying |
| `masks[].params.closed` | boolean | freeform | `false` | no | masks-blending-keying |
| `masks[].params.path` | array of PathPoint | freeform; 0–256 points; unique point `id` | `[]` | yes (path channel) | masks-blending-keying |
| PathPoint `.id` | `Id` | unique within the mask | required | no | masks-blending-keying |
| PathPoint `.x`, `.y` | number | anchor, in the mask's local space (element short side = 1, origin at the mask centre) | required | no | masks-blending-keying |
| PathPoint `.inX`, `.inY` | number | incoming tangent handle, relative to the anchor | 0 | no | masks-blending-keying |
| PathPoint `.outX`, `.outY` | number | outgoing tangent handle, relative to the anchor | 0 | no | masks-blending-keying |

### 7.6 Chroma key and cutout

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `chromaKey.enabled` | boolean | | `false` | no | masks-blending-keying |
| `chromaKey.color` | `ColorRgb` | | `#00ff00` | no | masks-blending-keying |
| `chromaKey.strength` | `Percent` | 0–100 | 40 | yes | masks-blending-keying |
| `chromaKey.edge` | `Percent` | 0–100 | 10 | yes | masks-blending-keying |
| `chromaKey.shadow` | `Percent` | 0–100 | 0 | yes | masks-blending-keying |
| `chromaKey.spill` | `Percent` | 0–100 | 50 | yes | masks-blending-keying |
| `cutout.mode` | `"none" \| "auto" \| "custom"` | | `"none"` | no | masks-blending-keying |
| `cutout.matteAssetId` | `Id` | a derived asset of role `matte` (§12.3) | absent | no | ai-editing-tools |
| `cutout.disabled_ms` | `Ms` | present only while `mode` is `none` and `matteAssetId` is kept: when the cutout was turned off; the matte asset and both keys are removed 30 days after it | absent | no | masks-blending-keying |
| `cutout.inverted` | boolean | | `false` | no | masks-blending-keying |
| `cutout.feather` | integer | reference-canvas px, 0–100 | 2 | no | masks-blending-keying |
| `cutout.shift` | integer | reference-canvas px, −50…+50 | 0 | no | masks-blending-keying |
| `cutout.stroke.style` | `"none" \| "solid" \| "dashed" \| "glow" \| "offset-shadow"` | | `"none"` | no | masks-blending-keying |
| `cutout.stroke.width` | number | reference-canvas px, 0–100 | 8 | yes | masks-blending-keying |
| `cutout.stroke.color` | `Color` | | `#ffffff` | yes | masks-blending-keying |
| `cutout.stroke.offset` | number | reference-canvas px, 0–100 | 0 | yes | masks-blending-keying |
| `cutout.stroke.opacity` | `Percent` | 0–100 | 100 | yes | masks-blending-keying |
| `cutout.background.kind` | `"none" \| "color" \| "blur" \| "media"` | | `"none"` | no | masks-blending-keying |
| `cutout.background.color` | `Color` | `kind: "color"` | `#000000` | no | masks-blending-keying |
| `cutout.background.blurIntensity` | `Percent` | `kind: "blur"`; 0–100 | 50 | no | masks-blending-keying |
| `cutout.background.mediaId` | `Id` | `kind: "media"`; an image or video asset | required for `media` | no | masks-blending-keying |

### 7.7 Analysis-driven settings

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `stabilization.enabled` | boolean | | `false` | no | ai-editing-tools |
| `stabilization.level` | `"min-crop" \| "recommended" \| "max-stable"` | | `"recommended"` | no | ai-editing-tools |
| `deflicker.enabled` | boolean | | `false` | no | ai-editing-tools |
| `deflicker.strength` | `Percent` | 0–100 | 50 | no | ai-editing-tools |
| `eyeContact.enabled` | boolean | | `false` | no | ai-editing-tools |
| `eyeContact.strength` | `Percent` | 0–100 | 70 | no | ai-editing-tools |
| `relight.enabled` | boolean | | `false` | no | ai-editing-tools |
| `relight.presetId` | `Id` | one of the six catalogue presets | absent | no | ai-editing-tools |
| `relight.azimuth` | `Degrees` | −180…180 | 0 | yes | ai-editing-tools |
| `relight.elevation` | `Degrees` | −90…90 | 0 | yes | ai-editing-tools |
| `relight.intensity` | `Percent` | 0–100 | 50 | yes | ai-editing-tools |
| `relight.temperature` | integer | kelvin, 2 000–10 000 | 5 500 | yes | ai-editing-tools |
| `relight.ambient` | number | −100…100 | 0 | yes | ai-editing-tools |
| `relight.scope` | `"face" \| "subject" \| "frame"` | | `"subject"` | no | ai-editing-tools |
| `retouch.enabled` | boolean | | `false` | no | ai-editing-tools |
| `retouch.applyToAll` | boolean | `true` = the `all` entry is used for every face | `true` | no | ai-editing-tools |
| `retouch.autoStyle` | `{id: Id, amount: Percent}` | one of the six catalogue auto styles; amount 0–100 | absent | no | ai-editing-tools |
| `retouch.faces` | map `"all"` or face `Id` → FaceSettings | at most 6 keys (`all` + 5 faces) | `{}` | no | ai-editing-tools |
| FaceSettings `.smoothSkin`, `.brightenSkin`, `.darkCircles`, `.smileLines`, `.whitenTeeth`, `.blemishes`, `.brightenEyes` | `Percent` each (7 fields) | 0–100 | 0 | yes | ai-editing-tools |
| FaceSettings `.skinTone` | number | −50 (cool) … +50 (warm) | 0 | yes | ai-editing-tools |
| FaceSettings `.reshape.slimFace`, `.jawWidth`, `.chinLength`, `.cheekbones`, `.foreheadHeight`, `.eyeSize`, `.eyeDistance`, `.noseWidth`, `.noseLength`, `.mouthSize`, `.lipThickness` | number each (11 fields) | −100…100 | 0 | yes | ai-editing-tools |
| FaceSettings `.makeup.look` | `Id` | one of the eight catalogue looks | absent | no | ai-editing-tools |
| FaceSettings `.makeup.intensity` | `Percent` | 0–100 | 60 | no | ai-editing-tools |
| FaceSettings `.makeup.layers` | map `"lipstick" \| "blush" \| "eyeshadow" \| "eyeliner" \| "eyebrow" \| "contour"` → `{color: Color, intensity: Percent}` | 0–6 keys | `{}` | no | ai-editing-tools |
| `retouch.body.slimBody`, `.waist`, `.hips`, `.legLength`, `.legWidth`, `.shoulderWidth`, `.armWidth`, `.headSize`, `.neckLength` | number each (9 fields) | −100…100 | 0 | yes | ai-editing-tools |
| `aiMotion.style` | `"zoom-in" \| "zoom-out" \| "push" \| "shake" \| "soft-sway" \| "dynamic"` | the style last applied by AI movement | absent | no | ai-editing-tools |
| `aiMotion.intensity` | `Percent` | 0–100 | 50 | no | ai-editing-tools |
| `aiMotion.keyIds` | array of `Id` | ids of the keyframes that AI movement wrote; ≤ 5 000 | `[]` | no | ai-editing-tools |
| `autoReframe.aspect` | `Rational` | the target aspect ratio (width / height) last applied by Auto reframe | absent | no | ai-editing-tools |
| `autoReframe.keyIds` | array of `Id` | ids of the keyframes that Auto reframe wrote; ≤ 5 000; a re-run removes exactly these keys before writing new ones; ids of keys the user edited or deleted are removed from the list by that edit | `[]` | no | ai-editing-tools |
| `processedSource.originalMediaId` | `Id` | the asset the element used before a replacing tool ran | absent | no | ai-editing-tools |
| `processedSource.tool` | `"upscale" \| "lipsync" \| "object-removal" \| "restyle" \| "expand"` | | required when present | no | ai-editing-tools |
| `processedSource.sourceStart`, `.sourceEnd` | `Ticks` | the processed source range | absent | no | ai-editing-tools |

### 7.8 Tracking binding (text, sticker, graphic)

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `tracking.targetElementId` | `Id` | a video element of the same scene | required | no | text-and-titles |
| `tracking.trackId` | `Id` | a motion track of the target's asset (§12.2) | required | no | ai-editing-tools |
| `tracking.followPosition` | boolean | | `true` | no | text-and-titles |
| `tracking.followScale` | boolean | text: `false`; sticker and graphic: `true` | per type | no | text-and-titles / stickers-shapes |
| `tracking.followRotation` | boolean | text: `false`; sticker and graphic: `true` | per type | no | text-and-titles / stickers-shapes |
| `tracking.offset` | `Vec2` | canvas px | `{0, 0}` | no | text-and-titles |

### 7.9 Colour adjustments (`adjustments`)

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `adjustments.lut.enabled` | boolean | | `true` | no | color-adjustment |
| `adjustments.lut.lutId` | string | `bundled:<catalogue id>` or `user:<sha256>` (§12.4) | absent | no | color-adjustment |
| `adjustments.lut.intensity` | `Percent` | 0–100, step 1 | 100 | yes | color-adjustment |
| `adjustments.basic.enabled` | boolean | | `true` | no | color-adjustment |
| `adjustments.basic.exposure`, `.brightness`, `.contrast`, `.saturation`, `.vibrance`, `.highlights`, `.shadows`, `.whites`, `.blacks`, `.temperature`, `.tint`, `.clarity`, `.vignette` | integer each (13 fields) | −100…100 | 0 | yes | color-adjustment |
| `adjustments.basic.hue` | integer | degrees, −180…180 | 0 | yes | color-adjustment |
| `adjustments.basic.sharpness`, `.fade`, `.grain` | integer each (3 fields) | 0–100 | 0 | yes | color-adjustment |
| `adjustments.basic.autoStrength` | `Percent` | 0–100; present after Auto adjust | absent | no | color-adjustment |
| `adjustments.wheels.enabled` | boolean | | `true` | no | color-adjustment |
| `adjustments.wheels.<shadows\|midtones\|highlights>.x` | number (3 fields) | −1…1; `x² + y² ≤ 1` | 0 | yes | color-adjustment |
| `adjustments.wheels.<shadows\|midtones\|highlights>.y` | number (3 fields) | −1…1 | 0 | yes | color-adjustment |
| `adjustments.wheels.<shadows\|midtones\|highlights>.luminance` | integer (3 fields) | −100…100 | 0 | yes | color-adjustment |
| `adjustments.curves.enabled` | boolean | | `true` | no | color-adjustment |
| `adjustments.curves.<master\|red\|green\|blue>` | array of `{x: Fraction, y: Fraction}` (4 fields) | 2–16 points, strictly increasing `x` | `[{0,0},{1,1}]` | no | color-adjustment |
| `adjustments.hsl.enabled` | boolean | | `true` | no | color-adjustment |
| `adjustments.hsl.<band>.hue` | integer (8 fields) | band = `red`, `orange`, `yellow`, `green`, `aqua`, `blue`, `purple`, `magenta`; −100…100 | 0 | yes | color-adjustment |
| `adjustments.hsl.<band>.saturation` | integer (8 fields) | −100…100 | 0 | yes | color-adjustment |
| `adjustments.hsl.<band>.lightness` | integer (8 fields) | −100…100 | 0 | yes | color-adjustment |

## 8. Element — time fields

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `retime.rate` | number | 0.1–100, step 0.01 (a migrated classic value 0.01–0.1 is valid as stored); with a curve it is the average rate | 1 | no | speed-retime |
| `retime.maintainPitch` | boolean | | `false` | no | speed-retime |
| `retime.reverse` | boolean | the only place a reversed state is stored | `false` | no | speed-retime |
| `retime.smooth` | `"none" \| "blend" \| "flow"` | | `"none"` | no | speed-retime |
| `retime.curve.preset` | `"custom" \| "montage" \| "hero" \| "bullet" \| "jump-cut" \| "flash-in" \| "flash-out"` | | required when `curve` exists | no | speed-retime |
| `retime.curve.points` | array of `{u: Fraction, rate: number}` | 2–32 points; `u` strictly increasing, first 0, last 1; `rate` 0.1–10 | required when `curve` exists | no | speed-retime |
| `freeze.mediaId` | `Id` | video freeze only: the asset the frame comes from | required on video | no | speed-retime |
| `freeze.sourceTime` | `Ticks` | source time of the held frame | required | no | speed-retime |

## 9. Element — audio fields

Applies to `audio` elements and to `video` and `compound` elements (source audio).

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `volume` | `Db` | −60…+20, −60 = silence | 0 | yes | audio-editing |
| `muted` | boolean | | `false` | no | audio-editing |
| `pan` | integer | −100…+100 | 0 | yes | audio-editing |
| `fadeIn.duration` | `Ticks` | frame-aligned; 0 … element duration; `fadeIn + fadeOut ≤ duration` | 0 | no | audio-editing |
| `fadeIn.shape` | `"linear" \| "equal-power" \| "s-curve" \| "logarithmic" \| "exponential"` | | `"equal-power"` | no | audio-editing |
| `fadeOut.duration` | `Ticks` | as `fadeIn.duration` | 0 | no | audio-editing |
| `fadeOut.shape` | same union as `fadeIn.shape` | | `"equal-power"` | no | audio-editing |
| `isSourceAudioEnabled` | boolean | `video` and `compound` only | `true` | no | audio-editing |
| `isVoice` | boolean | the "Voice" flag read by ducking | `false` | no | audio-editing |
| `noiseReduction.enabled` | boolean | | `false` | no | audio-editing |
| `noiseReduction.strength` | `Percent` | 0–100 | 50 | no | audio-editing |
| `enhanceVoice.enabled` | boolean | | `false` | no | audio-editing |
| `enhanceVoice.strength` | `Percent` | 0–100 | 50 | no | audio-editing |
| `vocalIsolation.mode` | `"off" \| "keep-vocals" \| "remove-vocals"` | | `"off"` | no | audio-editing |
| `vocalIsolation.vocalsAssetId` | `Id` | derived asset of role `stem-vocals` | absent | no | ai-editing-tools |
| `vocalIsolation.accompanimentAssetId` | `Id` | derived asset of role `stem-accompaniment` | absent | no | ai-editing-tools |
| `voiceEffect.type` | `"none" \| "deep" \| "high" \| "chipmunk" \| "giant" \| "robot" \| "echo" \| "hall" \| "telephone" \| "megaphone" \| "vinyl" \| "synth" \| "electronic" \| "tremble" \| "underwater"` | | `"none"` | no | audio-editing |
| `voiceEffect.intensity` | `Percent` | 0–100 | 100 | no | audio-editing |
| `pitch.semitones` | integer | −12…+12 | 0 | no | audio-editing |
| `pitch.cents` | integer | −100…+100 | 0 | no | audio-editing |
| `normalize.enabled` | boolean | | `false` | no | audio-editing |
| `normalize.target` | integer | LUFS, −30…−5 | −14 | no | audio-editing |
| `normalize.gainDb` | `Db` | computed static gain, −60…+24 | 0 | no | audio-editing |
| `normalize.measuredLufs` | number | last measurement | absent | no | audio-editing |
| `eq.enabled` | boolean | | `false` | no | audio-editing |
| `eq.preset` | `"flat" \| "voice-clarity" \| "bass-boost" \| "treble-boost" \| "warm" \| "radio" \| "custom"` | | `"flat"` | no | audio-editing |
| `eq.bands.low`, `.lowMid`, `.mid`, `.highMid`, `.high` | number each (5 fields) | dB, −12…+12, step 0.5 (100 Hz, 300 Hz, 1 kHz, 3 kHz, 10 kHz) | 0 | no | audio-editing |
| `compressor.enabled` | boolean | | `false` | no | audio-editing |
| `compressor.threshold` | number | dB, −60…0 | −18 | no | audio-editing |
| `compressor.ratio` | number | 1–20 | 3 | no | audio-editing |
| `compressor.attack` | integer | ms, 1–200 | 10 | no | audio-editing |
| `compressor.release` | integer | ms, 10–1000 | 120 | no | audio-editing |
| `compressor.makeup` | number | dB, 0–24 | 0 | no | audio-editing |
| `beats` | array of `Ticks` | source time; 0–2 000 entries, strictly increasing | `[]` | no | audio-editing |

## 10. Element types

### 10.1 Field applicability

`●` = the field group exists on the type; blank = the key MUST be absent. Type-specific fields are in §10.2–§10.9.

| Field group | video | image | audio | text | caption | sticker | graphic | effect | adjustment | compound |
|---|---|---|---|---|---|---|---|---|---|---|
| common (§6) | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `hidden` | ● | ● | | ● | ● | ● | ● | ● | ● | ● |
| `sourceDuration` | ● | | ● | | | | | | | ● |
| `transform` | ● | ● | | ● | ● | ● | ● | | | ● |
| `opacity` | ● | ● | | ● | | ● | ● | | ● | ● |
| `blendMode`, `flip` | ● | ● | | ● | | ● | ● | | | ● |
| `crop` | ● | ● | | | | | | | | ● |
| `background` as canvas background (§7.4) | ● | ● | | | | | | | | ● |
| `effects[]` | ● (≤ 16) | ● (≤ 16) | | ● (≤ 16) | | ● (≤ 16) | ● (≤ 16) | ● (exactly 1) | ● (≤ 1, `filter` only) | ● (≤ 16) |
| `masks[]` | ● | ● | | | | ● | ● | | ● | ● |
| `adjustments` | ● | ● | | | | ● | ● | | ● | ● |
| `chromaKey`, `cutout` | ● | ● | | | | | | | | |
| `stabilization`, `deflicker` | ● | | | | | | | | | |
| `retouch`, `relight`, `eyeContact`, `aiMotion`, `processedSource` | ● | ● | | | | | | | | |
| `motionBlur` | ● | ● | | ● | | ● | ● | | | ● |
| `clipAnimation` | ● | ● | | | | ● | ● | | | ● |
| `tracking` (§7.8) | | | | ● | | ● | ● | | | |
| `retime` | ● | | ● | | | | | | | ● (`rate`, `reverse` only) |
| `freeze` | ● | | | | | | | | | ● (`sourceTime` only) |
| audio fields (§9) | ● | | ● | | | | | | | ● |
| `transitionIn`, `transitionOut` | ● | ● | ● (crossfade) | | | | | | | ● |

### 10.2 Video, image, compound, effect, adjustment — type fields

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `mediaId` (video) | `Id` | a `video` asset; absent only on an unfilled template slot | required | no | media-library |
| `mediaId` (image) | `Id` | an `image` asset (including `kind: "slate"`); absent only on an unfilled template slot | required | no | media-library |
| `sceneId` (compound) | `Id` | a scene of `kind` `compound` or `multicam` | required | no | timeline-editing |
| `multicam.angleId` (compound) | `Id` | the active angle of this clip; present if and only if the referenced scene has `kind: "multicam"` | required for multicam | no | timeline-editing |
| `target` (effect) | `"beneath"` | constant at schema 32: the entry applies to the composite of every layer beneath | `"beneath"` | no | visual-effects-filters |

### 10.3 Audio — type fields

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `sourceType` | `"upload" \| "library" \| "bundled"` | `upload`: imported, recorded, extracted or generated; `library`: an online sound stored in the project; `bundled`: a sound of the bundled pack stored in the project | required | no | audio-editing |
| `mediaId` | `Id` | an `audio` or `video` asset (a `video` asset for extracted audio) | required | no | media-library |
| `sourceUrl` | `Text(2000)` | legacy classic value for `library`; never read for playback | absent | no | audio-editing |

### 10.4 Text — type fields and TextStyle

TextStyle is every row below except `content`. A text element stores these keys at the element's top level.

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `content` | `Text(10000)` | | `"Default text"` | no | text-and-titles |
| `fontFamily` | string | 1–200 characters | `"Arial"` | no | text-and-titles |
| `fontSize` | number | 1–500, step 0.1 (rendered px = `fontSize × canvasHeight / 90`) | 15 | yes | text-and-titles |
| `fontWeight` | `100 \| 200 \| 300 \| 400 \| 500 \| 600 \| 700 \| 800 \| 900` | | 400 | no | text-and-titles |
| `fontStyle` | `"normal" \| "italic"` | | `"normal"` | no | text-and-titles |
| `underline` | boolean | | `false` | no | text-and-titles |
| `strikethrough` | boolean | | `false` | no | text-and-titles |
| `textCase` | `"none" \| "upper" \| "lower" \| "title"` | | `"none"` | no | text-and-titles |
| `color` | `Color` | fill colour (first gradient stop) | `#ffffff` | yes | text-and-titles |
| `fill.type` | `"solid" \| "gradient"` | | `"solid"` | no | text-and-titles |
| `fill.gradientColor` | `Color` | second stop | `#ffd400` | yes | text-and-titles |
| `fill.gradientAngle` | `Degrees` | 0–360, step 1 | 90 | yes | text-and-titles |
| `textAlign` | `"left" \| "center" \| "right" \| "justify"` | | `"center"` | no | text-and-titles |
| `letterSpacing` | number | −100…500, step 0.1 | 0 | yes | text-and-titles |
| `lineHeight` | number | 0.1–10, step 0.1 | 1.2 | yes | text-and-titles |
| `box.mode` | `"auto" \| "fixed"` | | `"auto"` | no | text-and-titles |
| `box.width` | `Percent` | 5–400 % of canvas width, step 0.1 | 80 | yes | text-and-titles |
| `curve` | `Degrees` | −360…360, step 1 | 0 | yes | text-and-titles |
| `background.enabled` | boolean | | `false` | no | text-and-titles |
| `background.color` | `Color` | | `#000000` | yes | text-and-titles |
| `background.cornerRadius` | number | 0–100, step 1 | 0 | yes | text-and-titles |
| `background.paddingX` | number | 0–1000, step 1 | 30 | yes | text-and-titles |
| `background.paddingY` | number | 0–1000, step 1 | 42 | yes | text-and-titles |
| `background.offsetX` | number | −100 000…100 000, step 1 | 0 | yes | text-and-titles |
| `background.offsetY` | number | −100 000…100 000, step 1 | 0 | yes | text-and-titles |
| `stroke.enabled` | boolean | | `false` | no | text-and-titles |
| `stroke.color` | `Color` | | `#000000` | yes | text-and-titles |
| `stroke.width` | number | 0–50 % of the rendered font size, step 0.5 | 6 | yes | text-and-titles |
| `stroke.position` | `"outside" \| "center"` | | `"outside"` | no | text-and-titles |
| `shadow.enabled` | boolean | | `false` | no | text-and-titles |
| `shadow.color` | `Color` | | `#000000` | yes | text-and-titles |
| `shadow.opacity` | `Percent` | 0–100 | 80 | yes | text-and-titles |
| `shadow.blur` | `Percent` | 0–100 % of the rendered font size | 10 | yes | text-and-titles |
| `shadow.distance` | `Percent` | 0–100 % of the rendered font size | 5 | yes | text-and-titles |
| `shadow.angle` | `Degrees` | −180…180 | −45 | yes | text-and-titles |
| `glow.enabled` | boolean | | `false` | no | text-and-titles |
| `glow.color` | `Color` | | `#ffffff` | yes | text-and-titles |
| `glow.intensity` | `Percent` | 0–100 | 50 | yes | text-and-titles |
| `glow.radius` | `Percent` | 0–100 % of the rendered font size | 20 | yes | text-and-titles |
| `bubble.id` | `Id` | a catalogue bubble; an absent `bubble` object means none | absent | no | text-and-titles |
| `bubble.color` | `Color` | | per catalogue | yes | text-and-titles |
| `bubble.strokeColor` | `Color` | | per catalogue | no | text-and-titles |
| `bubble.strokeWidth` | number | 0–20, step 0.5 | per catalogue | no | text-and-titles |
| `bubble.flipHorizontal` | boolean | | `false` | no | text-and-titles |
| `textAnimation.in` | `{id: Id, duration: Ticks, strength: Percent}` | duration 0.1 s … element duration; `in + out ≤ duration` | absent | no | text-and-titles |
| `textAnimation.out` | `{id: Id, duration: Ticks, strength: Percent}` | as `in` | absent | no | text-and-titles |
| `textAnimation.loop` | `{id: Id, period: Ticks, strength: Percent}` | period 0.2–5 s | absent | no | text-and-titles |
| `stylePresetId` | `Id` | the text effect preset last applied (display only) | absent | no | text-and-titles |

### 10.5 Caption — type fields

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `text` | `Text(500)` | | `""` | no | captions-subtitles |
| `words` | array of `{text: Text(100), start: Ticks, end: Ticks}` | 0–200; times relative to the element start, ordered, non-overlapping, inside `[0, duration]` | absent | no | captions-subtitles |
| `translation` | `Text(500)` | | absent | no | captions-subtitles |
| `speaker` | `Text(80)` | | absent | no | captions-subtitles |
| `edited` | boolean | `true` once a user or tool edit changed `text`, `translation` or `words` after generation; read by Regroup and re-translate to ask before discarding | `false` | no | captions-subtitles |
| `style` | partial TextStyle (§10.4, without `tracking` and `bubble`) | per-caption overrides of the track style | absent | no | captions-subtitles |
| `transform` | `{position: Vec2, scale: Vec2, rotation: Degrees}` | per-caption placement override; absent = the track layout | absent | no | captions-subtitles |

### 10.6 Sticker — type fields

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `stickerId` | string | `provider:value`, both parts non-empty, 3–200 characters | required | no | stickers-shapes |
| `intrinsicWidth` | number | px, > 0 | 200 | no | stickers-shapes |
| `intrinsicHeight` | number | px, > 0 | 200 | no | stickers-shapes |
| `loop` | boolean | animated stickers | `true` | no | stickers-shapes |
| `playbackSpeed` | number | 0.1–4, step 0.1 | 1 | no | stickers-shapes |

### 10.7 Graphic — type fields

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `definitionId` | `"rectangle" \| "ellipse" \| "polygon" \| "star" \| "arrow" \| "line" \| "drawing"` | | required | no | stickers-shapes |
| `params` | map string → number, boolean or string | the definition's keys of §10.8 only | definition defaults | yes (`params.<key>`) | stickers-shapes |
| `intrinsicWidth` | number | `drawing` only: bounding-box width in px | required for `drawing` | no | stickers-shapes |
| `intrinsicHeight` | number | `drawing` only | required for `drawing` | no | stickers-shapes |
| `strokes` | array of Stroke (§10.9) | `drawing` only; 1–2 000 strokes, ≤ 200 000 points in total | required for `drawing` | no | stickers-shapes |

### 10.8 Graphic `params` keys per definition

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `params.fill` | `Color` | rectangle, ellipse, polygon, star, arrow | `#ffffff` | yes | stickers-shapes |
| `params.stroke` | `Color` | every shape except `drawing` | `#000000` (line: `#ffffff`) | yes | stickers-shapes |
| `params.strokeWidth` | number | 0–64 (line: 1–64), step 1 | 0 (line: 8) | yes | stickers-shapes |
| `params.strokeAlign` | `"inside" \| "center" \| "outside"` | rectangle, ellipse, polygon, star, arrow | `"center"` | no | stickers-shapes |
| `params.cornerRadius` | number | rectangle, polygon; 0–50 | 0 | yes | stickers-shapes |
| `params.sides` | integer | polygon; 3–12 | 5 | yes | stickers-shapes |
| `params.points` | integer | star; 3–12 | 5 | yes | stickers-shapes |
| `params.depth` | number | star; 1–99 | 45 | yes | stickers-shapes |
| `params.lineCap` | `"butt" \| "round" \| "square"` | line | `"round"` | no | stickers-shapes |
| `params.dash` | number | line; 0–200 | 0 | yes | stickers-shapes |
| `params.headSize` | number | arrow; 10–90 | 40 | yes | stickers-shapes |
| `params.shaftWidth` | number | arrow; 5–90 | 30 | yes | stickers-shapes |
| `params.doubleHeaded` | boolean | arrow | `false` | no | stickers-shapes |
| `params.colorOverride` | `Color` or `""` | drawing; `""` = each stroke keeps its own colour | `""` | yes | stickers-shapes |

### 10.9 Stroke (freehand drawing geometry)

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `strokes[].id` | `Id` | unique within the element | required | no | stickers-shapes |
| `strokes[].points` | array of `[x, y]` number pairs | element-local px relative to the centre of the bounding box; 2–10 000 pairs; values rounded to 0.01 | required | no | stickers-shapes |
| `strokes[].width` | number | px, 1–200 | 12 | no | stickers-shapes |
| `strokes[].color` | `Color` | | `#ffffff` | no | stickers-shapes |
| `strokes[].brush` | `"pen" \| "marker"` | marker composites at 50 % as one group per stroke | `"pen"` | no | stickers-shapes |

## 11. Animation store

`animations` is a map from a property path to a channel. A path is the dotted path of the stored field, relative to
the element; a segment that follows `effects`, `masks` or `retouch.faces` is the entry's `id` (or the literal `all`
for faces), never an array index.

### 11.1 Channel and key shapes

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| ScalarChannel `.keys` | array of ScalarKey | 1–1 000, sorted by `time`, one key per tick | required | no | keyframe-animation |
| ScalarChannel `.extrapolation.before` | `"hold" \| "linear"` | | `"hold"` | no | keyframe-animation |
| ScalarChannel `.extrapolation.after` | `"hold" \| "linear"` | | `"hold"` | no | keyframe-animation |
| ScalarKey `.id` | `Id` | unique within the element | required | no | keyframe-animation |
| ScalarKey `.time` | `Ticks` | relative to the element start; frame-aligned; 0 … element duration | required | no | keyframe-animation |
| ScalarKey `.value` | number | within the field's range | required | no | keyframe-animation |
| ScalarKey `.segmentToNext` | `"step" \| "linear" \| "bezier"` | `step` is shown to users and tools as "hold" | `"linear"` | no | keyframe-animation |
| ScalarKey `.tangentMode` | `"auto" \| "aligned" \| "broken" \| "flat"` | | `"auto"` | no | keyframe-animation |
| ScalarKey `.leftHandle` | `{dt: integer, dv: number}` | `dt` in ticks, ≤ 0; offset from the key | absent | no | keyframe-animation |
| ScalarKey `.rightHandle` | `{dt: integer, dv: number}` | `dt` in ticks, ≥ 0 | absent | no | keyframe-animation |
| DiscreteChannel `.keys` | array of `{id: Id, time: Ticks, value: boolean \| string}` | 1–1 000; always held until the next key | required | no | keyframe-animation |
| ColorChannel `.r`, `.g`, `.b`, `.a` | ScalarChannel each (4 fields) | linear-light components 0–1; the four channels have identical key times and ids | required | no | keyframe-animation |
| PathChannel `.keys` | array of PathKey | 1–1 000, sorted by `time` | required | no | keyframe-animation |
| PathKey `.id` | `Id` | | required | no | keyframe-animation |
| PathKey `.time` | `Ticks` | as ScalarKey `.time` | required | no | keyframe-animation |
| PathKey `.value.points` | array of PathPoint (§7.5) | the same point ids as `masks[].params.path` | required | no | masks-blending-keying |
| PathKey `.segmentToNext` | `"step" \| "linear" \| "bezier"` | | `"linear"` | no | keyframe-animation |
| PathKey `.easing` | `[x1, y1, x2, y2]` numbers | normalised cubic bezier; `x1`, `x2` in 0–1; used when `segmentToNext: "bezier"` | `[0.25, 0.1, 0.25, 1]` | no | keyframe-animation |

### 11.2 Animatable property paths (complete list, lane order)

A path outside this table is not animatable at schema 32. "Channel" is the channel shape of §11.1.

| Group | Path | Channel | Element types | Owner |
|---|---|---|---|---|
| 1 | `transform.position.x`, `transform.position.y` | Scalar | video, image, text, sticker, graphic, compound | preview-canvas |
| 1 | `transform.scale.x`, `transform.scale.y` (presented as the grouped property `transform.scale`) | Scalar | video, image, text, sticker, graphic, compound | preview-canvas |
| 1 | `transform.rotation` | Scalar | video, image, text, sticker, graphic, compound | preview-canvas |
| 1 | `opacity` | Scalar | video, image, text, sticker, graphic, compound, adjustment | masks-blending-keying |
| 2 | `volume`, `pan` | Scalar | audio, video, compound | audio-editing |
| 3 | `color`, `fill.gradientColor` | Color | text | text-and-titles |
| 3 | `fontSize`, `letterSpacing`, `lineHeight`, `fill.gradientAngle`, `box.width`, `curve` | Scalar | text | text-and-titles |
| 3 | `background.color` | Color | text | text-and-titles |
| 3 | `background.cornerRadius`, `background.paddingX`, `background.paddingY`, `background.offsetX`, `background.offsetY` | Scalar | text | text-and-titles |
| 3 | `stroke.color`, `shadow.color`, `glow.color`, `bubble.color` | Color | text | text-and-titles |
| 3 | `stroke.width`, `shadow.opacity`, `shadow.blur`, `shadow.distance`, `shadow.angle`, `glow.intensity`, `glow.radius` | Scalar | text | text-and-titles |
| 4 | `params.<key>` for the numeric keys of §10.8 | Scalar | graphic | stickers-shapes |
| 4 | `params.fill`, `params.stroke`, `params.colorOverride` | Color | graphic | stickers-shapes |
| 5 | `effects.<effectId>.params.<key>` for keys the definition marks keyframable | Scalar, Color or Discrete per the definition | every element with `effects[]`, including `effect` and `adjustment` elements | visual-effects-filters |
| 5 | `motionBlur.strength` | Scalar | video, image, text, sticker, graphic, compound | visual-effects-filters |
| 6 | `masks.<maskId>.params.<key>` for `feather`, `opacity`, `strokeWidth`, `centerX`, `centerY`, `rotation`, `width`, `height`, `scale`, `cornerRadius`, `innerRatio`, `size`, `fontSize`, `letterSpacing`, `lineHeight` | Scalar | maskable elements | masks-blending-keying |
| 6 | `masks.<maskId>.params.strokeColor` | Color | maskable elements | masks-blending-keying |
| 6 | `masks.<maskId>.params.path` | Path | maskable elements with a freeform mask | masks-blending-keying |
| 7 | `adjustments.basic.<key>` for the 17 basic keys | Scalar | adjustable elements | color-adjustment |
| 7 | `adjustments.hsl.<band>.<hue\|saturation\|lightness>` | Scalar | adjustable elements | color-adjustment |
| 7 | `adjustments.wheels.<shadows\|midtones\|highlights>.<x\|y\|luminance>` | Scalar | adjustable elements | color-adjustment |
| 7 | `adjustments.lut.intensity` | Scalar | adjustable elements | color-adjustment |
| 8 | `chromaKey.strength`, `chromaKey.edge`, `chromaKey.shadow`, `chromaKey.spill` | Scalar | video, image | masks-blending-keying |
| 8 | `cutout.stroke.width`, `cutout.stroke.offset`, `cutout.stroke.opacity` | Scalar | video, image | masks-blending-keying |
| 8 | `cutout.stroke.color` | Color | video, image | masks-blending-keying |
| 8 | `crop.left`, `crop.top`, `crop.right`, `crop.bottom` | Scalar | video, image, compound | preview-canvas |
| 9 | `retouch.faces.<faceKey>.<key>` for the 8 face keys | Scalar | video, image | ai-editing-tools |
| 9 | `retouch.faces.<faceKey>.reshape.<key>` for the 11 reshape keys | Scalar | video, image | ai-editing-tools |
| 9 | `retouch.body.<key>` for the 9 body keys | Scalar | video, image | ai-editing-tools |
| 9 | `relight.azimuth`, `relight.elevation`, `relight.intensity`, `relight.temperature`, `relight.ambient` | Scalar | video, image | ai-editing-tools |

## 12. Media section

### 12.1 MediaSection

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `media.assets` | array of AssetRecord (§12.2) | 0–10 000, sorted by `id` | `[]` | no | media-library |
| `media.folders` | array of `{id: Id, name: Text(80), parentId: Id or null, kind: "user" \| "ai-generated" \| "slates"}` | 0–2 000; nesting ≤ 4 levels; sibling names unique case-insensitively; at most one folder of each automatic kind | `[]` | no | media-library |
| `media.luts` | array of LutRecord (§12.4) | 0–500 | `[]` | no | color-adjustment |

### 12.2 AssetRecord (synced part)

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `id` | `Id` | | required | no | media-library |
| `name` | `Text(255)` | 1–255 characters | required | no | media-library |
| `type` | `"image" \| "video" \| "audio"` | | required | no | media-library |
| `kind` | `null \| "slate" \| "derived"` | `slate`: placeholder still; `derived`: a tool output hidden from the library | `null` | no | media-library |
| `size` | integer | bytes of the original, 0 … 2^53 − 1 | required | no | media-library |
| `lastModified_ms` | `Ms` | of the imported file | absent | no | media-library |
| `contentHash` | `Sha256` or `null` | `null` until the first hash completes | `null` | no | media-library |
| `width`, `height` | integer each (2 fields) | px after rotation | absent | no | media-library |
| `duration` | `Ticks` | video and audio | absent | no | media-library |
| `fps` | `Rational` | video | absent | no | media-library |
| `hasAudio` | boolean | video; absent = unknown, treated as having audio | absent | no | media-library |
| `videoCodec`, `audioCodec`, `container` | string each (3 fields) | ≤ 40 characters | absent | no | media-library |
| `rotation` | `0 \| 90 \| 180 \| 270` | | 0 | no | media-library |
| `folderId` | `Id` or `null` | a folder of `media.folders` | `null` | no | media-library |
| `tags` | array of `Text(40)` | 0–50, unique | `[]` | no | media-library |
| `ephemeral` | boolean | temporary tool asset, hidden from the library | `false` | no | media-library |
| `provenance` | Provenance (§12.5) | | `{source: "imported"}` | no | media-library |
| `derived.role` | `"matte" \| "stem-vocals" \| "stem-accompaniment"` | `kind: "derived"` only | required for `derived` | no | ai-editing-tools |
| `derived.sourceAssetId` | `Id` | the asset it was computed from | required for `derived` | no | ai-editing-tools |
| `derived.sourceStart`, `derived.sourceEnd` | `Ticks` each (2 fields) | the analysed source range | absent | no | ai-editing-tools |
| `motionTracks` | array of `{id: Id, name: Text(80), shape: "rectangle" \| "ellipse", sourceStart: Ticks, sourceEnd: Ticks, dataHash: Sha256}` | 0–50; video assets | `[]` | no | ai-editing-tools |
| `faces` | array of `{id: Id, firstSeen: Ticks}` | 0–32; video and image assets; the stable face identities that key `retouch.faces`; written by the first face analysis and only appended to afterwards (a rebuilt analysis cache matches detected faces to these entries by position overlap at `firstSeen` and reuses the ids) | `[]` | no | ai-editing-tools |
| `created_ms` | `Ms` | | required | no | media-library |

### 12.3 Derived assets

A derived asset (`kind: "derived"`) is referenced by `cutout.matteAssetId`, `vocalIsolation.vocalsAssetId` or
`vocalIsolation.accompanimentAssetId`. Analysis tracks that are not referenced by id from the document
(stabilisation, deflicker, face mesh, depth, body pose, the person matte used by body effects, optical-flow frames, reverse caches, derived audio, source
transcripts, waveforms, thumbnails, proxies) are caches keyed by content hash and are NOT part of the document.

### 12.4 LutRecord

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `media.luts[].id` | string | `user:<sha256>` | required | no | color-adjustment |
| `media.luts[].name` | `Text(120)` | | required | no | color-adjustment |
| `media.luts[].format` | `"cube" \| "3dl"` | | required | no | color-adjustment |
| `media.luts[].size` | integer | bytes, ≤ 33 554 432 | required | no | color-adjustment |
| `media.luts[].sha256` | `Sha256` | the LUT blob stored with the project | required | no | color-adjustment |

### 12.5 Provenance (union on `source`)

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `provenance.source` | `"imported" \| "recorded" \| "url" \| "stock" \| "ai" \| "bundled" \| "connector" \| "device" \| "slate" \| "derived"` | | required | no | media-library |
| `provenance.originalFileName` | `Text(255)` | `imported`, `connector`, `device` | absent | no | media-library |
| `provenance.url` | `Text(2000)` | `url` | required for `url` | no | media-library |
| `provenance.connector`, `.remoteId` | string each (2 fields) | `connector` | required for `connector` | no | media-library |
| `provenance.deviceId` | `Id` | `device` | required for `device` | no | media-library |
| `provenance.provider`, `.itemId`, `.author`, `.licence`, `.licenceUrl`, `.sourceUrl` | string each (6 fields) | `stock`, `bundled`; also `author`, `licence`, `sourceUrl` on library sounds | required for `stock` | no | media-library |
| `provenance.attributionRequired` | boolean | `stock`, `bundled`, library sounds | `false` | no | media-library |
| `provenance.credit` | Text(1000) | the credit line the source asks for, as it is to be published (a catalogue track, an NCS release) | — | no | audio-editing |
| `provenance.model`, `.role`, `.prompt`, `.negativePrompt`, `.jobId` | string each (5 fields; `prompt` ≤ 20 000 characters) | `ai`; `provider` is shared with the row above | `provider`, `model`, `role`, `jobId` required for `ai` | no | generation-providers |
| `provenance.seed` | integer | `ai` | absent | no | generation-providers |
| `provenance.referenceAssetIds` | array of `Id` | `ai`; ≤ 32 | `[]` | no | generation-providers |
| `provenance.cost` | `{amount: number, currency: string}` | `ai` | absent | no | generation-providers |
| `provenance.created_ms` | `Ms` | `ai` | absent | no | generation-providers |
| `provenance.scriptId`, `.sceneId`, `.shotId`, `.versionId` | `Id` each (4 fields) | `slate` | `scriptId`, `sceneId`, `versionId` required for `slate` | no | script-studio |
| `provenance.tool` | string | `derived`; the tool id that produced it | required for `derived` | no | ai-editing-tools |

## 13. OpenCut classic v31 → schema 32 mapping

This table is what the v31→v32 step of `project-storage.Schema 32 migration` implements. "Source" is the classic
location; where two sources are listed the first one present wins. `P["k"]` means `element.params["k"]`; "top" means
the stale pre-v29 top-level copy on the element.

### 13.1 Project, settings, scene, track

| Classic v31 | Schema 32 | Rule |
|---|---|---|
| (none) | `format` | set to `"jagentchill.project"` |
| `version` | `schemaVersion: 32`, `minReaderSchemaVersion: 32` | `version` kept as a legacy key, never read |
| `metadata.id`, `metadata.name` | same keys | name trimmed and cut to 120 characters; empty → "Untitled project" |
| `metadata.duration` | `metadata.duration` | rounded to an integer tick |
| `metadata.createdAt`, `metadata.updatedAt` (ISO strings) | `metadata.created_ms`, `metadata.updated_ms` | parsed as UTC; unparseable → the migration time; the ISO keys are removed |
| `metadata.thumbnail` (data URL) | thumbnail store; `metadata.thumbnail: null` | decoded and re-encoded per `projects.Project thumbnail` |
| `settings.fps {numerator, denominator}` | `settings.fps` | reduced by the greatest common divisor |
| `settings.canvasSize`, `canvasSizeMode`, `lastCustomCanvasSize`, `originalCanvasSize` | same keys | width and height rounded to the nearest even integer and clamped to 16–7680 |
| `settings.background {type: "color", color}` with a `#` colour | `{kind: "color", color}` | colour lower-cased; alpha dropped; `transparent` → `{kind: "transparent"}` |
| `settings.background {type: "color", color}` with a gradient string | `{kind: "gradient", css: color}` | string copied unchanged |
| `settings.background {type: "blur", blurIntensity}` | `{kind: "blur", blurIntensity}` | value multiplied by the classic-canvas factor `k` below, rounded to an integer and clamped to 0–1000 |
| (rule) classic-canvas factor `k` | — | classic scaled blur sigma by `width / 1920` horizontally and `height / 1080` vertically; schema 32 scales by `max(width, height) / 1920` on both axes (`render-engine.Gaussian blur effect pass`). `k = sqrt((width / 1920) × (height / 1080)) / (max(width, height) / 1920)` for the project canvas; `k = 1` on every 16:9 landscape canvas (0.5625 on 1080 × 1080, 0.316 on 1080 × 1920). The same `k` multiplies the `intensity` of every classic `blur` effect entry (clamped to 0–100) and of its keyframes. The classic anisotropy on non-16:9 canvases is not reproduced; the migration report lists each rescaled value |
| (none) | `settings.adoptCanvasFromFirstMedia`, `settings.adoptFrameRateFromFirstMedia` | `false` when any scene has a video or image element, else `true` |
| (none) | `settings.useProxies`, `settings.colorPipeline` | `true`, `"sdr-rec709-8bit"` |
| (none) | `cover`, `scriptLinks`, `glossaries`, `media` | `null`, `[]`, `{}`, built per §13.6 |
| `currentSceneId` | `local.currentSceneId` | moved out of the canonical document |
| `timelineViewState {zoomLevel, scrollLeft, playheadTime}` | `local.timelineViewState` | moved; gains `expandedKeyframeElementIds: []`, `scenePlayheads: {}` |
| `scenes[].id`, `name`, `isMain`, `tracks` | same keys | name cut to 80 characters |
| (none) | `scenes[].kind`, `compoundBackground` | `"timeline"`, `"none"` |
| `scenes[].bookmarks[] {time, note?, color?, duration?}` | `scenes[].markers[]` | key renamed; each entry gains `id` (new UUID); `color` kept when it is `#rrggbb`, else 1; entries sorted by time; a second entry on the same frame is dropped |
| `scenes[].createdAt`, `updatedAt` | `scenes[].created_ms`, `updated_ms` | as for metadata |
| track `id`, `name`, `type`, `elements` | same keys | elements sorted by `startTime` then `id` |
| track `hidden` (video, text, graphic, effect) | `hidden` | copied |
| track `muted` (video, audio) | `muted` | copied |
| (none) | track `locked: false`, `transitions: []` | |
| (none) | track `pinned` | `true` when the stored name differs from the classic default name of its type, else `false` |
| (none) | track `solo: false`, `volume: 0`, `pan: 0` (video and audio tracks), `ducking` (audio tracks, defaults) | |

### 13.2 Element common fields

| Classic v31 | Schema 32 | Rule |
|---|---|---|
| `id`, `type`, `name`, `startTime`, `duration`, `trimStart`, `trimEnd`, `sourceDuration` | same keys | times rounded to integer ticks; name cut to 200 characters |
| `hidden` | `hidden` | absent → `false` |
| `mediaId` (video, image, upload audio) | `mediaId` | copied |
| `isSourceAudioEnabled` | `isSourceAudioEnabled` | absent → `true` |
| `retime {rate, maintainPitch?}` | `retime {rate, maintainPitch, reverse: false, smooth: "none"}` | rate kept as stored (0.01–5 is valid); the object is omitted when rate is 1 |
| `buffer` (runtime audio buffer) | — | dropped |
| (none) | `groupId: null`, `linkId: null`, `transitionIn: null`, `transitionOut: null` | |
| (none) | `crop`, `flip` | zeros; `false` (see §13.3 for negative scale) |

### 13.3 `element.params` keys of visual elements (video, image, text, sticker, graphic)

| Classic v31 source | Schema 32 field | Rule |
|---|---|---|
| `P["transform.positionX"]`, else top `transform.position.x` | `transform.position.x` | default 0 |
| `P["transform.positionY"]`, else top `transform.position.y` | `transform.position.y` | default 0 |
| `P["transform.scaleX"]`, else top `transform.scaleX` | `transform.scale.x` | default 1; negative value: see the flip rows |
| `P["transform.scaleY"]`, else top `transform.scaleY` | `transform.scale.y` | default 1 |
| `P["transform.rotate"]`, else top `transform.rotate` | `transform.rotation` | default 0; value unchanged (−360…360 is inside −3600…3600) |
| `P["opacity"]`, else top `opacity` | `opacity` | default 1 |
| `P["blendMode"]`, else top `blendMode` | `blendMode` | unknown value → `"normal"` |
| static scale X (or Y) negative and no animation channel on that axis | `transform.scale.x = |value|`, `flip.horizontal = true` (Y: `flip.vertical`) | |
| scale animation channel whose keys are all negative | every key value negated; the flag set to `true`; the static value made positive | |
| scale animation channel with keys of both signs | channel kept unchanged, flag `false`; a key value of −100…−0.01 is valid on the paths `transform.scale.x` and `transform.scale.y` (writers of schema 32 never create one) | rendered mirrored per `preview-canvas.Flip by dragging through the centre` |
| top-level `transform {scaleX, scaleY, position, rotate}` (stale copy) | — | replaced by the schema-32 `transform` object |

### 13.4 `element.params` keys per element type

| Classic v31 source | Schema 32 field | Rule |
|---|---|---|
| video, audio: `P["volume"]`, else top `volume` | `volume` | default 0; clamped to −60…+20 |
| video, audio: `P["muted"]`, else top `muted` | `muted` | default `false` |
| audio `sourceType: "upload"` | `sourceType: "upload"` | |
| audio `sourceType: "library"`, `sourceUrl` | `sourceType: "library"`, `mediaId`, `sourceUrl` kept | the migration creates a media asset record with `provenance {source: "url", url: sourceUrl}` and `needsProbe: true`; the bytes are fetched on first load; while they are missing the element is offline |
| text: `P["content"]`, else top `content` | `content` | default "Default text" |
| text: `P["fontFamily"]`, `P["fontSize"]`, `P["color"]`, `P["textAlign"]`, `P["fontStyle"]`, `P["letterSpacing"]`, `P["lineHeight"]` (else the top-level copies) | same-named fields | defaults of §10.4; `fontSize` clamped to 1–500 |
| text: `P["fontWeight"]` | `fontWeight` (number) | `"normal"`, `"400"` → 400; `"bold"`, `"700"` → 700; any other numeric string 100–900 → that number rounded to the nearest hundred; anything else → 400 |
| text: `P["textDecoration"]` | `underline`, `strikethrough` | `"underline"` → `underline: true`; `"line-through"` → `strikethrough: true`; `"none"` → both `false`; the key is removed |
| text: `P["background.enabled"]`, `["background.color"]`, `["background.cornerRadius"]`, `["background.paddingX"]`, `["background.paddingY"]`, `["background.offsetX"]`, `["background.offsetY"]` (else top `background.*`) | `background.enabled`, `.color`, `.cornerRadius`, `.paddingX`, `.paddingY`, `.offsetX`, `.offsetY` | defaults `false`, `#000000`, 0, 30, 42, 0, 0; `color: "transparent"` → `enabled: false`, `color: "#000000"` |
| text: (none) | `textCase`, `fill`, `box`, `curve`, `stroke`, `shadow`, `glow`, `textAnimation` | defaults (all effects disabled, `bubble` and `textAnimation` absent) |
| sticker: `stickerId`, `intrinsicWidth`, `intrinsicHeight` | same keys | missing intrinsic size → 200 |
| sticker: (none) | `loop: true`, `playbackSpeed: 1` | |
| graphic: `definitionId` | `definitionId` | an unknown id makes the element invalid (`document/unknown-definition`) and it is dropped by load repair |
| graphic: `P[k]` for every key `k` of the definition (`fill`, `stroke`, `strokeWidth`, `strokeAlign`, `cornerRadius`, `sides`, `points`, `depth`) | `params[k]` | the visual keys of §13.3 are removed from `params`; other unknown keys are dropped |
| effect element: `effectType`, `params` | `effects: [{id: <new UUID>, type: effectType, kind: "effect", enabled: true, params: <copy of element.params>}]`, `target: "beneath"` | `effectType` is removed; an unregistered `effectType` keeps the entry and renders as pass-through with a diagnostic |
| clip `effects[] {id, type, params, enabled}` | `effects[]` with `kind: "effect"` added to every entry | ids kept; a `blur` entry's `params.intensity` is multiplied by the classic-canvas factor `k` of §13.1 |
| `element.params` on video, image, audio, text, sticker and effect elements | — | the map is removed after its keys are converted (the pre-migration backup keeps it) |

### 13.5 Masks and animations

| Classic v31 source | Schema 32 field | Rule |
|---|---|---|
| `masks[] {id, type, params}` (or a single `mask`) | `masks[]` | `mask` normalised to a one-entry array; each entry gains `enabled: true`, `combine: "add"`, `params.opacity: 100` |
| mask `params.feather`, `inverted`, `strokeColor`, `strokeWidth`, `strokeAlign`, `centerX`, `centerY`, `width`, `height`, `rotation`, `scale` | same keys | values unchanged |
| rectangle mask | `params.cornerRadius: 0` added | |
| star mask | `params.points: 5`, `params.innerRatio: 0.45` added | |
| text mask `params.content`, `fontSize`, `fontFamily`, `fontWeight`, `fontStyle`, `textDecoration`, `letterSpacing`, `lineHeight` | same keys | values unchanged |
| freeform mask `params.path[] {id, x, y, inX, inY, outX, outY}`, `closed` | same keys | values unchanged |
| animation path `transform.positionX` / `transform.positionY` | `transform.position.x` / `transform.position.y` | channel moved unchanged |
| animation path `transform.scaleX` / `transform.scaleY` | `transform.scale.x` / `transform.scale.y` | see the flip rows of §13.3 |
| animation path `transform.rotate` | `transform.rotation` | |
| animation paths `opacity`, `volume`, `color`, `background.color`, `background.paddingX`, `background.paddingY`, `background.offsetX`, `background.offsetY`, `background.cornerRadius` | same paths | channel unchanged |
| animation path `params.<key>` on a graphic element | `params.<key>` | channel unchanged |
| animation path `params.<key>` on an effect element | `effects.<newEffectId>.params.<key>` | the id created in §13.4 |
| animation path `effects.<effectId>.params.<key>` | same path | channel unchanged |
| channel `{keys[], extrapolation?}`, key `{id, time, value, leftHandle?, rightHandle?, segmentToNext, tangentMode}` | same shape | times rounded to integer ticks; a missing `segmentToNext` → `"linear"`; a missing `tangentMode` → `"auto"` |
| colour channel components `{r, g, b, a}` | ColorChannel | unchanged |
| `animations.bindings`, `animations.channels` (left behind by v29→v30) | — | removed |
| an animation path that is not in §11.2 after renaming | — | removed and counted in the migration report |

### 13.6 Media metadata records → `media.assets[]`

| Classic v31 (`MediaAssetData`) | Schema 32 | Rule |
|---|---|---|
| `id`, `name`, `type`, `size` | same keys | |
| `lastModified` | `lastModified_ms` | |
| `width`, `height` | same keys | |
| `duration` (seconds) | `duration` (ticks) | × 120 000, rounded half away from zero |
| `fps` (number) | `fps` (`Rational`) | the single rule of `media-library.Media probing`: a standard rate matched within 0.01, otherwise `round(fps × 1000) / 1000` reduced |
| `hasAudio`, `ephemeral` | same keys | |
| `thumbnailUrl` (data URL) | thumbnail store | decoded and stored; not part of the document |
| (none) | `kind: null`, `contentHash: null`, `folderId: null`, `tags: []`, `provenance: {source: "imported"}`, `motionTracks: []`, `faces: []`, `created_ms` = migration time | |
| (none) | `local.media[id]` = `{storage: "managed", canDecode: null, needsProbe: true}` | `needsProbe` only when `hasAudio`, `fps`, a codec, `container` or `rotation` is missing |

### 13.7 Classic values with no schema-32 counterpart

| Classic value | Outcome |
|---|---|
| `element.params` keys that are not registered for the element type | dropped; counted in the migration report |
| top-level stale copies `opacity`, `blendMode`, `volume`, `muted` and text fields when a `params` value exists | overwritten by the `params` value |
| `textDecoration` | replaced by `underline` / `strikethrough` |
| `metadata.createdAt`, `metadata.updatedAt`, scene `createdAt`, `updatedAt` | replaced by the `_ms` fields |
| `EffectElement.effectType` | replaced by `effects[0].type` |
| audio `buffer`, asset `url`, asset `file` | runtime only; dropped |
| saved sounds (`video-editor-saved-sounds`) | not part of the project document; migrated by `project-storage` to the saved-sounds store |
| localStorage preferences (keybindings, panel sizes, guides, recent stickers, easing presets) | not part of the project document; handled by `project-storage.Classic bundle ingestion` |

## 14. Validation error codes (`document/<kebab>`)

Every error is `{code, path, message, details?}` where `path` is an id path of `project-document.State patch format`.

| Code | Raised when |
|---|---|
| `document/not-an-object` | the root is not a JSON object |
| `document/unknown-format` | `format` is not `"jagentchill.project"` |
| `document/schema-too-old` | `schemaVersion` is below 32 (the document needs migration first) |
| `document/schema-too-new` | `minReaderSchemaVersion` is above the reader's schema |
| `document/invalid-min-reader` | `minReaderSchemaVersion` is below 32 or above `schemaVersion` |
| `document/missing-field` | a required field is absent |
| `document/wrong-type` | a value has the wrong JSON type or is not a member of its union |
| `document/out-of-range` | a number, length or count is outside its range |
| `document/not-integer-ticks` | a `Ticks` value is not an integer or is negative |
| `document/not-frame-aligned` | a time that MUST be frame-aligned is not on the frame grid |
| `document/invalid-number` | a number is `NaN`, infinite, `-0` or beyond ±(2^53 − 1) |
| `document/invalid-rational` | a `Rational` is not reduced or out of range |
| `document/invalid-color` | a colour string does not match its type |
| `document/invalid-id` | an id does not match the `Id` grammar |
| `document/duplicate-id` | two entities of the document share an id |
| `document/field-not-allowed` | a schema-32 field is present on an element or track type that does not carry it |
| `document/too-large` | the canonical form exceeds 67 108 864 bytes |
| `document/limit-exceeded` | a count limit of §15 is exceeded (`details.limit` names it) |
| `document/no-main-scene` | no scene, or not exactly one scene, has `isMain: true` |
| `document/main-track-invalid` | `tracks.main` is absent or is not a `video` track |
| `document/track-zone-mismatch` | a track type is in a zone that does not accept it |
| `document/element-track-mismatch` | an element type is on a track type that does not accept it |
| `document/elements-overlap` | two elements of one track overlap in time |
| `document/elements-unsorted` | `elements[]`, `markers[]` or a key list is not in its canonical order |
| `document/time-out-of-bounds` | an element or marker lies outside 0 … 24 h, or `trimStart + trimEnd` exceeds the source |
| `document/unknown-asset` | a `mediaId`, `matteAssetId` or other asset reference does not resolve |
| `document/asset-type-mismatch` | a referenced asset has the wrong `type` or `kind` |
| `document/unknown-scene` | a `sceneId` does not resolve |
| `document/compound-cycle` | a compound element reaches its own scene directly or transitively |
| `document/compound-depth` | compound nesting exceeds 8 |
| `document/unknown-definition` | a `definitionId`, clip-animation id, text-animation id or bubble id is not registered |
| `document/unknown-reference` | a `tracking`, `folderId`, `lutId`, slot or other id reference does not resolve |
| `document/link-invalid` | a `linkId` is not shared by exactly two elements of one scene |
| `document/group-invalid` | a `groupId` is carried by a single element or spans two scenes |
| `document/transition-ref-mismatch` | a transition record and the `transitionIn` / `transitionOut` of its two elements do not mirror each other |
| `document/transition-not-adjacent` | the two elements of a transition record are not exactly adjacent on the record's track |
| `document/animation-path-invalid` | an `animations` key is not an animatable path of the element |
| `document/animation-channel-invalid` | a channel's shape does not match its path, keys are unsorted or duplicated, or a key lies outside `[0, duration]` |
| `document/effects-limit` | more than 16 entries, more than one `filter`, or a wrong count on an `effect` or `adjustment` element |
| `document/masks-limit` | more than 8 masks, or more than 256 path points |
| `document/caption-overlap` | two caption elements of one caption track overlap, or `words[]` are unordered |
| `document/multicam-invalid` | a multicam scene or clip violates `project-document.Multi-camera definition` |
| `document/template-invalid` | the `template` object violates `project-document.Template mode model` |
| `document/template-locked` | a change is not in the allowed set while `template.locked` is `true` |
| `document/patch-invalid` | a state patch has a malformed path, an unknown op, or does not apply to the base |
| `document/device-local-in-patch` | a state patch addresses `local` |

## 15. Limits

| Limit | Value |
|---|---|
| canonical document size | 67 108 864 bytes (64 MiB) |
| scenes per project | 200 |
| overlay tracks / audio tracks per scene | 99 / 99 |
| elements per track / per scene / per project | 5 000 / 20 000 / 100 000 |
| markers per scene | 1 000 |
| transition records per track | 2 000 |
| effects per element (of which filters) | 16 (1) |
| masks per element / points per freeform path | 8 / 256 |
| keys per channel / animated paths per element | 1 000 / 256 |
| speed-curve points / colour-curve points | 32 / 16 |
| beats per element | 2 000 |
| words per caption | 200 |
| strokes per drawing / points per drawing | 2 000 / 200 000 |
| compound nesting depth | 8 |
| multicam angles | 8 |
| assets / library folders / user LUTs per project | 10 000 / 2 000 / 500 |
| script links per project / glossary pairs per language | 20 / 200 |
| template slots / editable texts / audio slots / theme colours | 200 / 200 / 50 / 6 |
| string length | per `Text(n)`; any other string ≤ 4 000 characters |
| JSON nesting depth | 32 |

## 16. Device-local section (`local`)

Excluded from the canonical form, hashes, state patches, sync and packages.

| Field | Type | Unit / range | Default | Anim | Owner |
|---|---|---|---|---|---|
| `local.currentSceneId` | `Id` | the scene shown on this device | the main scene | no | timeline-editing |
| `local.timelineViewState.zoomLevel` | number | > 0 | 1 | no | timeline-editing |
| `local.timelineViewState.scrollLeft` | number | px, ≥ 0 | 0 | no | timeline-editing |
| `local.timelineViewState.playheadTime` | `Ticks` | playhead of the current scene | 0 | no | timeline-editing |
| `local.timelineViewState.scenePlayheads` | map scene `Id` → `Ticks` | | `{}` | no | timeline-editing |
| `local.timelineViewState.expandedKeyframeElementIds` | array of `Id` | ≤ 500; unknown ids dropped on load | `[]` | no | keyframe-animation |
| `local.folderId` | `Id` or `null` | project folder on this device | `null` | no | projects |
| `local.trash` | `{kind: "project" \| "template", deleted_ms: Ms, originalFolderId?: Id}` or `null` | | `null` | no | projects |
| `local.media` | map asset `Id` → LocalAsset | | `{}` | no | media-library |
| LocalAsset `.storage` | `"managed" \| "external"` | | `"managed"` | no | media-library |
| LocalAsset `.externalPath` | `Text(4000)` | absolute path; `storage: "external"` | absent | no | media-library |
| LocalAsset `.externalGrantId` | `Id` | | absent | no | project-storage |
| LocalAsset `.externalSize` | integer | bytes | absent | no | media-library |
| LocalAsset `.externalMtime_ms` | `Ms` | | absent | no | media-library |
| LocalAsset `.canDecode` | boolean or `null` | | `null` | no | media-library |
| LocalAsset `.canDecodeSound` | boolean or `null` | | `null` | no | media-library |
| LocalAsset `.needsProbe` | boolean | | `false` | no | media-library |
| LocalAsset `.proxy` | `{state: "none" \| "queued" \| "running" \| "succeeded" \| "failed" \| "cancelled" \| "unavailable", size?: integer, sha256?: Sha256, videoCodec?: "h264" \| "vp9", audioCodec?: "aac" \| "opus", container?: "mp4" \| "webm"}` | | `{state: "none"}` | no | media-library |
| LocalAsset `.present` | `{original: boolean, proxy: boolean, mezzanine: boolean}` | which variants are stored on this device | all `false` | no | cross-device-sync |
| `local.exportSavePath` | `Text(4000)` | last save location | absent | no | export-share |
| `local.uniformScaleLock` | map element type → boolean | | every type `true` | no | preview-canvas |
