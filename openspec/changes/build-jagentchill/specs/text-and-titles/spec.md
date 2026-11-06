## ADDED Requirements

### Requirement: Add a text element
The Text asset tab (desktop and web) and the Add text tool of `mobile-editor.Text group, text clip and sticker strips` (mobile) SHALL add a text element with content "Default text" at the playhead, on a text track chosen by strategy `firstAvailable` of `timeline-editing.Placement strategies`, with the duration given by the "Default text duration" preference of `settings-preferences.Editing default preferences` (initial value 3 s = 360 000 ticks). On desktop and web the default text card SHALL be addable by click or by dragging it onto the timeline or the canvas (dropping on the canvas places the element centre at the drop point). The new element SHALL be selected, and on mobile the text sheet SHALL open with the keyboard focused. Adding a text element SHALL be one undo step. [PORT TX-001] [CAPCUT CC-171]

#### Scenario: Add by click
- **WHEN** the Default text duration preference is 3 s and the user clicks the default text card with the playhead at 3 s
- **THEN** a text element with content "Default text" exists from 3 s to 6 s (duration 360 000 ticks) on a text track and is selected

#### Scenario: Preference changed
- **WHEN** the Default text duration preference is 5 s and the user adds a text element
- **THEN** its duration is exactly 600 000 ticks

#### Scenario: Add by drag to the canvas
- **WHEN** the user drops the default text card on the canvas at canvas position (200, −300)
- **THEN** the new element's position is (200, −300)

#### Scenario: Undo
- **WHEN** the user presses undo after adding the text
- **THEN** the element and any track created for it are removed

### Requirement: Text content
`content` SHALL be plain text of 0 to 10 000 Unicode characters with `\n` as the line separator; it is not keyframable. Styling SHALL apply to the whole element (no per-range styles). Content SHALL be editable in the inspector textarea, in place on the canvas (`preview-canvas.In-place text editing`) and in the mobile text sheet, with IME composition supported in all three. The timeline bar of a text element SHALL show its content: the first 30 characters of the first non-empty line, or "Text" when the content is empty. The element's `name` is a separate field: it defaults to "Text", is used for accessibility labels and layer lists, and follows the suffix rules of `timeline-editing.Split` and `timeline-editing.Duplicate`; the context menu of `timeline-editing.Element context menu` offers no "Rename" for text and caption elements. [PORT TX-002] [NEW]

#### Scenario: Multi-line content
- **WHEN** the user types "Line one", presses Enter and types "Line two" in the inspector textarea
- **THEN** the canvas shows two lines and the timeline bar is labelled "Line one"

#### Scenario: Name is separate from the bar label
- **WHEN** a text element with content "Hello" is duplicated
- **THEN** the copy's timeline bar reads "Hello" and its `name` is "Text (copy)"

#### Scenario: Length limit
- **WHEN** the user pastes 12 000 characters
- **THEN** the content holds the first 10 000 characters and a toast reads "Text was shortened to 10,000 characters"

### Requirement: Text parameter table
A text element SHALL have the following parameters in addition to the visual parameters of `preview-canvas.Basic tab fields`; the definitions are registered in `timeline-editing.Element parameter registry`. The stored shape is owned by `project-document.Text element` and `project-document.Text style fields`: the values are typed fields at the element top level, with `fill`, `box`, `background`, `stroke`, `shadow`, `glow`, `bubble` and `textAnimation` as nested objects — a dotted key in this table (`fill.type`, `box.width`, `glow.radius`) names a member of that object and is, for keyframable rows, the animation path of `project-document.Animatable property paths`; there is no flat `params` map on a text element. This table states behaviour-relevant ranges, steps and defaults and MUST equal the catalogue of `project-document`:

| Key | Type / range | Step | Default | Keyframable |
|---|---|---|---|---|
| `content` | text, 0–10 000 chars | — | "Default text" | no |
| `fontFamily` | font | — | Arial (rendered with the bundled font given by `text-and-titles.Bundled fonts`) | no |
| `fontSize` | 1–500 | 0.1 (the inspector field scrubs and steps by 0.5; typed, pasted, imported, template and agent values keep one decimal) | 15 | yes |
| `fontWeight` | 100, 200, 300, 400, 500, 600, 700, 800, 900 | — | 400 | no |
| `fontStyle` | normal / italic | — | normal | no |
| `underline` | boolean | — | false | no |
| `strikethrough` | boolean | — | false | no |
| `textCase` | none / upper / lower / title | — | none | no |
| `color` | colour with alpha | — | `#ffffff` | yes |
| `fill.type` | solid / gradient | — | solid | no |
| `fill.gradientColor` | colour (second stop) | — | `#ffd400` | yes |
| `fill.gradientAngle` | 0–360° | 1 | 90 | yes |
| `textAlign` | left / center / right / justify | — | center | no |
| `letterSpacing` | −100..500 | 0.1 | 0 | yes |
| `lineHeight` | 0.1..10 | 0.1 | 1.2 | yes |
| `box.mode` | auto / fixed | — | auto | no |
| `box.width` | 5..400 (% of canvas width) | 0.1 | 80 | yes |
| `curve` | −360..360° | 1 | 0 | yes |
| `background.*` | see `text-and-titles.Text background` | | | |
| `stroke.*` | see `text-and-titles.Text stroke` | | | |
| `shadow.*` | see `text-and-titles.Text shadow` | | | |
| `glow.*` | see `text-and-titles.Text glow` | | | |
| `bubble.*` | see `text-and-titles.Text bubbles` | | | |
| `textAnimation.in / out / loop` | see `text-and-titles.Text animations in, out and loop` | | | |
| `tracking` | see `text-and-titles.Text tracking` | | | |

Values written by OpenCut classic projects are converted by the v31→v32 step of `project-storage.Migration chain`, which owns the conversion: `fontWeight` "normal" or "400" → 400, "bold" or "700" → 700, any other numeric string → that number, anything else → 400; `textDecoration` "underline" → `underline = true`, "line-through" → `strikethrough = true`. [PORT TX-002, TX-003, TX-004, TX-005, TX-006, TX-007, TX-008, TX-009, TX-010, TX-011] [CAPCUT CC-171, CC-175] [NEW]

#### Scenario: Defaults
- **WHEN** a new text element is created
- **THEN** its parameters equal the Default column of the table

#### Scenario: Classic project
- **WHEN** a classic project with a text element `fontWeight: "bold"`, `textDecoration: "line-through"` is opened
- **THEN** the element has `fontWeight = 700`, `strikethrough = true`, `underline = false`

#### Scenario: Classic numeric weight string
- **WHEN** a classic project stores `fontWeight: "300"`
- **THEN** the element has `fontWeight = 300`

#### Scenario: Clamp
- **WHEN** the user types 900 in Font size
- **THEN** the value becomes 500

#### Scenario: Fractional font size is kept
- **WHEN** a caption style with `fontSize` 4.5, a text template with `fontSize` 3.5 and an ASS import yielding 4.5 are written through the parameter registry
- **THEN** the stored values are 4.5, 3.5 and 4.5, and typing 4.44 in the field stores 4.4

