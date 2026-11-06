## ADDED Requirements

### Requirement: Adjustment data model
The stored shape of `adjustments` — its five sections `lut`, `basic`, `wheels`, `curves` and `hsl`, every key, range and default, and the element types that carry it — is defined only by `project-document.Colour adjustments` and `project-document.Element types and field applicability`; this capability restates no field shape and defines the meaning of each value, the UI and the commands. The stored key names are also the names used by `jc_color_adjust`. Video, image, compound, sticker and graphic elements and adjustment-layer elements are the adjustable element types. Each section SHALL have an `enabled` boolean (default `true`) and its own values; an absent `adjustments` object or an absent section SHALL mean identity. Text, caption, effect (effect or filter kind) and audio elements SHALL NOT have adjustments. This capability defines parameters, ranges, defaults, UI and data only: the order in which the sections and the spatial sliders are applied is defined solely by `render-engine.Colour adjustment pipeline order` (LUT, basic, wheels, curves, HSL, then the spatial pass), and the position of colour processing within a layer by `render-engine.Per-layer stage order`. A section whose values are all at default, or whose `enabled` is false, SHALL be skipped by the renderer and SHALL leave pixels bit-exact. Projects migrated from OpenCut classic SHALL load with no `adjustments`. [PORT X-002, N-002] [NEW]

#### Scenario: Default is identity
- **WHEN** an element has an `adjustments` object with every value at its default
- **THEN** its rendered pixels equal those rendered with no `adjustments` object

#### Scenario: Section toggle
- **WHEN** the user turns off the `curves` section on an element with a strong S-curve
- **THEN** the preview renders without the curve, the curve points are still stored, and turning it on again restores the look

#### Scenario: Ineligible element
- **WHEN** a text element is selected
- **THEN** the inspector shows no Adjustment tab

#### Scenario: Stored key names
- **WHEN** the user sets Sharpness to 30 and the Blue band's Lightness to −20 and the project is saved
- **THEN** the element stores `adjustments.basic.sharpness = 30` and `adjustments.hsl.blue.lightness = −20`

### Requirement: Basic adjustment sliders
The `basic` section SHALL expose the following 17 sliders. All are integers with step 1, default 0, keyframable. The "Meaning" column defines each parameter for a value `p = slider / 100` (Hue uses degrees); `v` is a display-referred Rec.709 channel value in 0…1, `L` the Rec.709 luma of the pixel (0.2126 R + 0.7152 G + 0.0722 B), "linear" means the value decoded with the sRGB EOTF (the piecewise sRGB transfer function) and re-encoded with its inverse after the operation — the transfer convention of `render-engine.Colour adjustment pipeline order` — `s` the pixel scale factor of `visual-effects-filters.Resolution-independent effect parameters`, and results are clamped to 0…1 only at the end of the chain. The order of application is not defined here (see `Adjustment data model`).

| Slider (key) | Range | Meaning |
|---|---|---|
| Exposure (`exposure`) | −100…100 | linear `rgb × 2^(2p)` (−2…+2 stops) |
| Brightness (`brightness`) | −100…100 | `v + 0.25p × 4v(1 − v)` (black and white points fixed) |
| Contrast (`contrast`) | −100…100 | `0.5 + (v − 0.5) × 2^p` (factor 0.5…2.0 about mid-grey) |
| Saturation (`saturation`) | −100…100 | `L + (rgb − L) × (1 + p)` (−100 = Rec.709 greyscale, +100 = 2× chroma) |
| Vibrance (`vibrance`) | −100…100 | `L + (rgb − L) × (1 + p × (1 − S))`, `S = (max − min) / max` of the pixel (0 when `max = 0`) |
| Highlights (`highlights`) | −100…100 | `rgb + 0.25p × smoothstep(0.25, 0.75, L) × 4L(1 − L)` (no change at or below L = 0.25) |
| Shadows (`shadows`) | −100…100 | `rgb + 0.25p × (1 − smoothstep(0.25, 0.75, L)) × 4L(1 − L)` (no change at or above L = 0.75) |
| Whites (`whites`) | −100…100 | `v × (1 + 0.2p)` (white point moves by ±0.2) |
| Blacks (`blacks`) | −100…100 | `v + 0.2p × (1 − v)` (black point moves by ±0.2, white fixed) |
| Temperature (`temperature`) | −100…100 | linear `R × (1 + 0.3p)`, `B × (1 − 0.3p)`, then all channels rescaled so linear luma is unchanged (−100 cooler/blue, +100 warmer/amber) |
| Tint (`tint`) | −100…100 | linear `G × (1 − 0.3p)`, then rescaled so linear luma is unchanged (−100 green, +100 magenta) |
| Hue (`hue`) | −180…180 | rotation of the chroma vector `rgb − L` about the grey axis by that many degrees |
| Sharpness (`sharpness`) | 0…100 | unsharp mask `v + 2p × (v − gauss(v, sigma 1.5 × s px))` |
| Clarity (`clarity`) | −100…100 | local contrast `v + p × (v − gauss(v, sigma 40 × s px)) × 4L(1 − L)` |
| Fade (`fade`) | 0…100 | `v × (1 − 0.25p) + 0.25p` (black lifts toward 0.25, white fixed) |
| Vignette (`vignette`) | −100…100 | `v × (1 + 0.6p × smoothstep(0.5, 1.0, r))`, `r` = distance from the frame centre divided by the half diagonal (negative darkens corners) |
| Grain (`grain`) | 0…100 | adds monochrome Gaussian noise of standard deviation `0.12p`, cell size `1.5 × s` px, generated from `hash(frameIndex, cellX, cellY)` only |

Sharpness, Clarity, Fade, Vignette and Grain form the spatial pass of `render-engine.Colour adjustment pipeline order`. [PORT X-002, N-002] [CAPCUT CC-117, CC-118, CC-119, CC-120, CC-121, CC-122, CC-123, CC-124, CC-125] [NEW]

