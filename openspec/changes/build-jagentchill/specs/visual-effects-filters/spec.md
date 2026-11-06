## ADDED Requirements

### Requirement: Effect and filter data model
The stored shape of an effect or filter entry (`effects[]`, `{id, type, kind, enabled, params}`), its limits (at most 16 entries per clip, of which at most 1 has `kind: "filter"`; exactly one entry on an `effect` element; at most one entry, of `kind: "filter"`, on an `adjustment` element) and the element types that carry `effects[]` are defined only by `project-document.Effect entries`, `project-document.Effect element` and `project-document.Element types and field applicability`; this capability restates none of them and defines the behaviour on that data. A new entry SHALL be appended at the end of the array with every param at its definition default and `enabled: true`. Applying a filter to an element that already has a filter entry SHALL keep that entry's `id`, array index, `enabled` and `params.intensity` and change only its `type`. The array index of the filter entry has no effect on rendering: the filter entry is consumed by the `filter` stage and the `kind: "effect"` entries, in array order, by the `effects` stage of `render-engine.Per-layer stage order`. There is no `filter` element type and no `filter` track type: a standalone filter is an element of type `effect` on a track of type `effect` whose single entry has `kind: "filter"` (see `Filter layer and clip filter conversion`). Entries SHALL survive split (both halves keep a deep copy with new ids, and the animation paths `effects.<effectId>.params.<key>` are rewritten to the new ids), duplicate, copy/paste and compound-clip creation. Colour param values are stored as lowercase hex strings (the `Color` value type of `project-document.Canonical field list`); a value typed in upper case is stored in lower case. [PORT E-003] [CAPCUT CC-108, CC-112] [NEW]

#### Scenario: Appending an effect uses defaults
- **WHEN** the user applies "Gaussian Blur" to a video element that has no effects
- **THEN** the element's `effects` array contains exactly one entry with `type: "blur"`, `kind: "effect"`, `enabled: true` and `params.intensity = 15`

#### Scenario: Stack limit reached
- **WHEN** an element already has 16 entries and the user applies another effect
- **THEN** no entry is added
- **AND** a toast reads "This clip already has 16 effects. Remove one to add another."

#### Scenario: Second filter replaces the first
- **WHEN** an element has the filter "Amber Reel" at intensity 70 and the user applies the filter "Teal Dusk" to it
- **THEN** the element still has exactly one entry with `kind: "filter"`, with the same `id` and `params.intensity = 70`, and its `type` is `teal-dusk`
- **AND** the change is a single undo step

#### Scenario: Filter position in the array does not change the picture
- **WHEN** an element has the entries `[Mosaic, filter Sepia]` and the user drags the filter row above Mosaic
- **THEN** the rendered frame is identical before and after the reorder

### Requirement: Effect definition registry
The editor SHALL resolve effects and filters through one registry of definitions in `packages/editor-core`. Each definition SHALL declare: `type` (stable id), `kind`, a locale key for the display name, `category`, `keywords[]`, `params[]`, `targets` (element types it accepts), `timeDriven` (boolean), `requires` (empty, or `"person-matte"`) and `algorithm` (the normative one-sentence description in `catalog.md` next to this spec). Param definitions SHALL use the schema and the write-time coercion of `timeline-editing.Element parameter registry` (types `number | boolean | color | select | text | font`; number values snap to step then clamp; a `select` value must equal an option; an unknown key fails validation), so a value written by the inspector, by paste, by a template or by an agent tool is coerced identically. A definition's renderer SHALL be a list of shader passes executed by the wasm compositor. A project entry whose `type` is not registered SHALL be preserved unchanged on save, rendered as a pass-through, and listed in the clip effects list with the label "Unavailable effect" and a remove button. [PORT E-001] [NEW]

#### Scenario: Unknown effect type is preserved
- **WHEN** a project containing an effect entry with `type: "vendor-x"` is opened and saved
- **THEN** the saved project still contains that entry with identical `params`
- **AND** the rendered frame equals the frame rendered with that entry disabled
- **AND** the clip effects list shows "Unavailable effect" for it

#### Scenario: Param coercion
- **WHEN** a number param with range 0–100 and step 1 receives the value 104.6
- **THEN** the stored value is 100

#### Scenario: Invalid select value from an agent tool
- **WHEN** `jc_effect_update` sets Wave `direction` to `"diagonal"`
- **THEN** the command fails validation with `INVALID_PARAMS` naming `direction` and the entry is unchanged

### Requirement: Per-element processing order
This capability SHALL NOT define a processing order. The order in which a layer's source, crop, transform, keying, colour, filter, effects, masks, motion blur, opacity and blend are applied is defined only by `render-engine.Per-layer stage order`, and the equality of preview and export frames only by `render-engine.Golden-frame determinism`. This capability supplies the data those stages consume: the single `kind: "filter"` entry feeds the `filter` stage; the enabled `kind: "effect"` entries feed the `effects` stage in array order (disabled entries are skipped); `motionBlur` feeds the `motion-blur` stage. Standalone effect elements (effect or filter kind) and adjustment layers SHALL be applied to the scene composited from all tracks beneath them, at their track position in the stack, as defined by `render-engine.Adjustment and effect layer nodes`. [PORT E-004] [NEW]

#### Scenario: Array order is render order for effects
- **WHEN** an element has effects `[Mosaic, Vignette]`
- **THEN** the vignette darkening is applied on top of the mosaic blocks (the vignette gradient is smooth, not blocky)

#### Scenario: Reordering changes the result
- **WHEN** the user reorders the same stack to `[Vignette, Mosaic]`
- **THEN** the vignette darkening is quantised into mosaic blocks

#### Scenario: Disabled entry is skipped
- **WHEN** the Mosaic entry of `[Mosaic, Vignette]` has `enabled: false`
- **THEN** the frame equals the frame of an element whose only effect is Vignette

### Requirement: Resolution-independent effect parameters
Every pixel-valued parameter in this capability and in the capabilities that cite this requirement (blur radius and sigma, block size, dot size, particle size, stroke width, shake amplitude, mask feather and stroke, sharpen and clarity radius, cutout stroke) SHALL be defined on a reference canvas whose long side is 1920 px and SHALL be multiplied at render time by the **pixel scale factor** `longSide(renderTarget) / 1920`, where `renderTarget` is the canvas at the resolution being rendered (full, half or quarter preview, proxy playback, export). The factor SHALL NOT depend on the element's own scale or on its source resolution, so reduced-resolution preview, proxy playback and full-resolution export produce the same picture. Gaussian blur sigma in pixels SHALL be `intensity / 5 × pixel scale factor`.