#### Scenario: Stepper uses 0.5
- **WHEN** the font size is 5 and the user presses the + stepper once
- **THEN** the font size is 5.5

### Requirement: Font size relative to canvas height
The rendered font size in canvas pixels SHALL be `fontSize × canvasHeight / 90`. All text metrics expressed as a percentage of font size (stroke, shadow, glow, decoration) SHALL use this rendered size, so that changing the project resolution at the same aspect ratio leaves the text looking identical relative to the frame. [PORT TX-004, TX-017]

#### Scenario: 1080p
- **WHEN** `fontSize` is 15 on a 1920×1080 canvas
- **THEN** the rendered font size is 180 px

#### Scenario: Resolution change
- **WHEN** the same project is switched to 3840×2160
- **THEN** the rendered font size is 360 px and the text covers the same fraction of the frame

### Requirement: Font weight, italic, underline and strikethrough
The inspector SHALL show a weight select listing only the weights available for the chosen family, plus B (toggles between 400 and 700, or the nearest available weights), I, U and S toggle buttons. When the family has no italic face the renderer SHALL synthesise italic with a 12° skew; when it has no weight of 600 or more and bold is requested the renderer SHALL synthesise bold by adding a fill-coloured stroke of 3 % of the rendered font size. Underline and strikethrough SHALL be independent, drawn in the fill colour with a thickness of 7 % of the rendered font size; the strikethrough centre SHALL sit at 0.35 × (ascent − descent) above the baseline. [PORT TX-007, TX-008, TX-009] [CAPCUT CC-175] [NEW]

#### Scenario: Available weights
- **WHEN** the chosen family ships weights 400 and 700 only
- **THEN** the weight select lists Regular 400 and Bold 700

#### Scenario: Underline and strikethrough together
- **WHEN** the user turns on both U and S
- **THEN** both decorations are drawn

#### Scenario: Synthesised italic
- **WHEN** italic is turned on for a family with no italic face
- **THEN** glyphs are drawn with a 12° skew

### Requirement: Alignment and justification
`textAlign` SHALL align each line within the text block: left, center, right or justify. Justify SHALL distribute extra space between words on every line except the last line of each paragraph, which is left-aligned (right-aligned for right-to-left paragraphs); for scripts without word spaces it SHALL distribute between characters. Justify SHALL have a visible effect only when `box.mode` is `fixed`; in `auto` mode it SHALL render as left. [PORT TX-006] [CAPCUT CC-175] [NEW]

#### Scenario: Justified paragraph
- **WHEN** a three-line wrapped paragraph in a fixed box is set to justify
- **THEN** lines one and two span the full box width and line three is left-aligned

### Requirement: Letter spacing and line height
`letterSpacing` SHALL add the given value, in units of 1/100 of the rendered font size, after every shaped grapheme cluster (negative values tighten), applied by the engine's own layout (`render-engine.Engine-side text shaping and layout`); inside a run of a cursive-joining script (Arabic and the others listed there) the unit is the whole joined word, which receives no internal spacing, so joining and mark placement are never broken. `lineHeight` SHALL be a multiple of the rendered font size used as the distance between baselines. [PORT TX-010, TX-011] [CAPCUT CC-175]

#### Scenario: Spacing
- **WHEN** `letterSpacing` is 10 at a rendered font size of 180 px
- **THEN** 18 px is added after each character

#### Scenario: Spacing on Arabic
- **WHEN** `letterSpacing` is 20 on the text "مرحبا بكم"
- **THEN** the letters of each word stay joined and the extra space appears only between the two words

#### Scenario: Line height
- **WHEN** `lineHeight` is 2 at a rendered font size of 100 px
- **THEN** baselines are 200 px apart

### Requirement: Text box and auto-wrap
With `box.mode = auto` lines SHALL break only at `\n` and the block width SHALL be the widest line. With `box.mode = fixed` text SHALL wrap inside a box of `box.width` percent of the canvas width: at word boundaries for space-separated scripts, between characters for CJK with standard line-start/line-end prohibition rules, and inside a word only when the single word is wider than the box. The block height SHALL grow with the number of lines. When exactly one text element with `box.mode = fixed` is selected, the left and right edge handles on the canvas SHALL resize `box.width` (not scale), and the corner handles SHALL scale as usual. Switching from auto to fixed SHALL set `box.width` to the current block width so that the layout does not change. [PORT N-012] [NEW]

#### Scenario: Wrap at words
- **WHEN** a long sentence is in a fixed box of 50 % on a 1920-wide canvas
- **THEN** no line is wider than 960 px and breaks occur between words

#### Scenario: Resize the box
- **WHEN** the user drags the right edge handle of a fixed-box text outward
- **THEN** `box.width` increases, the text re-wraps, and `scaleX` does not change

#### Scenario: Switch to fixed
- **WHEN** a single-line auto text 600 px wide on a 1920 canvas is switched to fixed
- **THEN** `box.width` is 31.3 and the text looks the same

### Requirement: Text fill
The fill SHALL be either solid (`color`, with alpha) or a two-stop linear gradient from `color` to `fill.gradientColor` at `fill.gradientAngle` across the text block bounds. Colour keyframes SHALL interpolate in linear RGB including alpha. [PORT TX-005] [NEW]

#### Scenario: Animated colour
- **WHEN** `color` has keyframes `#ff0000` at 0 s and `#0000ff` at 2 s
- **THEN** at 1 s the fill is the linear-RGB midpoint of the two colours

#### Scenario: Gradient
- **WHEN** fill type is gradient with angle 90
- **THEN** the text shows `color` at the top of the block and `fill.gradientColor` at the bottom

### Requirement: Text background
A text element SHALL support a background with: `background.enabled` (boolean, default false, not keyframable); `background.color` (colour with alpha, default `#000000`, keyframable); `background.cornerRadius` (0–100, step 1, default 0, keyframable; 100 = half of the shorter side); `background.paddingX` / `paddingY` (0–1000, step 1, defaults 30 / 42, keyframable; scaled by `fontSize / 15`); `background.offsetX` / `offsetY` (−100000..100000, step 1, default 0, keyframable). The background SHALL be one rounded rectangle around the text block and SHALL be part of the element bounds. The five non-toggle fields SHALL be shown only while `background.enabled` is true. [PORT TX-012, TX-013, TX-014, TX-015, TX-016] [CAPCUT CC-173]

#### Scenario: Enable background
- **WHEN** the user turns Background on with defaults
- **THEN** a black rectangle with square corners surrounds the text with padding 30 × 42 at font size 15

#### Scenario: Fully round
- **WHEN** `background.cornerRadius` is 100
- **THEN** the short ends of the rectangle are semicircles

#### Scenario: Padding scales
- **WHEN** `fontSize` is changed from 15 to 30
- **THEN** the rendered padding doubles