#### Scenario: Exposure plus one stop
- **WHEN** Exposure is 50 on a mid-grey pixel of linear value 0.18
- **THEN** the linear output is 0.36 (within 1%)

#### Scenario: Brightness keeps black and white
- **WHEN** Brightness is 100
- **THEN** a pixel at 0.5 renders at 0.75, and pixels at 0 and 1 are unchanged (each within 1/255)

#### Scenario: Contrast maximum
- **WHEN** Contrast is 100
- **THEN** a pixel at 0.75 renders at 1.0 and a pixel at 0.5 is unchanged (within 1/255)

#### Scenario: Saturation minimum is greyscale
- **WHEN** Saturation is −100 on a pure red pixel
- **THEN** R, G and B outputs are equal (within 1/255)

#### Scenario: Vibrance spares saturated colours
- **WHEN** Vibrance is 100
- **THEN** a pure red pixel (1, 0, 0) is unchanged and the pixel (0.6, 0.5, 0.5) renders with R = 0.666 ± 0.004

#### Scenario: Highlights
- **WHEN** Highlights is 100
- **THEN** a grey pixel at 0.75 renders at 0.9375 ± 0.004 and a grey pixel at 0.25 is unchanged

#### Scenario: Shadows
- **WHEN** Shadows is 100
- **THEN** a grey pixel at 0.25 renders at 0.4375 ± 0.004 and a grey pixel at 0.75 is unchanged

#### Scenario: Whites
- **WHEN** Whites is −100
- **THEN** a pixel at 1.0 renders at 0.8 and a pixel at 0 is unchanged (within 1/255)

#### Scenario: Blacks
- **WHEN** Blacks is 100
- **THEN** a pixel at 0 renders at 0.2 and a pixel at 1.0 is unchanged (within 1/255)

#### Scenario: Temperature warms and keeps luma
- **WHEN** Temperature is 100 on a neutral grey pixel
- **THEN** the linear output has R > G > B and its linear luma is within 0.5 % of the input's

#### Scenario: Tint toward magenta
- **WHEN** Tint is 100 on a neutral grey pixel
- **THEN** the linear output has R = B (within 1/255) and G below both

#### Scenario: Hue rotation
- **WHEN** Hue is 180 on a pure red pixel
- **THEN** the output has G = B (within 1/255) and R below both, and a neutral grey pixel is unchanged for any Hue value

#### Scenario: Sharpness on a flat area and on an edge
- **WHEN** Sharpness is 100 on a frame whose left half is 0.25 and right half is 0.75
- **THEN** pixels more than 8 × s px from the edge are unchanged and the brightest pixel beside the edge is above 0.75

#### Scenario: Clarity leaves flat areas
- **WHEN** Clarity is 100 on a uniform 0.5 grey frame
- **THEN** every pixel is unchanged (within 1/255)

#### Scenario: Fade
- **WHEN** Fade is 100
- **THEN** a black pixel renders at 0.25 and a white pixel at 1.0 (within 1/255)

#### Scenario: Vignette darkens corners only
- **WHEN** Vignette is −100 on a uniform 0.5 grey frame
- **THEN** the centre pixel is 0.5 and the corner pixel is 0.2 (within 1/255)

#### Scenario: Grain is deterministic
- **WHEN** the same frame is rendered twice with Grain 50
- **THEN** the two renders are pixel-identical, and a frame with a different frame index has a different noise pattern

#### Scenario: Range clamp
- **WHEN** the user types 250 into Contrast and −250 into Hue
- **THEN** the stored values are 100 and −180

### Requirement: Adjustment slider control behaviour
Every adjustment slider SHALL show its label, a track with a centre detent for bipolar ranges, and a numeric field. Dragging SHALL preview live and commit one undo step on release; Escape during a drag SHALL discard it. Double-click on the thumb or label SHALL reset the slider to its default. With the slider focused, Left/Right SHALL change the value by 1 and Shift+Left/Right by 10. Bipolar sliders SHALL snap to 0 when dragged within ±2 of it unless Shift is held. Each slider row SHALL show a keyframe toggle as defined in `keyframe-animation.Keyframe toggle in the properties panel`. On mobile the Adjust tab of the sheet (mobile entry: see `Adjustment tab layout`) SHALL show the sliders as a horizontally scrolling row of icon buttons with one large slider above for the selected item, a dot under each icon whose value is non-default, and haptic feedback at 0. [NEW]

#### Scenario: Snap to zero
- **WHEN** the user drags Temperature and releases at a raw position of +1 without Shift
- **THEN** the stored value is 0

#### Scenario: Double-click reset
- **WHEN** Contrast is 35 and the user double-clicks its thumb
- **THEN** Contrast becomes 0 as one undo step

#### Scenario: Mobile non-default dot
- **WHEN** Brightness is 12 and all other sliders are 0 on mobile
- **THEN** only the Brightness icon shows the dot

### Requirement: Auto adjust
The Adjustment tab SHALL offer "Auto adjust". It SHALL analyse on-device up to 12 frames sampled evenly across the element's visible range at 256 px on the long edge (1 frame for images), compute luma percentiles and average chromaticity, and set: Blacks and Whites so the 0.5th and 99.5th luma percentiles map to 0.02 and 0.98; Exposure so median luma reaches 0.45, limited to ±50; Contrast so that the spread between the 10th and the 90th luma percentile reaches 0.55 (solved with the Contrast formula of `Basic adjustment sliders` after the Exposure, Blacks and Whites values are applied), limited to ±30; Temperature and Tint so that the mean linear R, G and B of the analysed frames become equal (grey-world), limited to ±40; Saturation so that the mean HSL saturation of the pixels whose saturation is above 0.1 reaches 0.35, limited to ±20 (0 when no pixel is above 0.1). The values are solved in that order, each on the frames with the previous values applied, and rounded to integers. Other values SHALL be left untouched. The result SHALL be deterministic for the same input, applied as one undo step, and need no network. While analysing, the button SHALL show a spinner and be disabled; analysis SHALL complete within 3 s for a 1080p clip on the reference desktop device of `diagnostics-quality.Performance budgets`. A strength slider 0–100 (default 100, stored as `adjustments.basic.autoStrength`) SHALL appear after applying and SHALL scale all auto-set values proportionally. [CAPCUT CC-126] [NEW]