**Coordinate frame.** Effects run after the `transform` stage on a canvas-size layer texture, so every geometric effect SHALL be evaluated in the **effect frame** defined here, and `catalog.md` uses no other frame. For a clip effect the effect frame is the element's box as placed on the canvas by its transform (after crop and flip, including its scale and rotation): `uv = (0, 0)` is the box's top-left corner and `(1, 1)` its bottom-right corner, the axes follow the box's rotation, the "frame centre" is the box centre, "frame width" and "frame height" are the box's side lengths in render-target pixels, and the "half diagonal" is half the length of the box diagonal in render-target pixels. The engine implements this frame in `render-engine.Effect coordinate frame` and supplies the mapping from canvas pixels to it to every effect shader as the uniforms `u_boxInverse: mat3` (canvas pixel → `uv`) and `u_boxSize: vec2` (box side lengths in render-target pixels); the box includes the clip-animation transform. Pixel distances (`× s` px) are measured in render-target pixels along the box axes. For a standalone effect element (`project-document.Effect element`) the effect frame is the whole canvas, and the same two uniforms describe the canvas. Position parameters named `centerX`, `centerY`, `positionX` and `positionY` SHALL be percentages in −100…100 of the half-width or half-height of the effect frame, with 0 at its centre. Sampling outside the effect frame SHALL return transparent black for the remap effects (`fisheye`, `wave`, `ripple`, `twirl`, `bulge`, `mirror`, `kaleidoscope`, `tile`, `lens-distortion`, `lens-zoom`, `slow-zoom`, `pan-drift`, `crt`, `photo-frame`) and the clamped edge texel for every other effect; pixels of the layer texture outside the effect frame are never written by a clip effect. An effect keeps the input alpha unless its catalogue row states a fill; light and particle effects add their light multiplied by the input alpha, so on a keyed or cut-out clip they appear only where the clip has picture.

`render-engine.Gaussian blur effect pass` and `render-engine.Background nodes` use the pixel scale factor. A project migrated from OpenCut classic whose canvas is not 16:9 landscape has its stored blur intensities (the `blur` effect and blur backgrounds) rescaled by the migration so that the rendered sigma is unchanged; the rule is `project-document.Classic v31 mapping`. [PORT E-002] [NEW]

#### Scenario: Same look at two resolutions
- **WHEN** a Mosaic effect with `blockSize = 24` is rendered at 1920×1080 and at 3840×2160
- **THEN** blocks are 24 px at 1920×1080 and 48 px at 3840×2160

#### Scenario: Portrait canvas
- **WHEN** Gaussian Blur with `intensity = 15` is rendered on a 1080×1920 canvas
- **THEN** the blur sigma is 3 px

#### Scenario: Square canvas
- **WHEN** the same blur is rendered on a 1080×1080 canvas
- **THEN** the blur sigma is 1.6875 px (factor 0.5625)

#### Scenario: Element scale does not change the factor
- **WHEN** the blurred clip is scaled to 50 % on a 1920×1080 canvas
- **THEN** the blur sigma is still 3 px

#### Scenario: Clip effect uses the element box
- **WHEN** a Vignette is applied to a clip scaled to 50 % of the canvas
- **THEN** the vignette is centred on and bounded by the clip, not the canvas

#### Scenario: Rotated clip
- **WHEN** Tile with 2 rows and 2 columns is applied to a clip scaled to 50 % and rotated 30°
- **THEN** four copies of the picture fill the rotated box, their edges parallel to the box edges, and no pixel outside the box changes

#### Scenario: Same effect as a layer uses the canvas
- **WHEN** the same Tile effect is used as a standalone effect element above that clip
- **THEN** the whole canvas is divided into four upright copies of the composite

#### Scenario: Particles on a cut-out clip
- **WHEN** Snow is applied to a clip whose background was removed
- **THEN** snow is drawn only over the remaining subject and the transparent area stays transparent

### Requirement: Deterministic time-driven effects
Effects marked `timeDriven` SHALL derive their animation solely from the element-local time in ticks, the effect's params and its `seed` param (integer 0–9999, default 0). They MUST NOT read wall-clock time or a random source. Seeking to the same time SHALL always render the same frame, and preview SHALL match export frame for frame. A `speed` param of 0 SHALL freeze the animation at its time-zero state. [NEW]

#### Scenario: Seek determinism
- **WHEN** the playhead is placed at 00:00:02:00 twice on a clip with the Snow effect, with a different seek in between
- **THEN** both renders are pixel-identical

#### Scenario: Seed changes the pattern
- **WHEN** `seed` changes from 0 to 1 on a Glitch effect
- **THEN** the block pattern at the same time differs
- **AND** the change is undoable

### Requirement: Bundled effect library
The app SHALL ship the following effects, written for this project, available offline on every platform. The table below is normative for ids, names, categories, parameters, ranges and defaults; `catalog.md` next to this spec (section "Effects") is normative for the `algorithm`, `keywords`, `targets`, `timeDriven` and `requires` of every id. Every number param is keyframable unless marked otherwise; `select`, `boolean` and `seed` params are not keyframable. "cx/cy" means the pair `centerX`, `centerY` (−100…100, default 0). `seed` is an integer 0–9999 (default 0). Ranges are inclusive; step is 1 unless stated; "px" values follow `Resolution-independent effect parameters`.