### Requirement: Text stroke
A text element SHALL support an outline with: `stroke.enabled` (boolean, default false); `stroke.color` (colour with alpha, default `#000000`, keyframable); `stroke.width` (0–50 % of the rendered font size, step 0.5, default 6, keyframable); `stroke.position` (outside / center, default outside). Joins SHALL be round. With `outside`, the stroke SHALL be drawn behind the fill so that glyph shapes are not eroded. [PORT N-012] [CAPCUT CC-175] [NEW]

#### Scenario: Outside stroke
- **WHEN** stroke is enabled with width 6 at a rendered font size of 200 px
- **THEN** a 12 px black outline surrounds each glyph and the fill shape is unchanged

#### Scenario: Zero width
- **WHEN** `stroke.width` is 0
- **THEN** no outline is drawn

### Requirement: Text shadow
A text element SHALL support a drop shadow with: `shadow.enabled` (boolean, default false); `shadow.color` (colour, default `#000000`, keyframable); `shadow.opacity` (0–100 %, step 1, default 80, keyframable); `shadow.blur` (0–100 % of the rendered font size, step 1, default 10, keyframable); `shadow.distance` (0–100 % of the rendered font size, step 1, default 5, keyframable); `shadow.angle` (−180..180°, step 1, default −45, keyframable; 0° = right, positive = counter-clockwise). The shadow SHALL be cast by fill and stroke together and SHALL NOT be cast by the background. [PORT N-012] [CAPCUT CC-174] [NEW]

#### Scenario: Default shadow
- **WHEN** shadow is enabled with defaults at a rendered font size of 200 px
- **THEN** a black shadow at 80 % opacity is offset 10 px toward the lower right with a 20 px blur

#### Scenario: Shadow outside bounds
- **WHEN** a shadow extends beyond the glyph block
- **THEN** it is fully drawn and the element's selection bounds are unchanged

### Requirement: Text glow
A text element SHALL support a glow with: `glow.enabled` (boolean, default false); `glow.color` (colour, default `#ffffff`, keyframable); `glow.intensity` (0–100, step 1, default 50, keyframable); `glow.radius` (0–100 % of the rendered font size, step 1, default 20, keyframable). The glow SHALL be an additive blurred copy of fill plus stroke drawn behind them: a Gaussian blur with standard deviation `radius / 3` of the rendered font size, multiplied by `intensity / 50` and clamped to 1. [CAPCUT CC-175] [NEW]

#### Scenario: Glow extent
- **WHEN** glow is enabled with defaults on white text over black at a rendered font size of 200 px
- **THEN** with radius 40 px and standard deviation 13.33 px, the glow alpha measured along the normal of a straight glyph edge is 0.02 ± 0.005 at 27 px from the edge and below 0.002 at 40 px

#### Scenario: Intensity zero
- **WHEN** `glow.intensity` is 0
- **THEN** the rendered frame equals the frame with glow disabled

### Requirement: Curved text
`curve` SHALL bend each line along a circular arc whose subtended angle is `|curve|` degrees: positive values arch upward (centre of the circle below the text), negative values arch downward, and 0 is straight. Each placement unit SHALL be rotated to the tangent at its centre; the unit is the shaped grapheme cluster and, inside a run of a cursive-joining script, the whole joined word placed as one rigid unit (`render-engine.Engine-side text shaping and layout`). With several lines, each line SHALL lie on a concentric arc separated by the line height. `curve = ±360` SHALL form a full circle. While `curve ≠ 0` the background rectangle SHALL surround the bounding box of the curved block and justify SHALL render as center. [CAPCUT CC-175] [NEW]

#### Scenario: Half circle
- **WHEN** `curve` is 180 on a single line
- **THEN** the first and last glyph baselines point in opposite directions and the line forms a semicircle arching upward

#### Scenario: Straight
- **WHEN** `curve` is set back to 0
- **THEN** the layout equals the uncurved layout

### Requirement: Text rendering rules
Text layout SHALL be computed by the engine's own shaper, compiled to wasm and reading only the bundled and loaded font files (`render-engine.Engine-side text shaping and layout`, which owns it): shaping, advances, kerning, line breaking, bidirectional reordering and fallback selection never use the text machinery of the browser or WebView the engine runs in. The serialised layout — glyph ids, positions and line breaks — is therefore byte-identical in preview, on-device export and host export and on web, macOS, Windows, Linux, iOS and Android. Rasterisation (`render-engine.Text and graphic rasterisation`) draws those positioned glyphs and differs between platforms at most in anti-aliasing, within the text parity threshold named below. Colour emoji are drawn by the engine from the bundled colour font; on a platform where spike S6 row 12 (`mobile-editor.WebView capability spike matrix`) fails, they are drawn from the bundled 512 px emoji bitmaps placed at the same glyph positions (decision E5), never from a platform emoji font. The composition of one text layer, back to front, SHALL be: shadow, glow, bubble or background, outside stroke, fill, decorations, centre stroke; the resulting layer then passes through the stages of `render-engine.Per-layer stage order`. Shaping SHALL support ligatures, kerning, combining marks, contextual and conjunct forms (Arabic, Devanagari, Thai), bidirectional text and colour emoji. Features that place units one by one — `letterSpacing`, `curve` and `character`-unit animations — use the shaped cluster, or the joined word in cursive scripts, as their unit, so they compose with shaping instead of breaking it. A glyph missing from the chosen family SHALL fall back through the fallback chain of `text-and-titles.Bundled fonts`, then to a visible "missing glyph" box. Text SHALL be rasterised at the resolution implied by the element's current scale and preview quality so that edges stay sharp at scale 0.01–100. Bounds used for selection SHALL be the glyph block unioned with the background rectangle or bubble. Preview and export of the same frame on the same device SHALL match within the preview-versus-export tolerance of `render-engine.Golden-frame determinism`; frames with text compared across operating systems or between a device and the host SHALL meet the text parity threshold stated there. [PORT TX-017] [NEW]

#### Scenario: Preview equals export
- **WHEN** a frame containing styled text is exported and compared with a full-quality snapshot of the same frame on the same device
- **THEN** the two images match within the preview-versus-export tolerance of `render-engine.Golden-frame determinism`

#### Scenario: Same line breaks on every platform
- **WHEN** the same fixed-box paragraph in family "Arial" is laid out on macOS, Windows, Linux, iOS, Android and the host
- **THEN** the serialised layout (glyph ids, glyph positions, line breaks, block width) is byte-identical on all six, and the rendered frames meet the text parity threshold of `render-engine.Golden-frame determinism`

#### Scenario: Mixed scripts
- **WHEN** the content is "Xin chào 你好 مرحبا नमस्ते 😀" in a family that only has Latin glyphs
- **THEN** every character renders with a real glyph and no missing-glyph box appears

#### Scenario: Large scale stays sharp
- **WHEN** white text on black is scaled to 800 % and a glyph edge is sampled across its normal
- **THEN** the transition from below 10 % to above 90 % coverage spans at most 2 px