#### Scenario: Underexposed clip
- **WHEN** Auto adjust runs on a clip whose median luma is 0.15
- **THEN** afterwards either the median luma of the analysed frames rendered with the new values is within 0.45 ± 0.05, or Exposure equals 50

#### Scenario: Deterministic
- **WHEN** Auto adjust is run, undone and run again on the unchanged clip
- **THEN** the same slider values are produced

#### Scenario: Decode failure
- **WHEN** no frame of the clip can be decoded
- **THEN** no value changes and a toast reads "Couldn't analyse this clip"

#### Scenario: Strength scales the result
- **WHEN** Auto adjust set Exposure to 40 and Contrast to 20 and the user moves the strength slider to 50
- **THEN** Exposure is 20 and Contrast is 10

#### Scenario: Flat clip gains contrast
- **WHEN** Auto adjust runs on a clip whose 10th and 90th luma percentiles are 0.40 and 0.60
- **THEN** afterwards either the percentile spread of the analysed frames rendered with the new values is 0.55 ± 0.03, or Contrast equals 30

#### Scenario: Greyscale clip
- **WHEN** Auto adjust runs on a clip with no pixel whose saturation is above 0.1
- **THEN** Saturation stays 0

### Requirement: HSL per colour band
The `hsl` section SHALL provide eight bands — `red` (centre 0°), `orange` (30°), `yellow` (60°), `green` (120°), `aqua` (180°), `blue` (240°), `purple` (270°), `magenta` (300°) — each with Hue −100…100 (mapped to ±30° of hue shift), Saturation −100…100 (chroma factor `1 + p`) and Lightness −100…100 (adds `0.25p` to lightness); all integers, step 1, default 0, keyframable. Hue, saturation and lightness are those of the HSL model (hexcone: `L = (max + min) / 2`, `S = (max − min) / (1 − |2L − 1|)`, hue from the largest channel) computed from the display-referred sRGB value, the convention of `render-engine.Colour adjustment pipeline order`; the band adjustments are applied to H, S and L (hue shift added, `S × (1 + p w)`, `L + 0.25 p w`, each summed over the bands weighted by `w`, then clamped) and converted back. A pixel of hue `h` SHALL be affected by a band with weight `w = 0.5 × (1 + cos(π × d / D))` when `d < D` and 0 otherwise, where `d` is the angular distance from `h` to the band centre and `D` the angular distance from the band centre to the neighbouring band centre on that side; the weight is additionally multiplied by `smoothstep(0.05, 0.15, S)` of the pixel's saturation `S`, so pixels with saturation below 0.05 are unaffected. The UI SHALL show eight colour swatches as a band selector and three sliders for the selected band; a swatch SHALL show a dot when any of its three values is non-default. An on-preview picker tool SHALL select the band whose centre is nearest to the hue of the clicked pixel. [CAPCUT CC-127] [NEW]

#### Scenario: Desaturate one band
- **WHEN** Blue Saturation is −100
- **THEN** a pure blue pixel renders grey and a pure red pixel is unchanged

#### Scenario: Greys untouched
- **WHEN** every band has Hue +100
- **THEN** a neutral grey pixel is unchanged

#### Scenario: Band weight between two centres
- **WHEN** only the Green band has Saturation −100 and a fully saturated pixel has hue 150° (midway between Green at 120° and Aqua at 180°)
- **THEN** the Green band's weight on it is 0.5 and its chroma is halved (within 2 %)

#### Scenario: Picker selects a band
- **WHEN** the user clicks a pixel with hue 125° using the picker
- **THEN** the Green band becomes the selected band

### Requirement: Curves
The `curves` section SHALL provide four curves — Master, Red, Green and Blue — each a list of 2 to 16 points `(x, y)` with x and y in 0…1 and strictly increasing x, default `[(0,0), (1,1)]`. The Master curve SHALL be applied to R, G and B separately (it is not a luma curve), before the three channel curves, as stated by `render-engine.Colour adjustment pipeline order`. The curve between points SHALL be a monotone cubic Hermite spline with Fritsch–Carlson tangents, clamped to 0…1, sampled into the 256-entry tables of that requirement at `i / 255`. The editor SHALL be a square graph (240×240 px desktop/web, full sheet width on mobile) with a 4×4 grid and the clip's luma or channel histogram drawn behind it. Interactions: click on the curve adds a point; drag moves a point (x constrained between its neighbours with a minimum gap of 0.01; the first point's x is limited to 0…0.5 and the last point's x to 0.5…1, and values outside the end points' x are held at the end points' y); double-click, drag out of the graph by more than 24 px, or Delete on a selected point removes it (end points cannot be removed); arrow keys nudge the selected point by 0.004, Shift+arrow by 0.04; Tab cycles points. A channel selector SHALL switch curves, each with its own Reset. Adding a 17th point SHALL be refused with the tooltip "Maximum of 16 points". Curve shapes are not keyframable. [CAPCUT CC-128] [NEW]

#### Scenario: Add and drag a point
- **WHEN** the user clicks the Master curve at x = 0.5 and drags the new point to y = 0.6
- **THEN** mid-grey input 0.5 renders as 0.6 (within 1/255) and one undo step is recorded on release

#### Scenario: Point cannot cross its neighbour
- **WHEN** a point between neighbours at x = 0.3 and x = 0.7 is dragged to x = 0.9
- **THEN** its x stops at 0.69