| Category | Type id | Name | Params (range, default) |
|---|---|---|---|
| Blur | `blur` | Gaussian Blur | intensity 0–100 (15) |
| Blur | `directional-blur` | Directional Blur | intensity 0–100 (30); angle 0–360° (0) |
| Blur | `radial-blur` | Radial Blur | intensity 0–100 (30); cx/cy |
| Blur | `zoom-blur` | Zoom Blur | intensity 0–100 (30); cx/cy |
| Blur | `tilt-shift` | Tilt Shift | intensity 0–100 (40); position −100…100 (0); width 0–100 (30); angle 0–360° (0) |
| Blur | `frosted-glass` | Frosted Glass | intensity 0–100 (40); grain 0–100 (20) |
| Blur | `mosaic` | Mosaic | blockSize 2–200 px (24) |
| Distort | `fisheye` | Fisheye | strength 0–100 (50) |
| Distort | `wave` | Wave | amplitude 0–100 (20); frequency 1–50 (8); speed 0–10 step 0.1 (1); direction select horizontal/vertical (horizontal) |
| Distort | `ripple` | Ripple | amplitude 0–100 (25); wavelength 1–100 (30); speed 0–10 step 0.1 (1); cx/cy |
| Distort | `twirl` | Twirl | angle −720…720° (180); radius 1–100 (50); cx/cy |
| Distort | `bulge` | Bulge / Pinch | strength −100…100 (40); radius 1–100 (50); cx/cy |
| Distort | `mirror` | Mirror | mode select left-to-right / right-to-left / top-to-bottom / bottom-to-top / quad (left-to-right); offset −100…100 (0) |
| Distort | `kaleidoscope` | Kaleidoscope | segments 2–24 (6); rotation 0–360° (0); zoom 10–400% (100) |
| Distort | `shake` | Camera Shake | intensity 0–100 (30); frequency 1–30 Hz (12); rotation 0–100 (20); seed |
| Distort | `tile` | Tile | rows 1–10 (2); columns 1–10 (2) |
| Stylise | `posterize` | Posterize | levels 2–32 (6) |
| Stylise | `halftone` | Halftone | dotSize 2–64 px (8); angle 0–360° (45); mode select mono/cmyk (mono) |
| Stylise | `sketch` | Pencil Sketch | edgeStrength 0–100 (60); paper 0–100 (30) |
| Stylise | `cartoon` | Cartoon | edgeStrength 0–100 (50); levels 2–16 (6) |
| Stylise | `emboss` | Emboss | strength 0–100 (50); angle 0–360° (135) |
| Stylise | `neon-edges` | Neon Edges | glow 0–100 (60); threshold 0–100 (30); color (#00e5ff) |
| Stylise | `duotone` | Duotone | shadowColor (#1b0a4a); highlightColor (#ffd23f); intensity 0–100 (100) |
| Stylise | `invert` | Invert | intensity 0–100 (100) |
| Stylise | `threshold` | Threshold | level 0–100 (50); softness 0–100 (0) |
| Light | `glow` | Glow | intensity 0–100 (40); radius 0–100 (30); threshold 0–100 (60) |
| Light | `light-leak` | Light Leak | intensity 0–100 (50); color (#ff8a3d); position −100…100 (−50); speed 0–10 step 0.1 (1); seed |
| Light | `lens-flare` | Lens Flare | intensity 0–100 (60); positionX −100…100 (−40); positionY −100…100 (−40); color (#fff2cc) |
| Light | `light-rays` | Light Rays | intensity 0–100 (40); length 0–100 (50); cx/cy |
| Light | `strobe` | Strobe | frequency 0.5–30 Hz step 0.5 (4); intensity 0–100 (80); color (#ffffff) |
| Light | `spotlight` | Spotlight | radius 1–100 (40); softness 0–100 (50); darkness 0–100 (70); cx/cy |
| Glitch | `rgb-split` | RGB Split | amount 0–100 (20); angle 0–360° (0) |
| Glitch | `glitch` | Block Glitch | intensity 0–100 (50); blockSize 1–100 (30); speed 0–10 step 0.1 (5); seed |
| Glitch | `scan-jitter` | Scanline Jitter | amount 0–100 (30); speed 0–10 step 0.1 (5); seed |
| Glitch | `signal-loss` | Signal Loss | intensity 0–100 (40); bandHeight 1–100 (20); speed 0–10 step 0.1 (3); seed |
| Glitch | `pixel-sort` | Pixel Sort | threshold 0–100 (50); length 0–100 (40); direction select horizontal/vertical (vertical) |
| Retro | `vhs` | VHS Tape | tracking 0–100 (40); chromaBleed 0–100 (50); noise 0–100 (30); scanlines 0–100 (40); seed |
| Retro | `crt` | CRT Screen | curvature 0–100 (30); scanlines 0–100 (50); vignette 0–100 (40) |
| Retro | `film-grain` | Film Grain | amount 0–100 (35); size 1–10 (2); monochrome boolean (true); seed |
| Retro | `old-film` | Old Film | scratches 0–100 (40); flicker 0–100 (30); sepia 0–100 (60); grain 0–100 (40); seed |
| Retro | `super8` | 8 mm Frame | borderSize 0–100 (20); jitter 0–100 (30); warmth 0–100 (40); seed |
| Retro | `bit-crush` | 8-Bit | pixelSize 1–64 px (6); colors 2–64 (16) |
| Particles | `snow` | Snow | density 0–100 (40); size 1–20 px (4); speed 0–10 step 0.1 (2); wind −100…100 (10); seed |
| Particles | `rain` | Rain | density 0–100 (50); length 1–100 px (30); speed 0–10 step 0.1 (6); angle −45…45° (10); opacity 0–100 (60); seed |
| Particles | `sparkles` | Sparkles | density 0–100 (30); size 1–40 px (8); twinkleSpeed 0–10 step 0.1 (3); color (#ffffff); seed |
| Particles | `bokeh` | Bokeh Lights | density 0–100 (25); size 5–200 px (60); speed 0–10 step 0.1 (1); color (#ffe0b2); seed |
| Particles | `confetti` | Confetti | density 0–100 (40); size 2–40 px (10); speed 0–10 step 0.1 (4); seed |
| Particles | `dust` | Floating Dust | density 0–100 (30); size 1–10 px (2); speed 0–10 step 0.1 (1); seed |
| Lens | `vignette` | Vignette | amount 0–100 (40); size 0–100 (50); softness 0–100 (50); color (#000000) |
| Lens | `chromatic-aberration` | Chromatic Aberration | amount 0–100 (15) |
| Lens | `lens-distortion` | Lens Distortion | barrel −100…100 (20); chromatic 0–100 (0); autoFit boolean (true) |
| Lens | `letterbox` | Letterbox | ratio select 1.85 / 2.00 / 2.35 / 2.76 (2.35); color (#000000) |
| Lens | `lens-zoom` | Lens Zoom | amount 100–400% (120); cx/cy |
| Photo | `slow-zoom` | Slow Zoom | startScale 100–300% (100); endScale 100–300% (120); cx/cy |
| Photo | `pan-drift` | Pan Drift | direction select left/right/up/down (left); distance 0–50% (10) |
| Photo | `photo-frame` | Instant Photo Frame | borderSize 0–100 (20); tilt −45…45° (3); color (#ffffff) |
| Body | `body-outline` | Body Outline | width 1–50 px (6); color (#ffffff); glow 0–100 (30) |
| Body | `body-glow` | Body Glow | intensity 0–100 (50); radius 0–100 (40); color (#7c5cff) |
| Body | `background-blur` | Background Blur | intensity 0–100 (40) |
| Body | `background-mono` | Background Mono | amount 0–100 (100) |
| Body | `body-echo` | Body Echo | copies 1–8 (4); distance 1–400 px (60); angle 0–360° (180); fade 0–100 (50) |

The library contains exactly 61 effects in 10 categories: Blur 7, Distort 9, Stylise 9, Light 6, Glitch 5, Retro 6, Particles 6, Lens 5, Photo 3, Body 5. Particle effects SHALL be procedural shader effects (no bundled video overlays). Photo-category effects `slow-zoom` and `pan-drift` SHALL interpolate across the full duration of the element they are applied to. Every effect renders from the current frame only: no effect reads an earlier or a following frame of the source (the frame-history budget of `render-engine.Body-effect matte inputs and frame history` is zero frames on every platform), which is why the former frame-history effect `body-trail` is replaced by the single-frame `body-echo`. Each effect id SHALL have one golden-frame case under `render-engine.Golden-frame determinism` rendered as a clip effect on a clip scaled to 60 % and rotated 20° (so the effect frame is exercised) and, for ids usable as a layer, a second case as a standalone effect element. A golden frame of an effect becomes normative only after a visual review against the `algorithm` text has been recorded in `docs/product/GOLDEN-REVIEW.md` with the reviewer, the commit and the SHA-256 of the shader source that produced it; CI SHALL fail when a catalogue id has no golden case, no review record, or a shader source whose hash differs from the recorded one. [PORT E-002, N-003] [CAPCUT CC-104, CC-106, CC-110] [NEW]

#### Scenario: Blur sigma
- **WHEN** Gaussian Blur with `intensity = 15` is applied to a clip on a 1920×1080 canvas
- **THEN** the blur sigma is 3 px, rendered as separable horizontal and vertical passes

#### Scenario: Every bundled effect is present offline
- **WHEN** the app starts with no network and no host connection
- **THEN** the Effects panel lists exactly 61 effects with rendered thumbnails
- **AND** the category counts are Blur 7, Distort 9, Stylise 9, Light 6, Glitch 5, Retro 6, Particles 6, Lens 5, Photo 3, Body 5

#### Scenario: Photo effect spans the element
- **WHEN** Slow Zoom (100% → 120%) is applied to an image element lasting 5 s
- **THEN** the image is at 100% at local time 0 and at 120% on the element's last frame

#### Scenario: Param boundaries
- **WHEN** the user types 500 into Twirl `angle` and −900 into the same field afterwards
- **THEN** the stored values are 500 and −720 respectively

#### Scenario: Catalogue completeness gate
- **WHEN** an effect definition is registered whose id has no `algorithm` row in `catalog.md` or no golden case
- **THEN** the `jagentchill-golden` CI job fails and names the id

#### Scenario: Shader changed after review
- **WHEN** the shader source of `lens-flare` changes and its hash no longer equals the one in `GOLDEN-REVIEW.md`
- **THEN** the `jagentchill-golden` CI job fails and names the id until a new review is recorded

#### Scenario: No effect needs frame history
- **WHEN** every one of the 61 effects is rendered for a single frame of a clip with no other frame decoded
- **THEN** each renders its full result

### Requirement: Bundled filter library
The app SHALL ship exactly the following 39 colour filters in 8 categories, written for this project and available offline. Each filter's look SHALL be defined by a **recipe** of `color-adjustment` parameters (basic values, curve points, wheel pucks, HSL values) listed per id in `catalog.md` next to this spec (section "Filters"), which is normative. A recipe is reproducible from text alone: every term it uses has a closed formula in `color-adjustment` (`color-adjustment.Basic adjustment sliders`, `color-adjustment.Colour wheels` for the puck-to-RGB mapping, `color-adjustment.Curves`, `color-adjustment.HSL per colour band`), applied in the order of `render-engine.Colour adjustment pipeline order`. The deterministic build script `scripts/bake-luts`, whose procedure is defined by `color-adjustment.LUT bake procedure`, SHALL bake each recipe into a 33×33×33 `.cube` table that ships in the app; the baked table SHALL equal the recipe rendered live through `render-engine.Colour adjustment pipeline order` within 1/255 per channel at every lattice point, and CI SHALL re-bake all 39 recipes and fail when a baked file differs from the committed file. A filter entry SHALL be rendered at the `filter` stage of `render-engine.Per-layer stage order` with the LUT sampling and intensity mix of `color-adjustment.LUT rendering`. Every filter SHALL expose exactly one param, `intensity` 0–100, step 1, default 100, keyframable, which linearly mixes the filtered colour with the unfiltered colour (0 = unfiltered, bit-exact pass-through). No filter name, recipe or thumbnail SHALL reproduce a third-party product's preset.

| Category | Filters (type id — name) |
|---|---|
| Film (6) | `amber-reel` — Amber Reel; `teal-dusk` — Teal Dusk; `silver-halide` — Silver Halide; `matinee` — Matinee; `blockbuster` — Blockbuster; `noir-classic` — Noir Classic |
| Portrait (5) | `soft-skin` — Soft Skin; `porcelain` — Porcelain; `rosy` — Rosy; `honey` — Honey; `clear-day` — Clear Day |
| Landscape (5) | `evergreen` — Evergreen; `alpine` — Alpine; `golden-hour` — Golden Hour; `deep-sea` — Deep Sea; `autumn` — Autumn |
| Food (4) | `fresh` — Fresh; `warm-plate` — Warm Plate; `crisp` — Crisp; `bistro` — Bistro |
| Night (4) | `neon-night` — Neon Night; `moonlight` — Moonlight; `city-glow` — City Glow; `midnight-blue` — Midnight Blue |
| Retro (5) | `seventies` — Seventies; `faded-print` — Faded Print; `sepia` — Sepia; `instant-warm` — Instant Warm; `cross-process` — Cross Process |
| Mono (5) | `mono` — Mono; `mono-contrast` — High Contrast B&W; `soft-grey` — Soft Grey; `blue-tone` — Blue Tone; `selenium` — Selenium |
| Style (5) | `cyber` — Cyber; `pastel` — Pastel; `bleach-bypass` — Bleach Bypass; `orange-teal` — Orange & Teal; `dream` — Dream |

[PORT N-002] [CAPCUT CC-113, CC-114] [NEW]

#### Scenario: Intensity zero is identity
- **WHEN** the filter "Mono" is applied with `intensity = 0`
- **THEN** the rendered frame is identical to the frame without the filter

#### Scenario: Intensity mixes linearly
- **WHEN** "Mono" is applied with `intensity = 50` to a pure red pixel (255, 0, 0)
- **THEN** each output channel is within 1/255 of the average of the unfiltered and fully filtered values

#### Scenario: All filters listed by category
- **WHEN** the user opens the Filters panel offline
- **THEN** 8 library categories are shown and the total number of filter tiles is exactly 39

#### Scenario: Baked table equals its recipe
- **WHEN** the build bakes `golden-hour` and the same recipe is applied live as `adjustments` to a 33-step colour lattice image
- **THEN** every lattice colour of the baked table is within 1/255 per channel of the live render

#### Scenario: Mono recipe produces greyscale
- **WHEN** "Mono" at intensity 100 is applied to the pixel (200, 40, 90)
- **THEN** the output R, G and B are equal within 1/255

#### Scenario: Wheel recipe is reproducible
- **WHEN** two engineers independently compute the lattice point (0.5, 0.5, 0.5) of `sepia` from its catalogue recipe with the formulas of `color-adjustment`
- **THEN** both obtain the same three output values to 6 decimal places, and they equal the committed table's entry

#### Scenario: Committed table differs from its recipe
- **WHEN** a recipe row of the catalogue is edited without re-baking
- **THEN** the bake check in CI fails and names the filter id

### Requirement: Effects and filters panels
The assets panel tabs "Effects" and "Filters" (tab list owned by `app-shell-navigation.Editor asset panel tabs`) SHALL each show a category strip ("All" first, then "Favourites", "Recent", then the library categories in table order; the Effects strip ends with "AI styles", see `AI style effects entry point`) and a grid of tiles. A tile SHALL be 96×96 px on desktop/web and 72×72 px on mobile, show a thumbnail and the localised name beneath it in one line with ellipsis. Thumbnails SHALL be rendered through the GPU compositor from one bundled 320×320 sample image authored for this project and recorded in `docs/product/ASSET-PROVENANCE.md` (the classic `public/effects/preview.jpg` SHALL NOT be shipped); on desktop/web, hovering a `timeDriven` tile for 300 ms SHALL animate its thumbnail in a 2 s loop. Thumbnails SHALL be rendered lazily for visible tiles only and cached for the session. While a thumbnail renders the tile SHALL show a skeleton; with `backend: "none"` (see `render-engine.Behaviour without a GPU backend`) the tile SHALL show the category icon and remain usable. The grid SHALL be keyboard navigable: arrow keys move focus, Enter applies as in `Apply an effect or filter to a clip`, and the action `library.toggle-favourite` toggles the focused tile's favourite (default binding in `keyboard-shortcuts`). Mobile entry: the root toolbar items "Effects" and "Filters" of `mobile-editor.Root toolbar` and the clip-strip items of `mobile-editor.Video clip tool strip`; this capability defines the sheet content only — the category strip and a horizontally paged tile grid with the preview visible above, in the combined Filters / Adjust sheet described by `mobile-editor.Effect, filter and adjustment bar strips`. The mobile Effects group opens this one library with one of two fixed library filters, which this capability defines: "Video effects" lists the definitions whose `requires` is empty (56 effects, including the Photo category, which on mobile is part of Video effects), and "Body effects" lists the definitions with `requires: "person-matte"` (5 effects); "AI style" opens the category of `AI style effects entry point`. On desktop and web the same two sets are reached through the category strip (Body is one category). [PORT E-001] [CAPCUT CC-104, CC-113]

#### Scenario: Category filter
- **WHEN** the user selects the "Glitch" category in the Effects tab
- **THEN** exactly the 5 Glitch effects are shown

#### Scenario: No GPU backend
- **WHEN** the engine reported `backend: "none"` for the session
- **THEN** each tile shows its category icon and name instead of a rendered thumbnail
- **AND** applying a tile still adds the effect entry to the project

#### Scenario: Mobile presentation
- **WHEN** the user taps "Effects" in the mobile root toolbar
- **THEN** a bottom sheet opens with the category strip and a horizontally paged tile grid, and the preview stays visible above the sheet

#### Scenario: Mobile library filters
- **WHEN** the user opens "Body effects" from the mobile Effects group
- **THEN** exactly the 5 effects with `requires: "person-matte"` are listed, and "Video effects" lists the other 56

### Requirement: Search effects and filters
Each panel SHALL have a search field that filters tiles by case-insensitive, diacritic-insensitive substring match against the localised name, the English name and the definition keywords. Filtering SHALL apply within 100 ms of the last keystroke and across all categories. An empty result SHALL show "No results for "{query}"" with a "Clear search" button. Clearing the field SHALL restore the previously selected category. [CAPCUT CC-111]

#### Scenario: Keyword match
- **WHEN** the user types "defocus" in the Effects search field
- **THEN** "Gaussian Blur" is listed (keywords: blur, soft, defocus)

#### Scenario: No results
- **WHEN** the user types "zzzz"
- **THEN** the grid is replaced by the empty state with the query text and a "Clear search" button

### Requirement: Favourites and recents
The user SHALL be able to mark any effect or filter as a favourite with a star toggle on its tile (shown on hover on desktop/web, via long-press menu on mobile). Favourites SHALL be stored in user preferences on the device (`project-storage.UI preference storage`), synchronised to paired devices through `cross-device-sync.Library item sync`, and listed under the "Favourites" category in the order they were added, at most 500 per kind (the star is refused beyond that with "Favourites limit reached (500)"). The "Recent" category SHALL list the 20 most recently applied items, newest first, per kind. Empty Favourites SHALL show "Star an effect to keep it here"; empty Recent SHALL show "Effects you apply appear here". [NEW]

#### Scenario: Favourite persists across restart
- **WHEN** the user stars "VHS Tape", closes and reopens the app
- **THEN** "VHS Tape" is listed under Favourites with a filled star

#### Scenario: Recent list is capped
- **WHEN** the user applies 21 different effects in sequence
- **THEN** Recent shows 20 tiles and the first-applied effect is no longer listed

### Requirement: Apply an effect or filter to a clip
On desktop/web the user SHALL be able to apply an effect or filter to a clip by (a) dragging a tile onto a clip in the timeline, where clips whose type is in the definition's `targets` highlight with the `timeline/selection` outline of `design-system.Timeline atoms` and other clips show a not-allowed cursor; (b) dragging a tile onto an element in the preview; or (c) clicking a tile, or pressing Enter on a focused tile, while one or more elements are selected, which applies it to every selected element whose type is in `targets` as one undo step and skips the others with the toast "{n} clips skipped (not supported by this effect)". A click with no timeline selection creates a standalone layer (`Standalone effect layer`, `Filter layer and clip filter conversion`). On mobile the user SHALL select a clip, open its "Effects" or "Filters" tool (entries owned by `mobile-editor.Video clip tool strip`) and tap a tile; a tap previews the tile live, a second tap on the same tile opens its params, and the sheet's ✓ commits one undo step while ✕ discards, as defined by `mobile-editor.Tool sheets never cover the preview`. Applying SHALL be one undoable command, SHALL keep the target selected and SHALL open the clip's Effects inspector tab. [PORT E-003] [CAPCUT CC-108, CC-115]

#### Scenario: Drag onto a compatible clip
- **WHEN** the user drags "Glow" onto a video clip and drops it
- **THEN** the clip gains a Glow entry at the end of its stack and the Effects inspector tab opens with the Glow params visible

#### Scenario: Click with clips selected
- **WHEN** two video clips and one text element are selected and the user clicks the "Body Glow" tile
- **THEN** both video clips gain a Body Glow entry, the text element is unchanged, the toast reads "1 clips skipped (not supported by this effect)", and one undo removes both entries

#### Scenario: Incompatible target
- **WHEN** the user drags a Body effect over a text element
- **THEN** the text element does not highlight and dropping does nothing

#### Scenario: Undo apply
- **WHEN** the user presses undo after applying an effect
- **THEN** the entry is removed and the stack is restored to its prior content and order

#### Scenario: Mobile discard
- **WHEN** the user taps "Glow" in the clip's Effects sheet and then taps ✕
- **THEN** the clip has no Glow entry and no undo step was recorded

### Requirement: Standalone effect layer
Clicking an effect tile with no timeline selection (desktop/web), or tapping a tile from the root "Effects" toolbar with no clip selected (mobile), SHALL insert an element of type `effect` at the playhead with the default effect-element duration (5 s; the value is the preference of `settings-preferences.Editing default preferences`), placed by strategy `firstAvailable` among tracks of type `effect` (`timeline-editing.Placement strategies`), else on a new `effect` track created at the index defined by `timeline-editing.Track creation and insert index`. An effect element has the stored shape of `project-document.Effect element` (exactly one entry in `effects[]`, `target: "beneath"`); it SHALL apply that entry to the composite of every track beneath it for its time range, SHALL be movable, trimmable without source limits, splittable, duplicable and deletable like other elements, and its inspector SHALL show the entry's params only (no stack list). Hiding the effect track or the element SHALL disable it. Body effects (`requires: "person-matte"`) SHALL NOT be offered as effect layers: with nothing selected, a click on a Body tile on desktop and web shows the toast of the scenario below, and a tap on a Body tile on mobile applies the effect to the main-track video or image clip under the playhead (selecting it first) or shows the same toast when there is none. Effect elements take no masks, adjustments, transitions, retime or clip animation. [PORT E-004] [CAPCUT CC-109]

#### Scenario: Effect layer affects layers beneath only
- **WHEN** a Mosaic effect layer sits on a track between two overlay tracks
- **THEN** the lower overlay and the main track are pixelated and the upper overlay is not

#### Scenario: Effect layer outside its range
- **WHEN** the playhead is 1 frame after the effect element's end
- **THEN** the frame is rendered without the effect

#### Scenario: Insert with no room on existing effect track
- **WHEN** the only effect track already has an element overlapping the insertion range
- **THEN** a new effect track is created at the index given by `timeline-editing.Track creation and insert index` and the element is placed there

#### Scenario: Body effect is not offered as a layer
- **WHEN** nothing is selected and the user clicks the "Background Blur" tile
- **THEN** no element is created and a toast reads "Select a video or image clip to use body effects"

#### Scenario: Body effect tapped on mobile with nothing selected
- **WHEN** nothing is selected on a phone, the playhead is over a main-track video clip and the user taps "Body Glow"
- **THEN** that clip is selected and gains a Body Glow entry, and no effect element is created

### Requirement: Filter layer and clip filter conversion
Clicking a filter tile with no selection SHALL insert an element of type `effect` whose single entry has `kind: "filter"`, with the same placement, duration, trimming and stacking rules as `Standalone effect layer`; in the UI it is labelled "Filter" and drawn with the filter icon, and it applies to all layers beneath it. The user SHALL be able to remove a clip filter from the clip's Effects tab or with "Remove filter" in the clip context menu. A selected standalone effect element (effect or filter kind) SHALL offer a "Target" control with options "All layers beneath" (default) and "Clip…"; choosing a clip SHALL convert the layer into a clip entry on that clip (copying params and keyframes, dropping keyframes after the clip's duration; subject to the 16-entry and one-filter limits, a filter replacing the clip's existing filter) and delete the layer in one undo step. [CAPCUT CC-109, CC-115] [NEW]

#### Scenario: Filter layer is an effect element
- **WHEN** the user clicks "Sepia" with nothing selected
- **THEN** the project gains one element with `type: "effect"` on a track with `type: "effect"`, whose `effects` array holds exactly one entry with `type: "sepia"`, `kind: "filter"`, `enabled: true` and `params: {intensity: 100}`, and whose `target` is `"beneath"`

#### Scenario: Remove filter from clip
- **WHEN** the user chooses "Remove filter" on a clip that has the filter "Sepia"
- **THEN** the filter entry is removed and the other effects keep their order

#### Scenario: Convert layer to clip filter
- **WHEN** the user sets Target of a 4 s standalone filter to a clip that lasts 2 s
- **THEN** the clip gains the filter with the same intensity, keyframes after 2 s are dropped, and the standalone element is deleted
- **AND** one undo restores the standalone element and removes the clip filter

#### Scenario: Target clip is full
- **WHEN** the chosen clip already has 16 entries and the layer holds an effect
- **THEN** the conversion is refused with the toast "This clip already has 16 effects. Remove one to add another." and the layer is unchanged

### Requirement: Apply filter to all clips
The clip filter section SHALL offer "Apply to all", which sets the same filter type and intensity (not keyframes) on every video, image and compound element in the current scene's main and overlay tracks, replacing any existing filter on those elements. The action SHALL show a confirm dialog stating the number of affected clips and SHALL be a single undo step. Elements on locked tracks SHALL be skipped and counted in the dialog as "skipped (locked)". [CAPCUT CC-116] [NEW]

#### Scenario: Apply to all
- **WHEN** a scene has 12 eligible clips, 2 on a locked track, and the user confirms "Apply to all" for "Golden Hour" at intensity 70
- **THEN** 10 clips have the filter "Golden Hour" with intensity 70 and the 2 locked clips are unchanged

#### Scenario: Single undo
- **WHEN** the user presses undo once after "Apply to all"
- **THEN** all 10 clips return to their previous filter state

### Requirement: Clip effects list
The Effects inspector tab of a clip (tab table: `preview-canvas.Inspector structure per element type`) SHALL list the stack top-to-bottom in render order. Each row SHALL have: a drag handle, the effect name, an eye toggle for `enabled` (a disabled row renders at 50% opacity), a reset button, a delete button and a collapsible param section. Rows SHALL be reorderable by drag with a 2 px primary drop indicator, and by keyboard with Alt+Up / Alt+Down on a focused row. Toggle, remove, reorder and reset SHALL each be one undoable command. With an empty stack the tab SHALL show "No effects" and an "Open effects" button that switches the assets panel to the Effects tab. On mobile the list SHALL appear in a bottom sheet (mobile entry: see `mobile-editor.Video clip tool strip`) and reordering SHALL use a 400 ms long-press drag. [PORT E-005, E-006, E-007] [CAPCUT CC-112]

#### Scenario: Disable an effect
- **WHEN** the user clicks the eye toggle of an enabled effect
- **THEN** the entry's `enabled` becomes false, the row dims to 50% opacity and the preview renders without that effect

#### Scenario: Reorder by drag
- **WHEN** the user drags the third row above the first
- **THEN** the array order becomes `[third, first, second]` and the preview updates
- **AND** undo restores `[first, second, third]`

#### Scenario: Empty state
- **WHEN** a clip with no effects is selected and its Effects tab is opened
- **THEN** "No effects" and an "Open effects" button are shown, and pressing the button activates the assets panel Effects tab

### Requirement: Effect parameter editing
Each param SHALL render as: slider plus number field (number), switch (boolean), colour picker (color) or select (select). Number fields SHALL accept typed values and arithmetic expressions, snap to step and clamp to range. While a slider is dragged or a field is being typed in, the preview SHALL update through the render-only preview layer at interactive rate, and the change SHALL be committed as one undo step on release or blur; Escape during a drag SHALL discard the preview. Double-clicking a slider thumb or pressing the row's reset button SHALL restore the default. Sliders SHALL be operable by keyboard: arrow keys change by one step, Shift+arrow by ten steps. [PORT E-008] [CAPCUT CC-110]

#### Scenario: Live preview then one undo step
- **WHEN** the user drags Glow `intensity` from 40 to 85 in a single drag
- **THEN** the preview updates continuously during the drag
- **AND** after release a single undo returns the value to 40

#### Scenario: Escape cancels a drag
- **WHEN** the user presses Escape while still dragging the slider
- **THEN** the value returns to 40 and no undo step is recorded

### Requirement: Keyframable effect parameters
Every keyframable effect and filter param SHALL show a keyframe toggle and SHALL animate on the path `effects.<effectId>.params.<key>` with linear, hold and bezier interpolation as defined in `keyframe-animation.Interpolation types`. Colour params SHALL interpolate in linear RGB. When a param has keyframes, editing it SHALL write a keyframe at the playhead. Removing an effect SHALL remove its animation channels in the same command, and undo SHALL restore both. Standalone effect elements (effect or filter kind) SHALL support the same keyframing on the same path, `effects.<effectId>.params.<key>`, where `<effectId>` is the id of the element's single entry; the path `params.<key>` does not exist on an effect element (`project-document.Animatable property paths`, group 5). Keyframes are stored in the element's `animations` store (`project-document.Animation store`). [PORT E-009] [CAPCUT CC-092]

#### Scenario: Animate blur intensity
- **WHEN** a Gaussian Blur has keyframes intensity 0 at local 0 s and 100 at local 2 s with linear interpolation
- **THEN** at local 1 s the resolved intensity is 50

#### Scenario: Bezier easing on an effect param
- **WHEN** the user applies the "Ease out" preset to that segment
- **THEN** the segment is stored as bezier and the resolved intensity at local 1 s is greater than 50

#### Scenario: Removing the effect removes its channels
- **WHEN** the animated effect is removed and the project is saved
- **THEN** the element's animations contain no path starting with `effects.<that id>.`

#### Scenario: Keyframe on an effect layer
- **WHEN** the user adds a keyframe on the intensity of a standalone Gaussian Blur layer whose entry id is `e7`
- **THEN** the effect element's `animations` contain the path `effects.e7.params.intensity` and no path beginning `params.`

### Requirement: Body effects use the on-device person matte
Effects with `requires: "person-matte"` SHALL consume the per-frame person matte that `ai-editing-tools.Person matte for body effects` produces; that requirement owns the model (`seg-person` for video and for images), when the matte job is started, where it runs, its progress, its cache and the over-limit refusal, and it does so without changing the element's `cutout`. This capability defines what the effect does with the matte. Applying a body effect (tile, paste, preset, template or `jc_effect_apply`) SHALL request the matte for the element's visible source range through that requirement in the same command that adds the entry; the entry is added at once and the job result is a cache artefact (no document field, no undo step). The engine SHALL hand the matte to the effect as a texture input of its shader passes: each pass of a body effect declares the input `matte`, which the engine binds from `layer.personMatte` through `EffectPass.textures.matte` as defined by `render-engine.Body-effect matte inputs and frame history`. The matte SHALL be upsampled from its stored resolution to the layer texture with joint bilateral upsampling guided by the frame's luma (spatial radius 4 matte pixels, range sigma 0.1) and is evaluated in the effect frame of `Resolution-independent effect parameters`. Body effects SHALL be offered for video and image elements only, and all five accept both. While the matte for the current frame is not yet computed, the effect SHALL render as pass-through for that frame and the clip SHALL show a progress indicator with the percentage of frames analysed. Export SHALL NOT wait without bound: the export pre-flight of `export-share.Pre-flight validation` lists a clip whose body-effect matte is incomplete with "Wait for processing" (the analysis continues and the row clears when it completes) and offers "Export without body effects on this clip", which renders those entries as pass-through for that export only. When the person model cannot be loaded on the device and no host with `host-analysis` is connected, Body tiles SHALL be disabled with the tooltip "Body effects need the on-device person model, which is not available on this device"; where `ai-editing-tools.Person matte for body effects` refuses the clip (over the on-device duration limit with no host), the tile action SHALL add nothing and show that requirement's message. No effect in the library SHALL depend on face landmarks or on any frame other than the current one. [CAPCUT CC-105] [NEW]

#### Scenario: Background blur keeps the person sharp
- **WHEN** Background Blur at intensity 40 is applied to a clip with a fully analysed matte on a 1920×1080 canvas
- **THEN** pixels where the matte is ≥ 0.5 are unblurred and pixels where the matte is 0 are blurred with sigma 8 px

#### Scenario: Matte still computing
- **WHEN** only 30% of the clip's frames have a matte and the playhead is on an unanalysed frame
- **THEN** the frame renders without the body effect and the clip shows "Analysing 30%"

#### Scenario: Model unavailable
- **WHEN** the device reports that the person model cannot be loaded and no host with `host-analysis` is connected
- **THEN** Body tiles are disabled with the stated tooltip and existing body effect entries render as pass-through with a warning icon in the effects list

#### Scenario: Body effect on a clip that is not cut out
- **WHEN** Background Mono is applied to a video clip whose `cutout.mode` is `none`
- **THEN** a person-matte analysis starts for the clip's visible source range, `cutout.mode` stays `none`, the clip is not cut out, and one undo removes the entry

#### Scenario: Body effect on an image
- **WHEN** Body Echo is applied to an image element showing a person
- **THEN** the person matte is computed for the still with `seg-person` and the echo copies are drawn behind the person

#### Scenario: Export with an incomplete matte
- **WHEN** an export is started while a body-effect matte is 40 % analysed
- **THEN** the pre-flight lists the clip with "Wait for processing" and "Export without body effects on this clip", and the export starts only after the row clears or the user chooses that option

### Requirement: AI style effects entry point
The Effects panel SHALL include an "AI styles" category that is an entry point only. Its tiles, their ids, names, prompt templates, strength parameter, input limits, model routing, cost estimate, consent and job lifecycle are defined by `ai-editing-tools.Restyle` (tool id `restyle`, a fixed catalogue of 8 project-authored styles); this capability SHALL render one tile per style returned by that catalogue, in catalogue order, and SHALL NOT define styles of its own. Tapping or clicking a tile with one video or image clip selected SHALL open the restyle flow with that clip and style preselected. The category SHALL be visible on all platforms and requires a connected host with the `image` (stills) or `video` (clips) role routed per `orc-model-routing.Role catalogue`; with no host the category SHALL show "Connect a host to use AI styles" with a button opening the connection settings, and with a host but no route the message "Set up an image or video model to use AI styles" with a button to the ORC settings. The result of a job arrives as a new media asset that replaces the clip's source non-destructively with "Restore original"; it is never an entry in the `effects` array. [CAPCUT CC-107] [NEW]

#### Scenario: No host
- **WHEN** the user opens "AI styles" with no host connection
- **THEN** the category shows the connect message and button and no job can be started

#### Scenario: Entry point hands off
- **WHEN** a host is connected and the user picks the third AI style tile for a selected clip
- **THEN** the `ai-editing-tools.Restyle` flow opens with that clip and the third catalogue style preselected, and the `effects` array of the clip is unchanged

#### Scenario: Tiles come from the catalogue
- **WHEN** the AI styles category is opened with a connected host
- **THEN** it lists exactly the 8 styles of `ai-editing-tools.Restyle` in catalogue order

### Requirement: Motion blur
The stored field `motionBlur {enabled, strength, samples}`, its ranges, defaults and the element types that carry it are defined only by `project-document.Motion blur and clip animation fields` (strength 0–100, default 50, keyframable on `motionBlur.strength`; samples 4 / 8 / 16, default 8, static); this capability defines its meaning. When enabled, the `motion-blur` stage of `render-engine.Per-layer stage order` averages `samples` copies of the layer drawn with the element's own animated motion (keyframed transform composed with the clip-animation transform) over a shutter interval of `shutter = strength / 100 × 1 frame` that ENDS at the frame time `t` (a trailing shutter, so the frame never shows motion that has not happened yet and no following transform is needed): the editor resolves the element's transform at `t − shutter` and at `t` and passes them as `motionBlur {samples, shutter, previous}` of `render-engine.FrameDescriptor schema`, and copy `k` (`k = 0 … samples − 1`) is drawn with the transform interpolated linearly between the two at the fraction `k / (samples − 1)`. A time before the element's start uses the transform at local time 0. An element whose transform does not change within the shutter interval SHALL render unchanged. Motion blur SHALL NOT synthesise blur for motion inside the source video. The control SHALL be in the Animation inspector tab (desktop/web) and in the mobile sheet reached from the "Motion blur" item of `mobile-editor.Video clip tool strip`: a switch, the Strength slider and the Samples select; edits preview live and commit one undo step. [CAPCUT CC-098] [NEW]

#### Scenario: Moving element is blurred along its path
- **WHEN** an image moves 200 px per frame horizontally with motion blur strength 50 and 16 samples
- **THEN** the image is smeared horizontally across 100 ± 5 px and is not smeared vertically

#### Scenario: Static element unchanged
- **WHEN** motion blur is enabled on an element with no animation
- **THEN** the rendered frame equals the frame with motion blur disabled

#### Scenario: Strength zero
- **WHEN** motion blur is enabled with strength 0 on a moving element
- **THEN** the rendered frame equals the frame with motion blur disabled

#### Scenario: Trailing shutter
- **WHEN** an image starts moving right at 200 px per frame on frame 10 and frame 10 is rendered with strength 100
- **THEN** the smear extends only to the left of the image's position at frame 10 (toward where it came from) and nothing is drawn to the right of it

### Requirement: Timeline affordances for effects and filters
A clip that has at least one enabled entry in `effects` SHALL show a wand button in its header; clicking it SHALL select the clip and open the Effects inspector tab. Standalone effect elements SHALL render as bars with the bar-track height of `timeline-editing.Track header column and row dimensions` and the `clip/effect` colour token of `design-system.Editor colour tokens`, with a wand icon (effect kind) or a three-circles icon (filter kind) and the localised name; a selected bar SHALL show trim handles on both ends. This capability defines the behaviour of two bar actions: "Replace" opens the library of the bar's kind and swaps the entry's `type` while keeping the element's time range (params reset to the new type's defaults; a filter keeps `intensity`), as one undo step; "Target" is the control of `Filter layer and clip filter conversion`. The mobile strip shown when a bar is selected, its items and their order are owned by `mobile-editor.Effect, filter and adjustment bar strips`. [PORT E-004] [CAPCUT CC-109, CC-115] [NEW]

#### Scenario: Wand button
- **WHEN** a clip has one enabled effect
- **THEN** its header shows a wand button, and clicking it selects the clip and opens the Effects tab

#### Scenario: Replace keeps the range
- **WHEN** the user chooses Replace on a 3 s effect bar and picks "Rain"
- **THEN** the bar still starts and ends at the same times, its entry type is `rain` and its params are Rain's defaults

#### Scenario: Replace a filter keeps intensity
- **WHEN** the user chooses Replace on a filter bar at intensity 60 and picks "Mono"
- **THEN** the entry type is `mono` and `intensity` is still 60

### Requirement: Effect performance budget
With up to 4 enabled clip effects on a single 1080p layer, preview playback of a 30 fps project SHALL sustain at least 24 rendered frames per second on the reference desktop device and at least 20 on the reference mobile devices named in `diagnostics-quality.Performance budgets`, at the preview quality chosen by `render-engine.Preview resolution scaling`. This capability defines no automatic quality trigger of its own: lowering of preview resolution and the single "Reduced preview quality" chip are owned by `render-engine.Preview resolution scaling` and `preview-canvas.Preview quality`; export SHALL always render at full resolution. Intermediate textures for effect passes SHALL be taken from `render-engine.Render-target pool` and reused across frames. [NEW]

#### Scenario: Four effects on the reference desktop
- **WHEN** a 1080p clip with Glow, RGB Split, Film Grain and Vignette plays for 10 s on the reference desktop device in a 30 fps project
- **THEN** at least 240 frames are rendered

#### Scenario: Export is full resolution
- **WHEN** the preview is running at half resolution and the user exports a 1920×1080 project
- **THEN** every exported frame is rendered at 1920×1080

### Requirement: Copy effects between clips
The clip context menu SHALL offer "Copy effects" and "Paste effects". Paste SHALL append deep copies of the copied entries (new ids, params, enabled state and animation channels) to each selected compatible element, subject to the 16-entry and one-filter limits; entries that do not fit SHALL be skipped and reported in a toast as "{n} effects not pasted (limit reached)". The broader attribute paste dialog is defined in `color-adjustment.Copy and paste attributes`. Keyframes whose time is after the target's duration SHALL be dropped, as in `keyframe-animation.Copy and paste keyframes`. [NEW]

#### Scenario: Paste onto several clips
- **WHEN** 2 effects are copied and pasted onto 3 selected clips
- **THEN** each clip gains 2 entries with ids different from the source and from each other
- **AND** one undo removes all 6 entries

### Requirement: Effect and filter presets
The param section of a clip effect row and of a standalone effect element SHALL offer "Save as preset". A preset SHALL store `{name, type, kind, params}` (parameter values only — no keyframes, no `enabled` state), with `name` 1–60 characters, unique per `type`, auto-suffixed " (2)" on collision. Presets SHALL be stored in user preferences on the device, synchronised through `cross-device-sync.Library item sync`, exportable in a preset pack (`templates.Preset packs`), and limited to 200 in total; saving beyond that SHALL be refused with "Preset limit reached (200)". In the Effects and Filters panels a "My presets" category SHALL list them after "Recent" with the base definition's thumbnail rendered with the preset's params; applying a preset behaves as applying its base tile and then writing its params, as one undo step. A preset whose `type` is not registered SHALL be listed disabled with "Unavailable effect". Rename and delete (with confirm) SHALL be offered from the tile menu. [NEW]

#### Scenario: Save and apply
- **WHEN** the user saves a Glow with intensity 80 and radius 55 as "Soft bloom" and applies "Soft bloom" to another clip
- **THEN** that clip gains a Glow entry with intensity 80 and radius 55 and every other param at its default, as one undo step

#### Scenario: Keyframes are not stored
- **WHEN** the saved effect had keyframes on `intensity`
- **THEN** the preset stores the value resolved at the playhead and applying it creates no keyframes

#### Scenario: Limit
- **WHEN** 200 presets exist and the user chooses "Save as preset"
- **THEN** nothing is saved and the message "Preset limit reached (200)" is shown