### Requirement: Bundled fonts
The engine bundle SHALL contain the open-licence fonts listed in section 1 of `text-and-titles/catalog.md` (normative), each with a row in the asset provenance file required by `platform-skeleton.Licence and third-party notices` and a SHA-256 in the font manifest. The nine baseline names SHALL resolve to these bundled fonts on every platform and on the host, never to an operating-system font: Arial and Helvetica → Arimo; Times New Roman → Tinos; Courier New → Cousine; Georgia → Gelasio; Verdana → DejaVu Sans; sans-serif → Noto Sans; serif → Noto Serif; monospace → Noto Sans Mono. The stored `fontFamily` keeps the baseline name. The glyph fallback chain SHALL be, in order: Noto Sans, Noto Sans JP, Noto Sans SC, Noto Sans KR, Noto Naskh Arabic, Noto Sans Hebrew, Noto Sans Thai, Noto Sans Devanagari, Noto Color Emoji. The bundled set SHALL cover the script of every language of `captions-subtitles.Transcription language list` (Latin including Vietnamese, Cyrillic, Greek, Japanese, Chinese, Korean, Thai, Arabic, Hebrew and Devanagari for Hindi), so that auto captions and translations in any offered language render with real glyphs on a fresh install, offline, on every platform and on the host; a language added to that list without a covering bundled font fails the build check below. Fonts for the nine names and Noto Sans SHALL be loaded with the engine; the other fallback fonts SHALL be loaded from the app bundle the first time a glyph needs them, without any network request. Bundled fonts SHALL work with no network and no host. [NEW]

#### Scenario: Baseline name on Linux host
- **WHEN** a project using `fontFamily: "Times New Roman"` is rendered on a Linux host that has no such system font
- **THEN** the text is rendered with the bundled Tinos files and no fallback warning is raised

#### Scenario: Offline CJK
- **WHEN** the device is offline and the user types Japanese text in the default family
- **THEN** the glyphs render from the bundled Noto Sans JP and no network request is made

#### Scenario: Hindi offline
- **WHEN** a caption with the text "नमस्ते दुनिया" is rendered on a fresh install with no network, on a phone and on the host
- **THEN** the conjuncts and vowel signs are shaped from the bundled Noto Sans Devanagari and no missing-glyph box appears

#### Scenario: Every transcription language is covered
- **WHEN** the build check lays out the sample string of each of the 24 languages of `captions-subtitles.Transcription language list` using bundled fonts only
- **THEN** it fails naming the language when any cluster resolves to the missing-glyph box

#### Scenario: Provenance gate
- **WHEN** a bundled font file has no row in the asset provenance file
- **THEN** the licence check of `platform-skeleton.Licence and third-party notices` fails naming the file

#### Scenario: Catalogue matches the bundle
- **WHEN** the build check compares the font manifest with section 1 of the catalogue
- **THEN** it fails if a listed family or weight is missing from the bundle or an unlisted font file is present

### Requirement: Font loading
A font SHALL be loaded when it is chosen and, for every font used by a project, when the project is opened. Font sources are: bundled fonts (always available); imported fonts (device font library and project assets); device fonts (`text-and-titles.System and local device fonts`); and the online font catalogue (`text-and-titles.Font atlas generation`). Catalogue fonts SHALL be downloaded only from the content host row of the "External hosts" table in `security-privacy.Network egress control`, each file verified against the SHA-256 pinned in the catalogue index; clients and the host SHALL never request `fonts.googleapis.com`, `fonts.gstatic.com` or any other third-party font service. The preference "Download additional fonts" (`settings-preferences.Performance preferences`, default off) SHALL gate every font download; the first time the user selects a catalogue family that is not cached, a one-time inline consent "Download fonts from <content host>?" SHALL be shown, and accepting it turns the preference on. Downloaded files SHALL be stored in the device font cache so that reopening the project offline renders with the cached files. While a font is loading, the element SHALL render with the previously loaded family and the picker row SHALL show a spinner; the preview falls back after the font timeout of `render-engine.Text and graphic rasterisation` (3 000 ms) while loading continues in the background up to that requirement's upper limit (15 000 ms), after which the inspector SHALL show the warning "Font unavailable — using fallback" with a Retry action. The stored `fontFamily` SHALL NOT be changed by a fallback. Export SHALL list every font that is not loaded in `export-share.Pre-flight validation` with the choice "Export anyway", and SHALL list fallbacks used in `export-share.Export summary`. [PORT TX-018] [NEW]

#### Scenario: Default is no download
- **WHEN** a fresh install opens a project that uses the uncached catalogue family "Lobster"
- **THEN** no network request is made, the text renders with the fallback, and the inspector shows the fallback warning

#### Scenario: Consent turns downloads on
- **WHEN** the user selects the uncached catalogue family "Lobster" for the first time and accepts the consent
- **THEN** the font file is fetched from the content host, verified against its pinned SHA-256, and the preference "Download additional fonts" is on

#### Scenario: Offline with cache
- **WHEN** the device is offline and the font was downloaded before on this device
- **THEN** the text renders in that font with no warning

#### Scenario: Hash mismatch
- **WHEN** a downloaded font file does not match its pinned SHA-256
- **THEN** the file is discarded, the fallback warning is shown and nothing is written to the font cache

#### Scenario: Slow font
- **WHEN** a font takes 5 s to load during preview
- **THEN** the text shows the fallback from 3 s and switches to the real font when it arrives, without user action

### Requirement: Font picker
Every `font` parameter (text elements, captions, text masks, text templates) SHALL be edited with the font picker, not a plain text input. On desktop and web the picker SHALL be a 288 px wide popover with an auto-focused search field (case-insensitive substring on family name) and a virtualised list (row height 40 px, maximum list height 288 px, overscan 15 rows) of family names sorted alphabetically, with the nine baseline names and a "Brand" group (`templates.Brand kit`) first. Online-catalogue rows SHALL be previewed from the font sprite atlas, which ships in the app bundle; other rows SHALL be previewed as live text in the family itself. Hovering a row for 300 ms SHALL preview the font on the selected element through the preview layer when the font is already available on the device (no download is started by hovering); clicking SHALL load the font as defined by `text-and-titles.Font loading` and commit one undo step; Escape SHALL close and discard the preview. An atlas that fails to decode SHALL show "Fonts failed to load" with a Retry button while still listing baseline, imported, device and cached fonts. On mobile the picker SHALL be a bottom sheet with the same search, tabs and list with 48 pt rows. The same picker without an element is shown at `/library/fonts` (`app-shell-navigation.Library screen`). [PORT TX-003, TX-019] [CAPCUT CC-171]

#### Scenario: Search
- **WHEN** the user types "robo" in the search field
- **THEN** only families whose name contains "robo" (any case) are listed

#### Scenario: Commit a font
- **WHEN** the user clicks the cached family "Roboto Slab"
- **THEN** the element's `fontFamily` is "Roboto Slab", the font is loaded, and one undo restores the previous family