#### Scenario: Remove a point
- **WHEN** the user double-clicks an interior point
- **THEN** the point is removed; double-clicking an end point does nothing

#### Scenario: Red channel only
- **WHEN** the Red curve maps 0.5 to 0.7 and the other curves are default
- **THEN** only the red channel of a mid-grey pixel changes

### Requirement: Colour wheels
The `wheels` section SHALL provide three wheels labelled Shadows (lift), Midtones (gamma) and Highlights (gain). Each wheel SHALL have a puck stored as a vector `(x, y)` inside the unit disc (default `(0, 0)`), whose direction is the hue angle and whose magnitude is the amount, and a luminance slider −100…100 (default 0). The mapping from a puck and its luminance to per-channel lift, gamma and gain, and the transfer applied to each channel, are defined only by `render-engine.Colour wheel puck mapping` and are not restated with other constants here: hue angle `θ = atan2(y, x)` with 0° = red on the positive x axis, counter-clockwise with y pointing up (120° = green, 240° = blue); amount `a = min(1, sqrt(x² + y²))`; chroma vector `k = (cos θ, cos(θ − 120°), cos(θ + 120°))`; shadows `lift_c = 0.25 × (a × k_c + L / 100)`; midtones `gamma_c = 2^(a × k_c + L / 100)`; highlights `gain_c = 2^(a × k_c + L / 100)`; `out = clamp(gain_c × (in + lift_c × (1 − in)), 0, 1)^(1 / gamma_c)`. On screen the wheel is drawn with red at the right (0°), green at the upper left and blue at the lower left, so dragging the puck toward a colour adds that colour. Puck drag SHALL move at one-quarter speed while Shift is held; double-click on a wheel SHALL reset that wheel. The three values of each wheel (puck x, puck y, luminance) SHALL be keyframable, so the puck interpolates as a vector and not as an angle. Wheels SHALL be 120 px in diameter on desktop/web and SHALL be shown one at a time with a three-way segmented switch on mobile. [CAPCUT CC-129] [NEW]

#### Scenario: Warm highlights
- **WHEN** the Highlights puck is at angle 30°, amount 0.5 (`x = 0.433`, `y = 0.25`) and luminance is 0
- **THEN** the gains are R 1.350, G 1.000 and B 0.741 (each ± 0.002), so a mid-grey pixel (0.5, 0.5, 0.5) renders as (0.675, 0.500, 0.370) ± 0.004 and a black pixel is unchanged

#### Scenario: Midtone puck toward green
- **WHEN** the Midtones puck is at angle 120°, amount 1 and luminance is 0
- **THEN** a mid-grey pixel renders with G = 0.707 ± 0.004 (gamma 2) and R = B = 0.375 ± 0.004 (gamma 0.707)

#### Scenario: Shadows luminance
- **WHEN** Shadows luminance is +100
- **THEN** a black pixel renders at 0.25 and a white pixel remains white

#### Scenario: Reset one wheel
- **WHEN** the user double-clicks the Midtones wheel
- **THEN** only the Midtones puck and luminance return to default

### Requirement: LUT import
The user SHALL be able to import look-up tables in `.cube` (1D and 3D, `LUT_1D_SIZE` 2–65536, `LUT_3D_SIZE` 2–65, with `DOMAIN_MIN`/`DOMAIN_MAX` honoured) and `.3dl` (3D, sizes 17, 33 and 65) formats, up to 32 MiB per file, by file picker, by dropping the file on the Adjustment tab or the assets panel, or through the platform share/open-with entry on mobile. An imported LUT SHALL be parsed off the main thread, stored as a LUT asset in the user's LUT library on the device (content-addressed by SHA-256, so the same file imports once), copied into each project that uses it, synchronised with the project as a blob, and synchronised as a library item through `cross-device-sync.Library item sync`. Parsing errors SHALL be reported with the file name and reason: "Unsupported LUT size", "Malformed line {n}", "File is larger than 32 MiB" or "Not a .cube or .3dl file"; a failed import SHALL add nothing. The library SHALL hold at most 500 user LUTs. [CAPCUT CC-130] [NEW]

#### Scenario: Import a 33-point cube
- **WHEN** the user imports a valid `LUT_3D_SIZE 33` file named `Teal Look.cube`
- **THEN** a LUT named "Teal Look" appears under "My LUTs" within 2 s and is selectable

#### Scenario: Malformed file
- **WHEN** the file has a non-numeric token on line 57
- **THEN** import fails with "Teal Look.cube: Malformed line 57" and "My LUTs" is unchanged

#### Scenario: Duplicate import
- **WHEN** the same file is imported twice
- **THEN** "My LUTs" contains it once and a toast reads "Already in your LUTs"

#### Scenario: Oversize 3D LUT
- **WHEN** a `.cube` declares `LUT_3D_SIZE 129`
- **THEN** import fails with "Unsupported LUT size"

### Requirement: Bundled LUTs
The LUT picker SHALL list a "Built-in" group containing exactly these 12 LUTs, written for this project as 33-point 3D tables: `neutral` — Neutral; `log-to-display` — Log to Display; `soft-s-curve` — Soft S-Curve; `strong-s-curve` — Strong S-Curve; `warm-film` — Warm Film; `cool-film` — Cool Film; `teal-orange` — Teal & Orange; `high-key` — High Key; `day-for-night` — Day for Night; `faded-matte` — Faded Matte; `vivid` — Vivid; `display-gamma-24` — Display Gamma 2.4. No built-in LUT has the same recipe as a bundled filter of `visual-effects-filters.Bundled filter library`. The look of each SHALL be defined by the recipe (or transfer formula) listed per id in `catalog.md` next to this spec, which is normative; `LUT bake procedure` SHALL bake each into a `.cube` file, and the baked table SHALL equal its recipe rendered live within 1/255 per channel at every lattice point. A built-in LUT is referenced from an element as `adjustments.lut.lutId = "bundled:<id>"` (`project-document.Colour adjustments`). Built-in LUTs SHALL be read-only (no rename, no delete) and available offline. [CAPCUT CC-130] [NEW]

