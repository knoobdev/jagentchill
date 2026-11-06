# visual-effects-filters — normative catalogue

This file is normative. It is cited by `visual-effects-filters.Bundled effect library`,
`visual-effects-filters.Bundled filter library` and `visual-effects-filters.Effect definition registry`.
Parameter names, ranges and defaults are in the spec tables; this file adds, per id, the algorithm, search keywords,
targets and flags. All content is authored for JAgentChill; no row reproduces a third-party preset.

Conventions
- **Frame.** Every row is written in the effect frame of
  `visual-effects-filters.Resolution-independent effect parameters` (engine side: `render-engine.Effect coordinate frame`): for a clip effect the element's transformed, rotated
  box; for a standalone effect element the canvas. `uv` = normalised coordinates of that frame (0…1, origin top-left,
  axes along the box edges), obtained from canvas pixels with the engine uniform `u_boxInverse`. "The frame", "frame
  centre", "frame width / height", "short side" and "half diagonal" always mean that frame's, in render-target pixels
  (`u_boxSize`). `r` = distance from the stated centre in render-target pixels; "`r` normalised" = `r` ÷ the half diagonal.
- `c` = `(centerX, centerY)` mapped from −100…100 to the frame (0 = centre, ±100 = edges); `s` = the pixel scale factor of
  that requirement; `t` = element-local time in seconds derived from ticks; `rand(i)` = `hash(seed, i)` with the engine's
  integer hash (`render-engine.Deterministic hash`) mapped to 0…1 — never wall-clock time or a platform random source.
  `vnoise(x, cell)` = 2-D value noise of that hash on a lattice of `cell` render-target pixels with smoothstep
  interpolation, range 0…1.
- "0–100" parameters are used as `p = value / 100` unless a mapping is stated. `luma` = 0.2126 R + 0.7152 G + 0.0722 B of
  the display-referred value.
- Alpha: an effect keeps the input alpha unless the row says "fill" (a fill sets alpha to 1 inside the frame). Additive
  light and particles are multiplied by the input alpha before being added.
- Sampling outside the frame: transparent black for the remap effects listed in that requirement, clamp-to-edge for all
  others.
- Targets: unless stated, an effect accepts video, image, text, sticker, graphic and compound elements and can be used as
  a standalone effect element. `timeDriven: true` is marked **T**. `requires: "person-matte"` is marked **M**; those rows
  read the matte texture `matte` (0…1) of `visual-effects-filters.Body effects use the on-device person matte`, accept
  video and image elements, and cannot be used as a standalone effect element.
- Every row uses the current frame only. A row is complete: a constant that decides the picture is written in the row.

## Effects (61)