#### Scenario: Hover does not download
- **WHEN** the user hovers an uncached catalogue family for 2 s
- **THEN** no network request is made and the element is unchanged

#### Scenario: Atlas unavailable
- **WHEN** the atlas image cannot be decoded
- **THEN** an error with Retry is shown and the nine baseline families are still selectable

### Requirement: Font picker tabs, favourites and recents
The picker SHALL have four working tabs: All (every source), My fonts (imported and local device fonts), Favorites, and Recent. Each row SHALL have a star toggle that adds or removes the family from Favorites. Recent SHALL list the last 20 families committed, most recent first, without duplicates. Favourites and recents SHALL be persisted per device. Search SHALL filter within the active tab. Each tab SHALL have an empty state: "No imported fonts yet" with an Import button, "No favourites yet — star a font to keep it here", "No recent fonts". [PORT TX-022] [NEW]

#### Scenario: Favourite a font
- **WHEN** the user stars "Inter" and opens the Favorites tab
- **THEN** "Inter" is listed, and it is still listed after reloading the app

#### Scenario: Recents order
- **WHEN** the user commits fonts A, B, then A again
- **THEN** Recent lists A then B

#### Scenario: Empty tab
- **WHEN** no font has been imported and the user opens My fonts on a device without local font access
- **THEN** the empty state with an Import button is shown

### Requirement: System and local device fonts
The picker SHALL always list the nine baseline names Arial, Helvetica, Times New Roman, Courier New, Verdana, Georgia, monospace, sans-serif and serif, which render with bundled fonts as defined by `text-and-titles.Bundled fonts`. Where the runtime exposes local fonts (Local Font Access API on desktop and Chromium web), My fonts SHALL offer "Show fonts installed on this device"; after the user grants permission the installed families SHALL be listed with a "Device font" badge and be usable. A device font file SHALL never be copied: not into the project, not to a host, not to another device and not into a template or preset package. An element that uses a device font SHALL be marked "device font" in the inspector with the note "Looks different on devices without this font"; on any device or host where that family is not installed it SHALL render with the fallback and the warning of `text-and-titles.Font loading`. A project that uses a device font SHALL be listed in `export-share.Pre-flight validation` when the export target is the host, with the choices "Export anyway" and "Replace font". iOS and Android expose no device fonts in the picker. [PORT TX-020] [NEW]

#### Scenario: Permission granted
- **WHEN** the user grants local font access on desktop
- **THEN** installed families appear under My fonts with the "Device font" badge and selecting one renders the text in it

#### Scenario: Permission denied
- **WHEN** the user denies local font access
- **THEN** only baseline, catalogue, imported and cached fonts are listed and no error is shown

#### Scenario: Device font is never copied
- **WHEN** a project that uses a device font is synced to a second device and exported as a template package
- **THEN** neither the sync upload nor the package contains the font file, and the second device shows the fallback with the warning

#### Scenario: Host export pre-flight
- **WHEN** a project that uses a device font is exported on the host
- **THEN** pre-flight lists the font and the export starts only after "Export anyway" or after the font is replaced

### Requirement: Import custom fonts
My fonts SHALL provide "Import font" accepting `.ttf`, `.otf`, `.woff` and `.woff2` files of up to 30 MB each, several at once (file picker on every platform, drag-and-drop on desktop and web, document picker on mobile). Each file SHALL be validated by parsing its name table; an invalid or oversized file SHALL be rejected with a per-file error and SHALL NOT block the others. Imported fonts SHALL be stored in the device font library keyed by SHA-256, grouped by family with all imported weights and styles, and referenced from projects by family name plus hash. A project using an imported font SHALL carry the font file as a project asset, so that it syncs with the project to the user's own paired host and devices (`cross-device-sync.Library item sync`); imported fonts are never sent anywhere else. An imported font SHALL be included in an exported template or preset package (`templates.Template and pack package format`) only when the user ticks "I have the right to redistribute this font" for it in the export summary; otherwise the package records the family name only. Imported fonts SHALL be removable from My fonts; removing a font in use SHALL require confirmation listing the number of open-project elements that use it. The same list is shown at `/library/fonts`. [CAPCUT CC-172] [NEW]

#### Scenario: Import and use
- **WHEN** the user imports `Brand-Bold.otf`
- **THEN** the family appears under My fonts with weight 700 and can be applied to a text element

#### Scenario: Invalid file
- **WHEN** the user imports a renamed `.png` as `.ttf` together with a valid font
- **THEN** the valid font is imported and the invalid file is reported as "Not a valid font file"

#### Scenario: Synced project
- **WHEN** a project using an imported font is opened on a second paired device
- **THEN** the text renders in the imported font without manual installation

#### Scenario: Package without the redistribution tick
- **WHEN** a template using an imported font is exported and the redistribution box is left unticked
- **THEN** the package contains no file for that font and its manifest records the family name

### Requirement: Font atlas generation
The repository SHALL contain a build script that generates the online font catalogue from the Fontsource family list filtered to open-licence families (OFL-1.1, Apache-2.0 or UFL-1.0) with a Latin subset and weight 400: a JSON index (`family → {x, y, w, ch, s[]}` plus the available weights and styles per family, and for every font file its path on the content host, byte size and SHA-256) and sprite images rendered at 24 px font size in 40 px rows on a 1200 px wide canvas, split into chunks of at most 800 px height, encoded as AVIF quality 80 with a WebP copy for runtimes without AVIF decoding. The index and sprites SHALL ship in the app bundle; only font files are fetched at run time (`text-and-titles.Font loading`). The script SHALL be deterministic (same input list → byte-identical index) and SHALL fail the build when a listed family cannot be rendered or has a licence outside the three listed. [PORT TX-021]

#### Scenario: Deterministic output
- **WHEN** the script is run twice on the same family list
- **THEN** the two JSON indexes are byte-identical

#### Scenario: Missing family
- **WHEN** a listed family cannot be fetched
- **THEN** the script exits with a non-zero status naming the family

#### Scenario: Licence outside the list
- **WHEN** a listed family declares a licence other than OFL-1.1, Apache-2.0 or UFL-1.0
- **THEN** the script exits with a non-zero status naming the family and the licence

### Requirement: Text inspector layout
The tabs of a selected text element are defined by `preview-canvas.Inspector structure per element type` (Text with the sub-tabs Basic, Bubble, Effects and Templates; then Animation, Tracking and Text-to-speech); this requirement defines the content of the Text sub-tabs. Basic SHALL contain, in order: content textarea; font picker, weight select and B / I / U / S toggles; font size; case select; alignment segmented control (left, center, right, justify); letter spacing and line height; text box (Auto / Fixed and width); curve; the collapsible sections Fill, Stroke, Shadow, Glow and Background, each with an enable switch in its header; then the Transform and Blend sections of `preview-canvas.Basic tab fields`. Buttons "Copy style" and "Paste style" and a "Save as preset" button SHALL sit at the bottom of Basic. Bubble SHALL show `text-and-titles.Text bubbles`; Effects SHALL show `text-and-titles.Text effect presets`; Templates SHALL show the gallery of `text-and-titles.Text templates`, where choosing a template replaces the selected text element by that template group at the same start time, carrying the element's content into the template's first text, as one undo step. On mobile the same controls are grouped into the text sheet of `text-and-titles.Text on touch devices`; mobile entry: see `mobile-editor.Text group, text clip and sticker strips`. [PORT TX-003] [CAPCUT CC-171, CC-284] [NEW]