#### Scenario: Neutral is identity
- **WHEN** the built-in "Neutral" LUT is applied at intensity 100
- **THEN** output equals input within 1/255 per channel

#### Scenario: Built-ins cannot be deleted
- **WHEN** the user opens the context menu of a built-in LUT
- **THEN** Rename and Delete are not offered

#### Scenario: Exactly twelve built-ins offline
- **WHEN** the LUT picker is opened with no network
- **THEN** the Built-in group lists exactly the 12 names above

#### Scenario: Baked table equals its recipe
- **WHEN** the build bakes `warm-film` and the same recipe is applied live as `adjustments` to a 33-step colour lattice image
- **THEN** every lattice colour of the baked table is within 1/255 per channel of the live render

#### Scenario: Display Gamma 2.4
- **WHEN** "Display Gamma 2.4" is applied at intensity 100 to a grey pixel of display value 0.5
- **THEN** the output is 0.526 ± 0.004 on all three channels, and black and white are unchanged

#### Scenario: No built-in duplicates a filter
- **WHEN** the 12 built-in LUT recipes are compared with the 39 filter recipes
- **THEN** no two recipes are equal

### Requirement: LUT bake procedure
The build script `scripts/bake-luts` SHALL turn every recipe of `visual-effects-filters/catalog.md` (39 filters) and of this capability's `catalog.md` (12 built-in LUTs) into a `.cube` file by one deterministic procedure, so that two engineers obtain byte-identical files from the catalogue text alone. For each lattice point `(i, j, k)` with `i, j, k = 0 … 32`, the input is the display-referred sRGB triple `(i / 32, j / 32, k / 32)`; the script evaluates, in IEEE-754 binary64 and in the order of `render-engine.Colour adjustment pipeline order` (basic in its stated slider order, wheels, curves, HSL), the formulas of `Basic adjustment sliders`, `render-engine.Colour wheel puck mapping` (a recipe's `angle°, amount` is the puck `x = amount × cos(angle)`, `y = amount × sin(angle)`), `Curves` (evaluated exactly from the spline, not from the 256-entry table) and `HSL per colour band`; values are not clamped between steps and are clamped to 0…1 once at the end; `fade` is applied as its pointwise formula; sharpness, clarity, vignette and grain are not allowed in a recipe and the script fails when one is present; a row defined by a transfer formula is evaluated per channel from that formula. Output: `LUT_3D_SIZE 33`, `DOMAIN_MIN 0 0 0`, `DOMAIN_MAX 1 1 1`, red varying fastest, each value written with exactly 6 decimal places, lines ended by a single line feed. The baked files are committed, their SHA-256 values are listed in `docs/product/ASSET-PROVENANCE.md`, and CI SHALL run the script and fail when any produced file differs from the committed file or when a catalogue recipe has no committed file. A golden-frame case per baked table SHALL verify that the table sampled by the engine equals the recipe rendered live within 1/255 per channel at every lattice point. [NEW]

#### Scenario: Deterministic output
- **WHEN** the bake script is run twice, on a macOS, a Windows or a Linux build machine
- **THEN** all 51 produced `.cube` files are byte-identical between runs and machines and equal the committed files

#### Scenario: Recipe edited without re-baking
- **WHEN** the recipe of `warm-film` is changed in `catalog.md` and the committed file is not regenerated
- **THEN** CI fails and names `warm-film`

#### Scenario: Spatial slider in a recipe
- **WHEN** a recipe row contains `sharpness 20`
- **THEN** the script fails and names the row

### Requirement: LUT rendering
The `lut` section holds `lutId` (`bundled:<catalogue id>` or `user:<sha256>`) and `intensity` (0–100, step 1, default 100, keyframable) as defined by `project-document.Colour adjustments`. LUT tables hold display-referred sRGB values and are indexed by the display-referred input. The parameters mean: a 3D LUT of any edge size from 2 to 65 is sampled with tetrahedral interpolation; a 1D LUT with linear interpolation per channel; input values outside the LUT domain are clamped to the domain; `intensity` mixes linearly between the unprocessed and the processed colour. The position of the LUT in the colour chain (first, so that a log-to-display LUT feeds the other tools) is defined by `render-engine.Colour adjustment pipeline order`, which implements these semantics. The bundled filters of `visual-effects-filters.Bundled filter library` use the same sampling and intensity semantics at the `filter` stage. If the referenced LUT asset is missing, the section SHALL render as identity, the picker SHALL show "Missing LUT: {name}" with "Relink…" and "Remove" actions, and the export pre-flight of `export-share.Pre-flight validation` SHALL list it as a warning before starting. [CAPCUT CC-130] [NEW]

#### Scenario: Half intensity
- **WHEN** a LUT that maps mid-grey to (0.8, 0.5, 0.2) is applied at intensity 50
- **THEN** mid-grey renders as (0.65, 0.5, 0.35) within 1/255

#### Scenario: Missing LUT
- **WHEN** a project references a LUT asset that is not present on the device
- **THEN** the clip renders without the LUT and the picker shows the missing state with Relink and Remove

#### Scenario: LUT feeds the other tools
- **WHEN** a LUT maps every display value above 0.5 to white, Exposure is 50 (+1 stop) and the input is a grey of display value 0.30
- **THEN** the LUT leaves the pixel at 0.30 and Exposure then doubles its linear value (display value 0.419 ± 0.004), not white

#### Scenario: Small and large tables
- **WHEN** identity LUTs with `LUT_3D_SIZE 2` and `LUT_3D_SIZE 65` are applied at intensity 100
- **THEN** both render the input unchanged within 1/255 per channel