| Type id | Flags | Keywords | Algorithm (normative) |
|---|---|---|---|
| `blur` | | blur, soft, defocus, gaussian | Separable Gaussian, sigma `intensity / 5 × s` px, horizontal then vertical pass, kernel radius `ceil(3 × sigma)`. |
| `directional-blur` | | motion, streak, linear | 17 taps along the direction `angle`, total length `intensity × 2 × s` px, box weights. |
| `radial-blur` | | spin, rotate, circular | 24 taps rotated about `c` over a total arc of `intensity × 0.3`°, equal weights. |
| `zoom-blur` | | zoom, burst, speed | 24 taps along the line from `c` to the pixel, scale range `1 − 0.5p … 1`, equal weights. |
| `tilt-shift` | | miniature, focus, depth | Two separable Gaussian copies of the input are made, `half` with sigma `intensity / 10 × s` px and `full` with sigma `intensity / 5 × s` px. With `d` = distance in frame heights from the focus line (the line through the point `position / 200` frame heights from the frame centre along the line's normal, at `angle`) and `m = smoothstep(width/200, width/200 + 0.25, d)`: output = `mix(input, half, 2m)` for `m < 0.5`, else `mix(half, full, 2m − 1)`. |
| `frosted-glass` | | glass, privacy, frost | Each pixel samples at an offset `(rand−0.5) × intensity × 0.4 × s` px from a 4 px cell hash, then adds monochrome noise of amplitude `grain × 0.1 / 100`. |
| `mosaic` | | pixelate, censor, blocks | Colour of the centre of the `blockSize × s` px square cell containing the pixel. |
| `fisheye` | | lens, barrel, bulge | Radial remap about the frame centre: sample at `r' = r × (1 + k r²) / (1 + k)` with `k = strength / 100 × 0.8` and `r` normalised, so the frame corners stay fixed and the centre is magnified. |
| `wave` | T | wobble, sine, water | Displace along the axis perpendicular to `direction` by `amplitude × 0.5 × s` px × `sin(2π (frequency × u + speed × t))`, `u` = coordinate along `direction` in 0…1. |
| `ripple` | T | water, drop, rings | Radial displacement `amplitude × 0.3 × s` px × `sin(2π (r / (wavelength × 4 × s) − speed × t))` along the direction from `c`. |
| `twirl` | | swirl, spiral, twist | Rotate about `c` by `angle × (1 − r/R)²` for `r < R`, `R = radius`% of the half diagonal; identity outside. |
| `bulge` | | pinch, magnify, squeeze | Inside `R` (as for twirl) scale the sample radius by `1 − strength/100 × 0.6 × (1 − (r/R)²)`. |
| `mirror` | | reflect, symmetry, flip | Copy the named half onto the other across the axis shifted by `offset`% of the half size; `quad` mirrors the top-left quadrant to all four. |
| `kaleidoscope` | | mandala, symmetry, prism | Polar coordinates about the centre; fold the angle into a wedge of `360° / segments` with reflection, rotate by `rotation`, scale radius by `100 / zoom`. |
| `shake` | T | camera, handheld, earthquake | Translate by `intensity × 0.4 × s` px × value-noise(`frequency × t`, seed) per axis and rotate by `rotation × 0.03`° × value-noise; edges are filled by a zoom of `1 + intensity/1000`. |
| `tile` | | grid, repeat, clone | Output `uv' = fract(uv × (columns, rows))`. |
| `posterize` | | levels, flat, pop | Per channel `floor(v × levels) / (levels − 1)`, clamped. |
| `halftone` | | dots, print, comic | Square grid of cell `dotSize × s` px rotated by `angle` about the frame centre (a lattice point lies on the centre). `mono`: a black disc of radius `0.5 × cell × sqrt(1 − luma)` (luma sampled at the cell centre) on a white fill, edge anti-aliased over 1 px. `cmyk`: `K = 1 − max(R, G, B)`, `C = (1 − R − K) / (1 − K)`, `M = (1 − G − K) / (1 − K)`, `Y = (1 − B − K) / (1 − K)` (all 0 when `K = 1`); four grids at `angle` + 15° (C), 75° (M), 0° (Y), 45° (K); each ink a disc of radius `0.5 × cell × sqrt(ink)`; inks `#00aeef`, `#ec008c`, `#fff200`, `#000000` multiplied onto a white fill in the order C, M, Y, K; no dot gain. |
| `sketch` | | pencil, drawing, outline | `e = clamp(sobel(luma) × edgeStrength / 25, 0, 1)` with a 3×3 Sobel at a step of `1 × s` px; output grey `(1 − e) × (1 − paper × 0.3 / 100 × vnoise(px, 2 × s))` (a static paper pattern, independent of `t`). |
| `cartoon` | | toon, comic, cel | Bilateral-smoothed colour (radius `4 × s` px) posterised to `levels`, multiplied by `1 − smoothstep(0.2, 0.6, sobel × edgeStrength/50)`. |
| `emboss` | | relief, engrave, stamp | `0.5 + (sample(uv + d) − sample(uv − d)) × strength / 25` on luma, `d` = 1 × s px along `angle`, output grey. |
| `neon-edges` | | neon, outline, glow | Sobel edges above `threshold` coloured with `color`, plus a Gaussian of the edge image (sigma `glow / 5 × s`) added, over black. |
| `duotone` | | two-tone, gradient map, poster | `mix(shadowColor, highlightColor, luma)` mixed with the input by `intensity`. |
| `invert` | | negative, reverse | `mix(v, 1 − v, intensity)`. |
| `threshold` | | black white, stencil, high contrast | `smoothstep(level − softness/2, level + softness/2, luma)` as grey output. |
| `glow` | | bloom, dreamy, shine | Bright-pass above `threshold`, Gaussian sigma `radius / 2 × s` px, added to the input × `intensity / 50`. |
| `light-leak` | T | flare, film, warm | A vertical band of light: centre `cx = 0.5 + position / 200 + 0.2 × sin(0.3 × speed × t + 2π rand(0))` in `uv.x`; falloff `g = exp(−((uv.x − cx) / 0.30)²) × (0.75 + 0.25 × cos(π (uv.y − 0.5)))`; output = input + `color × intensity / 100 × g`. |
| `lens-flare` | | sun, flare, anamorphic | With `P` = (`positionX`, `positionY`) mapped to the frame, `C` the frame centre and `D` the half diagonal, the light `L` is the sum of: a core `exp(−(|x − P| / (0.06 D))²)`; a streak `exp(−((x − P).y / (0.008 D))²) × exp(−((x − P).x / (0.6 D))²)` along the frame's horizontal axis; and four ghost discs centred at `P + (C − P) × k` for `k` = 0.5, 1.0, 1.4, 1.8 with radii 0.03, 0.05, 0.08, 0.12 × `D` and peak alpha 0.35, 0.25, 0.20, 0.15, each flat inside 80 % of its radius and falling to 0 by smoothstep over the outer 20 %. Output = input + `color × intensity / 100 × L`. |
| `light-rays` | | god rays, volumetric, shafts | Bright-pass, 32-tap radial blur from `c` over `length`% of the half diagonal, added × `intensity / 50`. |
| `strobe` | T | flash, blink, flicker | Add `color × intensity` on frames where `fract(frequency × t) < 0.5`, identity otherwise. |
| `spotlight` | | focus, darken, stage | Multiply RGB by `1 − darkness / 100 × smoothstep(R, R × (1 + softness / 50), r)` with `r` normalised from `c` and `R = radius / 100`. |
| `rgb-split` | | chromatic, glitch, 3d | Red sampled at `+d`, blue at `−d`, green in place; `d = amount × 0.2 × s` px along `angle`. |
| `glitch` | T | digital, corrupt, datamosh | Per time step `floor(speed × 4 × t)`, rows grouped in bands of `blockSize × 2 × s` px; bands with `rand < intensity` shift horizontally by `±intensity × 0.6 × s` px with a 2 px RGB split. |
| `scan-jitter` | T | vhs, tracking, lines | Each scanline shifts by `amount × 0.3 × s` px × `(rand(line, floor(speed × 8 × t)) − 0.5)`. |
| `signal-loss` | T | static, band, interference | A horizontal band `bandHeight`% of the frame high scrolls downward at `speed × 0.1` frame heights per second; inside it the image is replaced by mono noise mixed by `intensity`. |
| `pixel-sort` | | sort, streaks, melt | For each pixel whose luma is above `threshold / 100`, the output is the colour of the highest-luma pixel among the pixel itself and the next `length × 2 × s` px in the scan direction (`horizontal` = toward +x, `vertical` = toward +y of the frame); other pixels are unchanged. Bright areas therefore smear toward −x or −y (left or up). |
| `vhs` | T | tape, 80s, analog | Chroma blurred horizontally by `chromaBleed × 0.1 × s` px, a tracking band displaced by `tracking × 0.2 × s` px near the bottom moving with `t`, mono noise `noise × 0.15 / 100`, scanline darkening `scanlines × 0.3 / 100` every second row. |
| `crt` | | monitor, tube, scanlines | Barrel remap with `k = curvature / 100 × 0.25`, black outside, RGB aperture mask (3 px period × s), scanline darkening `scanlines × 0.4 / 100`, vignette `vignette / 100`. |
| `film-grain` | T | noise, analog, texture | Add Gaussian noise of amplitude `amount × 0.2 / 100`, cell size `size × s` px, new pattern each frame from `hash(seed, frameIndex)`; one channel when `monochrome`. |
| `old-film` | T | vintage, scratches, silent | In order: sepia `mix(input, luma × (1.00, 0.86, 0.62), sepia / 100)`; brightness multiplied by `1 + (2 rand(frameIndex) − 1) × flicker × 0.15 / 100`; `floor(scratches / 20)` vertical scratches per frame, each `max(1, 1 × s)` px wide over the full frame height at column `rand(frameIndex × 8 + i + 1)` of the frame width, adding 0.35 to all three channels; grain as `film-grain` with `amount = grain`, `size = 2`, monochrome. |
| `super8` | T | home movie, 8mm, frame | A black fill outside a rounded rectangle inset by `borderSize × 0.15 / 100` of the short side on every edge, with inner corner radius 0.04 × the short side; the picture inside is displaced vertically by `jitter × 0.01 / 100` of the frame height × `(2 vnoise1(18 × t, seed) − 1)` (1-D value noise at 18 Hz); colour shifted by the Temperature formula of `color-adjustment.Basic adjustment sliders` at slider value `warmth × 0.4`. |
| `bit-crush` | | 8-bit, retro game, pixel | Mosaic with cell `pixelSize × s` px, then each channel quantised so the palette has at most `colors` values per channel triple (uniform `round(cbrt(colors))` levels). |
| `snow` | T | winter, flakes, christmas | `density × 4` soft discs of radius `size × s` px falling at `speed × 0.1` frame heights/s with horizontal drift `wind`, three depth layers at 100 %, 70 % and 40 % size, additive white. |
| `rain` | T | storm, drops, weather | `density × 6` streaks of length `length × s` px at `angle`, speed `speed × 0.3` frame heights/s, alpha `opacity`, wrapped vertically. |
| `sparkles` | T | glitter, stars, twinkle | `density × 2` four-point stars of radius `size × s` px in `color` at `rand` positions, alpha `abs(sin(π × twinkleSpeed × t + 2π rand))`. |
| `bokeh` | T | lights, blur, dreamy | `density` discs of radius `size × s` px in `color` at 35 % alpha, flat inside 85 % of the radius and falling to 0 by smoothstep over the outer 15 %; disc `i` starts at `(rand(2i), rand(2i + 1))` in `uv`, drifts upward at `speed × 0.02` frame heights/s (wrapping bottom to top) and sways horizontally by `0.01 × sin(2π (0.1 t + rand(1000 + i)))` frame widths; additive. |
| `confetti` | T | party, celebrate, paper | `density × 3` rectangles `size × s` px in six fixed hues falling at `speed × 0.1` frame heights/s, each rotating at `2π rand` rad/s. |
| `dust` | T | particles, motes, floating | `density × 3` discs of radius `size × s` px at 40 % white alpha with a smoothstep edge over the outer 30 %; mote `i` starts at `(rand(2i), rand(2i + 1))` and is advected at `speed × 0.01` frame heights/s along the direction `2π × vnoise(position, 200 × s)` sampled at its start position (a fixed direction per mote, so any time is computed without history), wrapping at the frame edges; additive. |
| `vignette` | | corners, darken, frame | `mix(input, color, amount / 100 × smoothstep(size / 100, size / 100 + softness / 100, r))` with `r` normalised from the frame centre. |
| `chromatic-aberration` | | fringe, lens, colour shift | Red and blue sampled at radius scaled by `1 ± amount × 0.0006` about the centre. |
| `lens-distortion` | | barrel, pincushion, wide | Radial remap about the frame centre `r' = r × (1 + k r²)`, `k = barrel / 100 × 0.4`, `r` normalised (positive = barrel, negative = pincushion). With `autoFit` on, `r'` is divided by `1 + max(k, 0)` and the sample coordinates are additionally scaled by `1 / (1 + max(−k, 0) × 0.5)` so no transparent border shows; with it off the uncovered border is transparent. `chromatic` samples red at `k × (1 + chromatic / 100 × 0.15)` and blue at `k × (1 − chromatic / 100 × 0.15)` (green at `k`), which gives colour fringes that grow toward the corners. |
| `letterbox` | | cinema, bars, widescreen | Fill with `color` the rows outside a centred band of aspect `ratio`; identity when the frame is already wider. |
| `lens-zoom` | | magnify, punch in, crop | Sample at `c + (uv − c) × 100 / amount`. |
| `slow-zoom` | T | ken burns, push in, photo | Scale about `c` from `startScale` to `endScale`, linear in `t / elementDuration`. |
| `pan-drift` | T | ken burns, slide, photo | Scale by `1 + distance/100` and translate from `−distance/2` to `+distance/2` percent of the frame along `direction`, linear in `t / elementDuration`. |
| `photo-frame` | | instant, border, print | The picture is scaled about the frame centre to `1 − borderSize × 0.004` and moved up by `borderSize × 0.001` of the frame height, on a `color` fill covering the frame (so the bottom border is twice the side borders); the whole is rotated by `tilt` about the frame centre; a drop shadow of the rotated card, offset `8 × s` px down, Gaussian sigma `8 × s` px, 30 % black, is drawn under it. |
| `body-outline` | M | silhouette, stroke, person | Stroke of `width × s` px in `color` centred on the 0.5 iso-line of `matte` (distance from a jump-flood distance field of the thresholded matte), plus a Gaussian of the stroke (sigma `glow / 5 × s` px) added. |
| `body-glow` | M | aura, halo, person | `matte` blurred with sigma `radius / 2 × s` px, multiplied by `1 − matte`, coloured `color`, added × `intensity / 50`. |
| `background-blur` | M | portrait, depth, bokeh | `mix(blur(input, sigma intensity / 5 × s px), input, matte)`. |
| `background-mono` | M | colour pop, selective, grey | `mix(mix(input, luma, amount / 100), input, matte)`. |
| `body-echo` | M | echo, ghost, dance | `copies` copies of the matted person of the CURRENT frame (`input × matte`) are drawn behind the person, copy `k` (1…`copies`) displaced by `k × distance × s` px along `angle` with alpha `(1 − fade / 100)^k`, farthest copy first; then the person (`input × matte`) is drawn on top over the unmodified input. No earlier frame is read. |

## Filters (39)

A recipe is a set of `color-adjustment` values; every value not listed is at its default. Notation:
`B{…}` basic sliders (`color-adjustment.Basic adjustment sliders`); `W{shadows|midtones|highlights: angle°, amount,
luminance}` a colour-wheel puck given in polar form — the stored puck is `x = amount × cos(angle)`,
`y = amount × sin(angle)`, and its effect on R, G and B is the closed formula of `color-adjustment.Colour wheels`
(hue angle 0° = red, 120° = green, 240° = blue, counter-clockwise); `C{master|r|g|b: (x, y)…}` extra curve points between
(0,0) and (1,1) unless an end point is restated (`color-adjustment.Curves`); `H{band: hue, saturation, lightness}`
(`color-adjustment.HSL per colour band`). Recipes are baked by `color-adjustment.LUT bake procedure` with the stage order
of `render-engine.Colour adjustment pipeline order` and without the spatial pass (sharpness, clarity, vignette and grain
are never part of a filter recipe; `fade` is baked as its pointwise tone lift). 19 of the 39 recipes use `W{…}`.

| Type id | Category | Recipe (normative) |
|---|---|---|
| `amber-reel` | Film | B{temperature 22, tint 4, contrast 8, saturation −6, fade 8}; W{shadows: 200°, 0.12, 0; highlights: 40°, 0.15, 0} |
| `teal-dusk` | Film | B{temperature −10, contrast 12, saturation −8}; W{shadows: 190°, 0.25, −5; highlights: 35°, 0.10, 0} |
| `silver-halide` | Film | B{saturation −35, contrast 18, blacks −8}; C{master: (0.25, 0.20), (0.75, 0.80)} |
| `matinee` | Film | B{temperature 12, contrast 6, highlights −15, fade 12}; C{master: (0, 0.04), (0.5, 0.52)} |
| `blockbuster` | Film | B{contrast 24, saturation −6, blacks −8}; W{shadows: 215°, 0.20, −4; highlights: 50°, 0.14, 0}; C{master: (0.2, 0.15), (0.8, 0.86)} |
| `noir-classic` | Film | B{saturation −100, contrast 30, blacks −15, whites 8}; C{master: (0.2, 0.12), (0.8, 0.88)} |
| `soft-skin` | Portrait | B{contrast −8, highlights −10, shadows 12, temperature 6}; H{orange: 0, −10, 8; red: 0, −8, 4} |
| `porcelain` | Portrait | B{exposure 6, contrast −10, saturation −12, tint −4}; H{orange: −5, −15, 12} |
| `rosy` | Portrait | B{tint 12, temperature 4, saturation 6}; W{midtones: 350°, 0.10, 4}; H{red: 0, 10, 0} |
| `honey` | Portrait | B{temperature 18, saturation 8, shadows 8}; W{highlights: 45°, 0.18, 0}; H{yellow: −10, 10, 0} |
| `clear-day` | Portrait | B{exposure 5, contrast 6, vibrance 15, temperature −4}; H{blue: 0, 12, −4} |
| `evergreen` | Landscape | B{contrast 10, vibrance 12}; H{green: 10, 25, −6; yellow: 20, 5, 0; aqua: 0, 10, 0} |
| `alpine` | Landscape | B{temperature −14, contrast 12, whites 10, vibrance 10}; H{blue: 0, 20, −8; aqua: 0, 15, 0} |
| `golden-hour` | Landscape | B{temperature 30, tint 6, contrast 6, shadows 10}; W{highlights: 40°, 0.25, 4}; H{orange: 0, 18, 0; yellow: −8, 10, 0} |
| `deep-sea` | Landscape | B{temperature −22, contrast 10, saturation 6}; W{shadows: 210°, 0.22, −6}; H{aqua: −10, 20, 0; blue: 0, 15, −6} |
| `autumn` | Landscape | B{temperature 14, contrast 8}; H{green: −60, −10, 0; yellow: −30, 15, 0; orange: 0, 20, 0; red: 0, 10, 0} |
| `fresh` | Food | B{exposure 6, vibrance 20, temperature −3, contrast 6}; H{green: 0, 15, 4; red: 0, 10, 0} |
| `warm-plate` | Food | B{temperature 16, saturation 12, shadows 10, contrast 6}; H{orange: 0, 15, 0; yellow: 0, 10, 2} |
| `crisp` | Food | B{contrast 18, whites 10, blacks −6, vibrance 10} |
| `bistro` | Food | B{temperature 10, contrast 12, saturation −4, fade 6}; W{shadows: 30°, 0.10, −4} |
| `neon-night` | Night | B{contrast 16, saturation 20, blacks −10}; W{shadows: 270°, 0.25, 0; highlights: 320°, 0.18, 0}; H{magenta: 0, 25, 0; aqua: 0, 25, 0} |
| `moonlight` | Night | B{temperature −30, exposure −8, saturation −20, contrast 10}; W{midtones: 215°, 0.15, 0} |
| `city-glow` | Night | B{shadows 15, contrast 8, vibrance 15}; W{shadows: 220°, 0.18, 0; highlights: 35°, 0.20, 0} |
| `midnight-blue` | Night | B{temperature −38, tint −6, exposure −12, contrast 14, saturation −10}; W{shadows: 230°, 0.30, −4} |
| `seventies` | Retro | B{temperature 20, tint 8, saturation −12, fade 18, contrast −6}; C{b: (0, 0.08), (1, 0.90)} |
| `faded-print` | Retro | B{fade 30, saturation −20, contrast −12}; C{master: (0, 0.10), (1, 0.94)} |
| `sepia` | Retro | B{saturation −100, contrast 6}; W{shadows: 35°, 0.20, 0; midtones: 35°, 0.30, 0; highlights: 45°, 0.18, 0} |
| `instant-warm` | Retro | B{temperature 14, fade 14, contrast 10, saturation −6}; C{r: (0.5, 0.56); b: (0.5, 0.44)} |
| `cross-process` | Retro | B{contrast 18, saturation 10}; C{r: (0.25, 0.18), (0.75, 0.85); g: (0.5, 0.56); b: (0, 0.12), (1, 0.82)} |
| `mono` | Mono | B{saturation −100} |
| `mono-contrast` | Mono | B{saturation −100, contrast 45, blacks −20, whites 15} |
| `soft-grey` | Mono | B{saturation −100, contrast −18, fade 16} |
| `blue-tone` | Mono | B{saturation −100, contrast 8}; W{shadows: 220°, 0.28, 0; midtones: 215°, 0.18, 0} |
| `selenium` | Mono | B{saturation −100, contrast 12}; W{shadows: 290°, 0.14, 0; highlights: 40°, 0.10, 0} |
| `cyber` | Style | B{contrast 20, saturation 15}; W{shadows: 280°, 0.30, 0; highlights: 175°, 0.25, 0}; H{green: −40, 10, 0} |
| `pastel` | Style | B{contrast −20, saturation −18, exposure 8, fade 20}; W{midtones: 330°, 0.08, 6} |
| `bleach-bypass` | Style | B{saturation −45, contrast 35, blacks −10, whites 6} |
| `orange-teal` | Style | B{contrast 12, vibrance 10}; W{shadows: 185°, 0.32, 0; highlights: 30°, 0.28, 0}; H{blue: −15, 10, 0; orange: 0, 12, 0} |
| `dream` | Style | B{exposure 6, contrast −14, highlights 12, saturation 8, fade 10}; W{highlights: 320°, 0.12, 6} |