#### Scenario: Section toggles
- **WHEN** the user turns on the Stroke section switch
- **THEN** `stroke.enabled` is true, the stroke fields appear, and the canvas shows the outline

#### Scenario: Controls present
- **WHEN** a text element is selected on desktop
- **THEN** every control listed for Basic is present in the listed order

#### Scenario: Templates sub-tab keeps the content
- **WHEN** a text element with content "Spring sale" is selected and the user picks a lower-third template in the Templates sub-tab
- **THEN** the element is replaced by the template group at the same start time, the group's first text reads "Spring sale", and one undo restores the original element

### Requirement: Copy, paste and apply text style
"Copy style" SHALL copy every text parameter except `content`, transform, opacity, blend mode and animations. "Paste style" SHALL apply the copied style to every selected text or caption element as one undo step. "Apply to all text" in the Basic overflow menu SHALL apply the selected element's style to every text element in the scene after a confirmation that states the number of elements affected. [NEW]

#### Scenario: Paste to several elements
- **WHEN** a style is copied from element A and pasted with elements B and C selected
- **THEN** B and C take A's font, size, fill, stroke, shadow, glow and background, keep their own content and position, and one undo reverts both

#### Scenario: Nothing copied
- **WHEN** no style has been copied
- **THEN** "Paste style" is disabled

### Requirement: Text effect presets
The Text asset tab SHALL have an "Effects" section, and the inspector Text ▸ Effects sub-tab SHALL show the same list: exactly the 40 bundled style presets enumerated in section 2 of `text-and-titles/catalog.md` (normative: id, name, group, fill, gradient, stroke, shadow and glow values), in catalogue order, grouped as Basic, Outline, Shadow, Neon and Gradient, each rendered as a thumbnail of the letters "Aa" drawn by the engine with the preset's real values. Applying a preset SHALL set fill, stroke, shadow and glow parameters to the catalogue values (a "—" cell disables that feature) and leave content, font family, size, alignment, box, curve, background, bubble, transform and animations unchanged. The first tile SHALL be "None", which disables stroke, shadow and glow and resets fill to solid white. Hover (long-press on touch) SHALL preview on the selected element; click SHALL commit one undo step. Clicking a preset in the asset tab with no text selected SHALL add a new text element with that preset. Presets from imported packs and "My presets" are listed after the bundled groups (`templates.Preset packs`). [CAPCUT CC-176] [NEW]

#### Scenario: Exactly 40 offline
- **WHEN** the Effects section is opened on a fresh install with no network
- **THEN** it lists "None" followed by exactly 40 presets whose ids equal the catalogue ids in order

#### Scenario: Apply a preset
- **WHEN** the user clicks the preset `neon-pink` with a text element selected
- **THEN** the element has `color = #ffe6f4`, glow enabled with colour `#ff2d92`, intensity 80 and radius 30, stroke and shadow disabled, and its content and font are unchanged

#### Scenario: None
- **WHEN** the user clicks "None"
- **THEN** stroke, shadow and glow are disabled and the fill is solid `#ffffff`

#### Scenario: Catalogue data check
- **WHEN** the unit test loads the bundled preset data
- **THEN** every value equals the corresponding cell of section 2 of the catalogue

### Requirement: Text bubbles
The Text ▸ Bubble sub-tab SHALL offer "None" plus exactly the 20 bundled bubbles enumerated in section 3 of `text-and-titles/catalog.md` (normative: id, name, group, vector path on a 100×100 box, text-area rectangle and default colours), grouped as Speech, Thought, Shout, Label, Banner, Tag and Frame. A bubble SHALL be the catalogue path drawn behind the text; text SHALL be laid out inside the bubble's text area with `box.mode` treated as fixed to the area width, and the bubble SHALL be scaled (independently on X and Y, stroke width unaffected) so that its text area contains the text block. Bubble parameters: `bubble.id`; `bubble.color` (default per catalogue, keyframable); `bubble.strokeColor` and `bubble.strokeWidth` (0–20, step 0.5, default per catalogue); `bubble.flipHorizontal` (boolean, default false). A bubble and the text background SHALL be mutually exclusive: choosing a bubble disables the background and vice versa. [CAPCUT CC-177] [NEW]

#### Scenario: Exactly 20 offline
- **WHEN** the Bubble sub-tab is opened with no network
- **THEN** it lists "None" followed by exactly 20 bubbles whose ids equal the catalogue ids in order

#### Scenario: Apply a bubble
- **WHEN** the user chooses the bubble `speech-round-left` on a text element
- **THEN** the bubble is drawn behind the text with fill `#ffffff` and a 4-unit `#000000` stroke, the text wraps inside the bubble's text area, and the element bounds include the bubble

#### Scenario: Longer text
- **WHEN** the content grows from 5 to 60 characters
- **THEN** the bubble grows so that no glyph crosses its text-area rectangle

#### Scenario: Exclusive with background
- **WHEN** a bubble is chosen while the background is enabled
- **THEN** `background.enabled` becomes false in the same undo step

### Requirement: Text templates
The Text asset tab SHALL have a "Templates" section with exactly the 30 bundled text templates enumerated in section 5 of `text-and-titles/catalog.md` (normative: id, name, category, default duration and the full element list with fonts, sizes, presets, shapes and animations), in the categories Titles, Lower thirds, Subtitles, Social, Quotes and Callouts, with search by name and keyword. A text template SHALL be a group of one or more text elements, optional shape elements (`stickers-shapes.Shape parameter table`), and their animations and keyframes, with a declared default duration; bundled templates use only bundled fonts, presets, bubbles, shapes and animations. Adding a template SHALL insert the group at the playhead as grouped elements (`groupId`, `timeline-editing.Group and ungroup`) as one undo step; every text in the group SHALL remain editable (content, font, colours) and the group SHALL be movable, scalable and trimmable as a unit. A template group is stored only as elements sharing a `groupId`; no separate group duration or group animation exists: every element carries its own `textAnimation` (or keyframes), anchored to that element's own start and end. Trimming the group's end SHALL move the end of every element that ended at the group end (elements that end earlier keep their timing unless the new end cuts them), and trimming its start likewise, so each element's in animation still plays at its start and its out animation still ends at its end; shape keyframes authored relative to the element start keep their offsets. Tiles SHALL show an animated preview rendered by the engine from the template itself with its catalogue sample text, playing on hover (on tap on mobile); no pre-recorded or stand-in preview image is used. User-saved and imported text templates are defined in `text-and-titles.Save a text preset` and `templates.Preset packs`. Mobile entry: see `mobile-editor.Text group, text clip and sticker strips`. [CAPCUT CC-178] [NEW]