### Requirement: LUT library management
The user SHALL be able to rename (1–60 characters, unique within "My LUTs", auto-suffixed " (2)" on collision), delete (with a confirm dialog listing how many clips in the open project use it) and favourite user LUTs. Deleting a LUT from the library SHALL NOT remove the copies stored inside projects. The picker SHALL show a 64×64 thumbnail of each LUT applied to the current frame of the selected clip, a search field, and the groups Favourites, Built-in and My LUTs. Hovering (desktop/web) or focusing (keyboard) a LUT SHALL preview it on the canvas without committing; selecting commits one undo step. The same browser SHALL be shown without a project at `/library/luts` (the LUTs category of `app-shell-navigation.Library screen`), where thumbnails use the bundled sample image of `visual-effects-filters.Effects and filters panels` and the actions are import, rename, favourite and delete. LUT files can also arrive in a preset pack (`templates.Preset packs`), in which case they are imported by the rules of `LUT import`. [NEW]

#### Scenario: Hover preview
- **WHEN** the user hovers "High Key" in the picker
- **THEN** the canvas shows the clip with High Key applied and, on leaving without clicking, returns to the committed state with no undo step recorded

#### Scenario: Delete a LUT in use
- **WHEN** the user deletes a user LUT used by 3 clips in the open project
- **THEN** the dialog states "Used by 3 clips in this project", and after confirming, those clips still render with the LUT

#### Scenario: Library scope
- **WHEN** the user opens `/library/luts` with no project open and imports a `.cube` file
- **THEN** the LUT appears under "My LUTs" there and in the picker of every project opened afterwards on that device

### Requirement: Adjustment layers
The user SHALL be able to add an adjustment layer from the assets panel "Adjustment" tab (desktop/web: click or drag "Adjustment layer"). On mobile the entry is the combined Filters / Adjust sheet owned by `mobile-editor.Effect, filter and adjustment bar strips`: with no clip selected, the first slider change in the Adjust tab of that sheet creates an adjustment layer at the playhead. An adjustment layer SHALL be an element of type `adjustment` with the default adjustment-element duration (5 s; preference of `settings-preferences.Editing default preferences`), placed at the playhead by strategy `firstAvailable` among tracks of type `adjustment` (`timeline-editing.Placement strategies`), else on a new `adjustment` track at the index defined by `timeline-editing.Track creation and insert index`. An adjustment layer SHALL hold `adjustments` (all five sections), an `effects` array restricted to at most one entry of `kind: "filter"` (`visual-effects-filters.Effect and filter data model`), and `opacity`, stored as a fraction 0–1 (default 1, keyframable on the path `opacity`) and displayed as 0–100 %, that mixes its result with the unadjusted composite; the stored shape is `project-document.Adjustment element`. It SHALL apply to the composite of all tracks beneath it for its time range (`render-engine.Adjustment and effect layer nodes`), SHALL be movable, trimmable without source limits, splittable, duplicable and deletable, and SHALL take masks as defined in `masks-blending-keying.Maskable element types` to limit its area. Several adjustment layers SHALL stack bottom-to-top. Hiding the track or element SHALL disable it. On the timeline it SHALL render as a bar labelled with its name (default "Adjustment 1", incrementing), renameable. [CAPCUT CC-133] [NEW]

#### Scenario: Affects layers beneath for its range only
- **WHEN** an adjustment layer with Saturation −100 spans 2 s to 4 s above the main track
- **THEN** frames between 2 s and 4 s are greyscale and frames outside are in colour

#### Scenario: Overlay above the layer is untouched
- **WHEN** an overlay track sits above the adjustment track
- **THEN** elements on that overlay keep their colours during the layer's range

#### Scenario: Opacity mix
- **WHEN** the layer's Opacity field shows 50 %
- **THEN** the stored `opacity` is 0.5 and each pixel is the average of the adjusted and unadjusted composite

#### Scenario: Masked adjustment layer
- **WHEN** an ellipse mask is added to the adjustment layer
- **THEN** only pixels inside the ellipse are adjusted

#### Scenario: Only a filter is accepted in its effects array
- **WHEN** the user drags the "Glow" effect tile onto an adjustment layer
- **THEN** the layer does not highlight and dropping does nothing, while dropping the "Sepia" filter tile sets its single filter entry

### Requirement: Adjustment tab layout
For eligible elements the inspector SHALL show the "Adjustment" tab named in `preview-canvas.Inspector structure per element type` (for an adjustment-layer element it is the content of its "Parameters" tab), with collapsible sections in this display order: Basic, HSL, Curves, Colour wheels, LUT. Each section header SHALL carry an enable switch, a reset button and a modified-state dot. Above the sections SHALL be a toolbar with: Auto adjust, Compare, Copy/Paste attributes, Presets, Colour match, Apply to all, Enhance, and Reset all. With nothing selected the tab SHALL not be shown; with several eligible elements selected the tab SHALL edit all of them, showing "Mixed" in fields whose values differ and writing the edited value to every selected element in one undo step. Mobile entry: the "Adjust" items of `mobile-editor.Root toolbar` and `mobile-editor.Video clip tool strip`; this capability defines the content of the Adjust tab of the sheet — the same tools, with the sections as tabs across the top; HSL, Curves and Colour wheels SHALL be fully available on mobile and web. [PORT X-002] [CAPCUT CC-127, CC-128, CC-129] [NEW]

#### Scenario: Tab is functional
- **WHEN** a video clip is selected and the Adjustment tab is opened
- **THEN** the five sections are shown with working controls (no "coming soon" notice)

#### Scenario: Multi-selection edit
- **WHEN** three clips with Contrast 0, 10 and 20 are selected
- **THEN** the Contrast field shows "Mixed", and setting it to 15 sets all three to 15 as one undo step

### Requirement: Reset adjustments
Each section's reset button SHALL restore that section's values to default and remove that section's keyframes; "Reset all" SHALL do so for all five sections after a confirm dialog when any keyframes exist. Each reset SHALL be one undo step. Reset buttons SHALL be disabled when there is nothing to reset. [NEW]

#### Scenario: Reset a section
- **WHEN** the user resets HSL on a clip with modified Blue and Green bands
- **THEN** all 24 HSL values are 0 and the Basic values are unchanged

#### Scenario: Reset all with keyframes
- **WHEN** Exposure is keyframed and the user presses "Reset all"
- **THEN** a dialog asks "Reset all adjustments and remove their keyframes?", and confirming removes the values and the channels in one undo step

### Requirement: Before and after compare
The Adjustment tab and the preview toolbar SHALL offer "Compare" in two modes: Hold (while the button is pressed or the action `color.compare-hold` is held — its default binding is defined only in `keyboard-shortcuts` — the selected element, or the whole frame when an adjustment layer is selected, renders with its `adjustments` and filter entry bypassed) and Split (a vertical divider at 50% of the canvas, draggable 0–100%, with "Before" on the left and "After" on the right, labelled). Compare SHALL be a view state only: it SHALL NOT modify the project, create undo steps, or affect export, and SHALL switch off when the selection changes. On mobile, Hold SHALL be a press-and-hold button on the preview. [NEW]

#### Scenario: Hold to compare
- **WHEN** the user holds the `color.compare-hold` action with an adjusted clip selected
- **THEN** the preview shows the clip without adjustments and filter, and releasing restores them

#### Scenario: Split does not affect export
- **WHEN** Split compare is active and the user exports
- **THEN** the exported video shows the adjusted picture across the full frame

#### Scenario: Selection change ends compare
- **WHEN** Split compare is active and the user selects another clip
- **THEN** the divider disappears and the full frame shows the adjusted picture

### Requirement: Copy and paste attributes
The action `edit.copy-attributes` ("Copy attributes") SHALL capture the selected element's attributes; the action `edit.paste-attributes` ("Paste attributes") SHALL open a dialog with a checkbox per attribute group that exists on the source and is valid for the targets: Transform (position, scale, rotation), Crop and flip, Opacity and blend mode, Adjustments, Filter, Effects, Masks, Chroma key, Speed, Clip animation, Volume, Audio fades. Default bindings for both actions are defined only in `keyboard-shortcuts`; both are also in the element context menu. All available groups SHALL be checked by default; the choice SHALL be remembered for the session. Confirming SHALL write the chosen groups to every selected target, including keyframes (times kept element-local and dropped beyond the target's duration), as one undo step. Groups not applicable to a target type SHALL be skipped for that target. With no attributes copied, Paste SHALL be disabled. [NEW]

#### Scenario: Paste adjustments only
- **WHEN** attributes are copied from clip A, and on clip B the user pastes with only "Adjustments" checked
- **THEN** B's `adjustments` equals A's, and B's transform, effects and masks are unchanged

#### Scenario: Paste onto mixed targets
- **WHEN** the targets are one video clip and one audio clip and "Adjustments" and "Volume" are checked
- **THEN** the video clip receives both, the audio clip receives only Volume, and one undo reverts both

#### Scenario: Keyframes beyond duration
- **WHEN** the source has an Exposure keyframe at local 6 s and the target lasts 4 s
- **THEN** that keyframe is not pasted and keyframes at or before 4 s are

### Requirement: Adjustment presets
The user SHALL be able to save the current `adjustments` (values only, without keyframes) as a named preset (1–60 characters, unique, auto-suffixed on collision), stored in user preferences on the device and synchronised to paired devices through `cross-device-sync.Library item sync`. The Presets menu SHALL list presets alphabetically with a thumbnail rendered from the current frame, and support apply (replaces all five sections, one undo step), rename and delete with confirm. At most 200 presets SHALL be stored; saving beyond that SHALL be refused with "Preset limit reached (200)". Presets that reference a LUT SHALL store the LUT's content hash; applying one whose LUT is missing SHALL apply the other sections and show "LUT "{name}" is missing". [CAPCUT CC-132] [NEW]

#### Scenario: Save and apply
- **WHEN** the user saves "Warm punch" from clip A and applies it to clip B
- **THEN** B's five sections equal A's values at save time and B has no adjustment keyframes

#### Scenario: Empty list
- **WHEN** no presets exist
- **THEN** the menu shows "No presets yet" and a "Save current as preset" item

### Requirement: Colour match between clips
"Colour match" SHALL let the user pick a reference: another clip in the timeline (its frame at the playhead, or its first frame when the playhead is outside it) or an image from the media library. The editor SHALL compute on-device the mean and standard deviation of the target frame and the reference frame in CIE Lab at 256 px on the long edge, derive a per-channel statistical transfer, bake it into a 17-point 3D LUT stored in the project as "Match: {reference name}", and set it as the target's `lut` with intensity 100. The intensity slider SHALL then scale the match. The operation SHALL be one undo step, SHALL replace any LUT previously set on the target after a confirm, and SHALL need no network. [CAPCUT CC-131] [NEW]

#### Scenario: Match to a warmer clip
- **WHEN** the reference frame's average is warmer than the target's
- **THEN** after matching, the target frame's mean a/b values in Lab are within 3 units of the reference's

#### Scenario: Same clip chosen
- **WHEN** the user picks the target clip itself as reference
- **THEN** the action is refused with "Choose a different clip as reference"

### Requirement: Apply adjustments to all clips
"Apply to all" SHALL copy the selected element's `adjustments` (values without keyframes) to every eligible element in the current scene's main and overlay tracks, after a confirm dialog stating the number of affected clips, as one undo step. Elements on locked tracks SHALL be skipped. [NEW]

#### Scenario: Apply to all
- **WHEN** the scene has 8 eligible clips and the user confirms
- **THEN** all 8 have identical adjustment values and one undo restores each clip's previous values