#### Scenario: Exactly 30 offline
- **WHEN** the Templates section is opened with no network and no filter
- **THEN** exactly 30 templates are listed: 6 Titles, 6 Lower thirds, 4 Subtitles, 5 Social, 4 Quotes and 5 Callouts

#### Scenario: Add a template
- **WHEN** the user clicks the template `lower-third-bar` with the playhead at 2 s
- **THEN** a group containing its two text elements and one rectangle is inserted at 2 s with a duration of 4 s

#### Scenario: Edit template text
- **WHEN** the user double-clicks the title text of the inserted template and types a name
- **THEN** only the content changes and the template animation still plays

#### Scenario: Trim the group
- **WHEN** the group is trimmed from 4 s to 3 s
- **THEN** every element that ended at 4 s now ends at 3 s with its out animation ending there, and every in animation still starts at its element's start

### Requirement: Save a text preset
"Save as preset" on a selected text element (or a selected text-template group) SHALL ask for a name (1–60 characters) and store the element's style, bubble and animations (and for groups, all members) under "My presets" in the Text asset tab, per device, synced by `cross-device-sync.Library item sync`. My presets SHALL support rename and delete from a context menu, at most 200 items, and "Export as pack" (`templates.Preset packs`). Applying or adding a saved preset SHALL behave as the bundled presets and templates do. The same list is shown at `/library/presets`. [NEW]

#### Scenario: Save and reuse
- **WHEN** the user saves a styled text as "Brand title" and clicks it in My presets in another project
- **THEN** a new text element with that style and animations is added

#### Scenario: Duplicate name
- **WHEN** the user saves a preset with a name that already exists
- **THEN** the dialog offers Replace or Keep both (appending " 2")

#### Scenario: Limit
- **WHEN** My presets holds 200 items and the user saves another
- **THEN** saving is refused with "Preset limit reached (200)"

### Requirement: Text animations in, out and loop
The Animation tab of a text or caption element SHALL have three groups — In, Out and Loop — each with "None" plus exactly the bundled animations enumerated in section 4 of `text-and-titles/catalog.md` (normative: id, name, unit, motion at strength 100 and easing): 20 In (Fade, Typewriter, Slide up, Slide down, Slide left, Slide right, Zoom in, Zoom out, Pop, Bounce, Blur, Wipe right, Wipe left, Rise, Drop, Spin, Flicker, Stretch, Wave, Shake), 20 Out with the same names and the motions listed for Out, and 12 Loop (Pulse, Wobble, Float, Blink, Swing, Wave, Jitter, Rainbow, Breathe, Heartbeat, Scroll, Glitch). The stored model SHALL be `textAnimation {in?, out?, loop?}` with `in` and `out` = `{id, duration, strength}` and `loop` = `{id, period, strength}`; `strength` 0–100 (step 1, default 100) scales every displacement, rotation, scale delta and blur of the catalogue motion linearly and leaves opacity ramps unchanged. Each animation's unit (whole block, line, word or character) and the stagger rule for units are given in the catalogue; a `character` unit is the shaped grapheme cluster and, inside a run of a cursive-joining script, the whole joined word (`render-engine.Engine-side text shaping and layout`). Durations: In and Out each 0.1 s to the element duration (step 0.1 s, default 0.5 s) with In + Out ≤ element duration (changing one SHALL clamp the other); Loop has a period of 0.2–5 s (step 0.1 s, default 1 s) and SHALL play between the end of In and the start of Out. One animation per group SHALL be active at a time. Animations SHALL compose with keyframes and transform (the animation is applied on top of the element's resolved transform and opacity) and SHALL be evaluated from element-local time only, so that any frame renders the same when seeking as when playing. Hover (tap on mobile) SHALL preview the animation on the element by looping the affected time range; selecting SHALL commit one undo step. Animated zones SHALL be drawn on the timeline bar as shaded ends. Clip animations for non-text elements are defined in `keyframe-animation.Clip animation model`. [CAPCUT CC-179, CC-180, CC-181] [NEW]

#### Scenario: Exact counts offline
- **WHEN** the Animation tab of a text element is opened with no network
- **THEN** In lists None plus 20 animations, Out lists None plus 20, and Loop lists None plus 12, with the catalogue ids in catalogue order

#### Scenario: In animation
- **WHEN** the user applies Typewriter (In) with duration 1 s to a 4 s text "Hello"
- **THEN** character i (0-based) becomes visible at i × 0.2 s and all five are visible from 0.8 s on

#### Scenario: Catalogue motion
- **WHEN** Slide up (In) with duration 0.5 s and strength 100 is applied to a text block 120 px high
- **THEN** at 0 s the block is offset +120 px in Y with opacity 0, at 0.5 s the offset is 0 with opacity 1, and with strength 50 the offset at 0 s is +60 px

#### Scenario: Durations clamp
- **WHEN** a 2 s text has In 1.5 s and the user sets Out to 1 s
- **THEN** In becomes 1 s

#### Scenario: Loop between in and out
- **WHEN** a 5 s text has In 0.5 s, Out 0.5 s and Loop Pulse with period 1 s
- **THEN** the pulse runs from 0.5 s to 4.5 s and completes 4 cycles

#### Scenario: Seek equals playback
- **WHEN** the frame at element time 1.3 s of a text with Loop Jitter is rendered once by seeking and once during playback
- **THEN** the two frames are identical

#### Scenario: Remove
- **WHEN** the user picks "None" in the In group
- **THEN** the text is fully visible from its first frame

### Requirement: Text keyframes
Every parameter marked keyframable in `text-and-titles.Text parameter table`, the background, stroke, shadow, glow and bubble numeric and colour parameters, and the transform and opacity parameters SHALL be keyframable for text elements through `preview-canvas.Keyframe toggle in the inspector` and the lanes of `keyframe-animation.Expanded keyframe lanes and keyframe panel`; colours interpolate per `keyframe-animation.Colour interpolation in linear RGB`. Non-keyframable parameters (content, family, weight, style, alignment, toggles) SHALL hold a single value for the whole element. [PORT TX-005] [CAPCUT CC-182]

#### Scenario: Animate size
- **WHEN** `fontSize` has keyframes 10 at 0 s and 20 at 2 s with linear interpolation
- **THEN** the rendered size at 1 s corresponds to `fontSize` 15

#### Scenario: Non-keyframable field
- **WHEN** a text element is selected
- **THEN** the Font family field has no keyframe toggle