### Requirement: Scopes
On desktop and web, the preview panel SHALL offer a "Scopes" toggle (action `color.scopes.toggle`; default binding defined only in `keyboard-shortcuts`) that opens a dockable panel, 280 px wide by default and resizable 200–480 px, with a selector for: Histogram (RGB overlay plus luma), Waveform (luma or RGB parade, 0–100 IRE scale), and Vectorscope (Rec.709 targets with a skin-tone line). Scopes SHALL be computed on the GPU from the composited preview frame downsampled to at most 512 px wide, SHALL update within 100 ms of a paused frame change and at no less than 10 Hz during playback, and SHALL reflect Compare state. On mobile (iOS and Android) the same three scopes SHALL be available as a 160×96 px overlay on the preview, toggled from the Adjust sheet, with the selector as a three-way segmented switch on the overlay; the overlay is draggable to any preview corner. Scope state SHALL be stored in the editor layout preferences, not in the project. With `backend: "none"` the Scopes toggle SHALL be disabled with the tooltip "Scopes need GPU rendering". [CAPCUT CC-135] [NEW]

#### Scenario: Histogram of a black frame
- **WHEN** the composited frame is entirely black
- **THEN** the histogram shows a single spike at the left edge for all channels

#### Scenario: Vectorscope of a grey frame
- **WHEN** the frame has no chroma
- **THEN** the vectorscope trace is a single dot at the centre

#### Scenario: Waveform of a horizontal ramp
- **WHEN** the frame is a left-to-right 0–100 % luma ramp
- **THEN** the luma waveform is a straight diagonal line from 0 IRE at the left to 100 IRE at the right

#### Scenario: Mobile
- **WHEN** the user enables scopes on a phone and switches the overlay to Vectorscope
- **THEN** the 160×96 px overlay shows the vectorscope of the current frame and the preview stays visible around it

### Requirement: Keyframing adjustments
All Basic sliders, all HSL values, the wheel values and LUT intensity SHALL be keyframable on paths `adjustments.basic.<key>`, `adjustments.hsl.<band>.<hue|saturation|lightness>`, `adjustments.wheels.<wheel>.<x|y|luminance>` and `adjustments.lut.intensity`, using `keyframe-animation.Interpolation types`; these are the paths of group 7 of `project-document.Animatable property paths`, stored in the element's `animations` store. Curve point lists, the LUT selection and section `enabled` flags SHALL be static (not keyframable). Adjustment layers SHALL support the same paths plus `opacity`. [CAPCUT CC-092] [NEW]

#### Scenario: Fade to black and white
- **WHEN** Saturation has keyframes 0 at local 0 s and −100 at local 2 s (linear)
- **THEN** at local 1 s the resolved Saturation is −50

#### Scenario: Curves have no keyframe toggle
- **WHEN** the Curves section is open
- **THEN** no keyframe toggle is shown for the curve editor

#### Scenario: HSL path equals the stored key
- **WHEN** the user adds a keyframe on the Blue band's Lightness
- **THEN** the element's `animations` contain the path `adjustments.hsl.blue.lightness`

### Requirement: Enhance entry point
The Adjustment toolbar SHALL include "Enhance", which opens the flow of `ai-editing-tools.Upscale and enhance` with the selected clip preselected. This capability defines only the entry point: the control SHALL be present on all platforms; where that requirement states the tool needs a host and none is connected, the button SHALL open a notice "Connect a host to enhance video" with a button to connection settings. The result SHALL NOT alter the clip's `adjustments`. [CAPCUT CC-134] [NEW]

#### Scenario: Hand-off
- **WHEN** the user presses Enhance on a selected clip
- **THEN** the `ai-editing-tools.Upscale and enhance` flow opens for that clip and the clip's `adjustments` values are unchanged

#### Scenario: No host
- **WHEN** the enhancement needs a host, none is connected and the user presses Enhance
- **THEN** the notice with the connection-settings button is shown and no job starts

### Requirement: Adjustment precision and editing operations
Numeric precision of colour processing (floating-point evaluation with no intermediate 8-bit quantisation), the conversion between display-referred and linear-light values, and the equality of preview and export are defined by `render-engine.Colour adjustment pipeline order`, `render-engine.Colour management` and `render-engine.Golden-frame determinism`; this capability adds the acceptance that an identity chain is bit-exact. With `backend: "none"` nothing renders (see `render-engine.Behaviour without a GPU backend`); every adjustment parameter stays editable and is stored. Split SHALL copy `adjustments` to both halves with keyframes divided at the split point; duplicate and copy/paste of elements SHALL copy them; all adjustment mutations SHALL be undoable commands, exposed to agents through `jc_color_adjust` and `jc_color_match` (`agent-editing-tools.Tool naming and families`) with exactly the keys and ranges of `project-document.Colour adjustments` (a value outside its range is refused with `OUT_OF_RANGE`, never clamped, per `agent-editing-tools.Validation`; inspector fields clamp typed values), whose meaning is defined by `Basic adjustment sliders`, `HSL per colour band`, `Curves`, `Colour wheels` and `LUT rendering`. [NEW]

#### Scenario: Identity chain has no banding
- **WHEN** all sections are enabled at default values on a horizontal 0–1 gradient
- **THEN** the 8-bit output equals the input for every pixel

#### Scenario: Split keeps the grade
- **WHEN** a clip with Contrast 20 and Exposure keyframes is split
- **THEN** both halves have Contrast 20 and the Exposure animation is continuous across the cut

#### Scenario: Agent value out of range
- **WHEN** `jc_color_adjust` sets `basic.sharpness` to −20
- **THEN** the call fails with `OUT_OF_RANGE` naming the field with `min` 0 and `max` 100 (`agent-editing-tools.Validation`), and the stored value is unchanged

#### Scenario: Editing without a GPU
- **WHEN** the engine reported `backend: "none"` and the user sets Contrast to 30
- **THEN** `adjustments.basic.contrast` is stored as 30 and one undo step is recorded