### Requirement: Text tracking
The Tracking tab of a text element SHALL let the user attach the text to a moving subject in a video element beneath it: the user picks the target video element (default: the topmost video live at the playhead), adjusts a target region on the canvas, and presses "Track". Motion analysis SHALL be performed by `ai-editing-tools.Motion tracking`, which produces a tracking path stored on the target clip, with a progress indicator and a Cancel button. Attachment SHALL be non-destructive: the result SHALL be stored as a tracking binding on the text element, `tracking {targetElementId, trackId, followPosition: true, followScale: false, followRotation: false, offset}`, and no keyframes are written; while bound, the text's effective position (and scale and rotation when enabled) SHALL be the tracked value plus the text's own transform as offset, resolved live by the engine. "Remove tracking" SHALL delete the binding; "Convert to keyframes" SHALL replace the binding with position (and scale and rotation) keyframes at every frame of the tracked range. When the target element is deleted, the binding SHALL be removed in the same undo step and the text SHALL stay at its last resolved position. The binding SHALL survive split (both halves), duplicate and paste of the text element while the target exists. Loss rule (the rule of `ai-editing-tools.Motion tracking`): when the tracker's confidence stays below 0.3 for more than 0.5 s the binding SHALL cover the tracked portion only and the tab SHALL show "Target lost at {timecode}" with the action "Adjust region and continue". Accuracy: on the tracking fixtures of `ai-editing-tools.AI acceptance fixtures`, the followed point SHALL stay within 3 % of the frame width of the labelled target position in every tracked frame. This binding model is shared with `stickers-shapes.Sticker and shape animation and tracking`. [CAPCUT CC-184] [NEW]

#### Scenario: Text follows a subject
- **WHEN** the user tracks a moving car and binds a text label to it
- **THEN** during playback the label keeps the same offset from the car in every frame of the tracked range, within 3 % of the frame width on the fixture clip, and the text element has no position keyframes

#### Scenario: Target deleted
- **WHEN** the target video element is deleted
- **THEN** the text remains on the timeline without a binding and undo restores both the video and the binding

#### Scenario: Target lost
- **WHEN** the subject leaves the frame at 4.0 s of a 10 s clip and confidence stays below 0.3 for more than 0.5 s
- **THEN** the binding covers the range up to the loss point and the tab shows "Target lost at 00:00:04:00" with "Adjust region and continue"

#### Scenario: Convert to keyframes
- **WHEN** the user chooses "Convert to keyframes" on a binding that covers 60 frames
- **THEN** the text has 60 position keyframes, no binding, and renders at the same positions as before

#### Scenario: Cancel
- **WHEN** the user cancels tracking at 40 %
- **THEN** no binding is created

### Requirement: Text-to-speech hand-off
The Text-to-speech tab of a text or caption element (desktop and web: the tab named in `preview-canvas.Inspector structure per element type` for both rows; mobile: `tclip.tts`, `ccap.tts` and `bcap.voice` of `mobile-editor`) SHALL offer the voice, language and speed choices of `ai-editing-tools.Text to speech with voice selection` and a "Generate speech" button. The tool needs a host; without one the tab SHALL show the requires-host state and string defined by `ai-editing-tools.Offline and no-provider behaviour` and the button SHALL be disabled. On success an audio element with the generated speech SHALL be inserted on an audio track starting at the text or caption element's start time, and both elements SHALL be assigned the same new `linkId` (`project-document.Element common fields`; a link is exactly two elements, here a text or caption and its speech), so that they move, trim-follow and unlink by the rules of `timeline-editing.Video and audio linking`; a switch "Match text duration to speech" (default on; the same label and default as in `ai-editing-tools.Text to speech with voice selection`) SHALL set the text element's duration to the audio duration. With several text elements selected, speech SHALL be generated per element as one batch and one undo step. Generation, voices, consent, cost estimation, budgets and errors are owned by `ai-editing-tools.Text to speech with voice selection` and `generation-providers.Budgets with hard stop`. [CAPCUT CC-183]

#### Scenario: Generate
- **WHEN** the user generates speech for a 5 s text whose speech lasts 3.2 s with duration matching on
- **THEN** an audio element of 3.2 s starts at the text's start and the text's duration becomes 3.2 s

#### Scenario: No host
- **WHEN** no host is connected
- **THEN** the Generate button is disabled and the requires-host state is shown

#### Scenario: Empty text
- **WHEN** the text content is empty or whitespace
- **THEN** the Generate button is disabled with the tooltip "Add text first"

### Requirement: Text on touch devices
On mobile, the Edit handle of a selected text element, a double-tap on it, or the text tools of `mobile-editor.Text group, text clip and sticker strips` SHALL open the text sheet (a `canvasInteractive` sheet of `mobile-editor.Tool sheets never cover the preview`) with the tabs Keyboard, Style (font, size, fill, stroke, shadow, glow, background, alignment, spacing, box, curve), Effects, Bubble and Animation. The Keyboard tab holds the text input field: on phones, and on tablets without a pointer device, text is typed there and not into a canvas overlay (`preview-canvas.In-place text editing`); the canvas shows the text live without a caret; ✓ commits and ✕ discards. For a caption element the sheet has only the tabs Keyboard (the caption text and, for bilingual tracks, the translation), Style and Animation — no Effects and no Bubble tab — and the caption's template, layout, highlight and bilingual controls are in the caption style sheet of `captions-subtitles.Captions on touch devices`; this requirement owns the content of the sheet and `mobile-editor` owns the strip that opens it. The preview SHALL remain visible above the sheet with the edited text in view (the canvas SHALL scroll so the element is not hidden by the sheet). The ✓ button SHALL commit all changes made in the sheet as one undo step. Every value control SHALL follow the touch presentation of `preview-canvas.Number field behaviour`. [CAPCUT CC-171, CC-173, CC-174] [NEW]

#### Scenario: Edit on a phone
- **WHEN** the user taps the Edit handle of a text element
- **THEN** the text sheet opens on the Keyboard tab, the keyboard is shown, and the element stays visible in the preview

#### Scenario: Caption in the text sheet
- **WHEN** the user double-taps a caption on a phone
- **THEN** the text sheet opens with exactly the tabs Keyboard, Style and Animation

#### Scenario: Discard
- **WHEN** the user types in the Keyboard tab and taps ✕
- **THEN** the element's content is what it was and no undo step is added

#### Scenario: Single undo
- **WHEN** the user changes content, font and stroke in the sheet and taps ✓, then taps undo once
- **THEN** all three changes are reverted

### Requirement: Missing font and preset resources
When a project references a font, bubble, effect preset or animation that is not available on the device (unknown id, a device font that is not installed, or an imported resource that has not synced), the element SHALL render with the fallback (the bundled font of the fallback chain; no bubble; no animation), the inspector SHALL show a warning naming the missing resource, the stored reference SHALL be preserved unchanged, and the project SHALL remain fully editable and exportable. `export-share.Export summary` SHALL list every missing resource. [NEW]

#### Scenario: Unknown animation id
- **WHEN** a project made with a newer build references an In animation id unknown to this build
- **THEN** the text renders without an In animation, the Animation tab shows "Animation not available in this version", and saving does not remove the reference

#### Scenario: Font arrives after sync
- **WHEN** the missing imported font finishes syncing
- **THEN** the text re-renders in that font and the warning disappears without user action
