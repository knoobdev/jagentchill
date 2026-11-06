# transitions — normative catalogue

This file is normative. It is cited by `transitions.Bundled transition library`. Parameter names, ranges and defaults are
in the spec table; this file adds, per id, the algorithm and search keywords. All content is authored for JAgentChill.

Conventions
- `A` = outgoing input, `B` = incoming input, both canvas-size textures as defined by `transitions.Transition rendering`
  (each clip processed up to and including its `opacity` stage; on the main track over its own background).
- **Alpha** (`render-engine.Transition alpha and blend rule`). `A` and `B` are premultiplied on entry; every formula below (`mix`, wipes, sums, displaced samples) operates
  on premultiplied RGBA; the result is un-premultiplied on exit. A colour the transition introduces (`black`, `white`,
  `color`, bars, rims, flashes, shadows) has alpha `max(A.a, B.a)` at that pixel, premultiplied. "Hidden" parts of an
  input contribute transparent black. A displaced or scaled sample taken outside an input's texture is transparent black
  unless the row says clamp.
- `p` = eased progress in 0…1 (`transitions.Transition rendering`); every transition outputs `A` at `p = 0` and `B` at
  `p = 1`.
- `uv` = normalised canvas coordinates (0…1, origin top-left); `W`, `H` = canvas width and height in render-target
  pixels; `D` = the distance from the canvas centre to a corner; `s` = the pixel scale factor of
  `visual-effects-filters.Resolution-independent effect parameters`; `rand(i)` = `hash(seed, i)` with the engine's integer
  hash (`render-engine.Deterministic hash`) mapped to 0…1 (never wall-clock time or a platform random source);
  `vnoise(x, cell)` = value noise of that hash on a lattice of `cell` (in the stated unit) with smoothstep interpolation,
  range 0…1.
- "0–100" parameters are used as `q = value / 100` unless a mapping is stated.
- **Softness.** `w = softness / 200` is a half-width in the unit of the compared quantity, which every row normalises to
  0…1. `soft(e, x) = smoothstep(e − w, e + w, x)`. A wipe compares a normalised coordinate `x` with the stretched
  progress `p' = p × (1 + 2w) − w`, so the edge is fully outside the range at both end points and `p = 0` / `p = 1` are
  exact: "wipe(x)" means `B` weight `= 1 − soft(p', x)` (B appears where `x < p'`).
- `dir` = unit vector of `direction4` (left = content travels toward −x); `along` = the canvas coordinate measured from
  the edge where incoming content enters (0) to the opposite edge (1).

| Type id | Keywords | Algorithm (normative) |
|---|---|---|
| `cross-dissolve` | fade, mix, dissolve | `mix(A, B, p)`. |
| `dip-to-black` | fade out, black | With `h = hold/100` and `F` = opaque black at alpha `max(A.a, B.a)`: for `p < (1−h)/2`, `mix(A, F, p / ((1−h)/2))`; `F` during the hold; then `mix(F, B, (p − (1+h)/2) / ((1−h)/2))`. |
| `dip-to-white` | flash, white | As `dip-to-black` with `F` = opaque white at alpha `max(A.a, B.a)`. |
| `dip-to-color` | colour, fade | As `dip-to-black` with `F` = `color` at alpha `max(A.a, B.a)`. |
| `additive-dissolve` | glow, bright, add | `min(1, A × (1 − p) × (1 + p) + B × p × (2 − p))`. |
| `linear-wipe` | wipe, line, reveal | `x` = position along `angle` normalised 0…1 over the canvas (0 on the side where `B` enters); wipe(x). |
| `clock-wipe` | radial, clock, wipe | `x` = the polar angle of the pixel about the canvas centre, measured from `startAngle` (0° = up) in `direction`, divided by 360° (0…1); wipe(x). |
| `barn-door` | doors, split, wipe | `dn` = distance of the pixel from the centre line (vertical line for `horizontal`, horizontal line for `vertical`) divided by half the canvas extent across it (0 at the line, 1 at the edge). `open`: wipe(dn) (B grows outward from the centre line); `close`: wipe(1 − dn) (B grows inward from both edges). |
| `slide` | move, slide in | `B` translated from `−dir` × canvas size to 0 over `A`, which stays still. |
| `push` | push, shove | `A` translated by `dir × p` × canvas size and `B` following edge to edge. |
| `cover` | cover, slide over | `B` slides in over a static `A` with a 24 × s px shadow at 40 % black on its leading edge. |
| `uncover` | uncover, slide away | `A` slides out by `dir × p` revealing a static `B`, same shadow on `A`'s trailing edge. |
| `elastic-slide` | bounce, spring, slide | As `push` with progress remapped `p' = 1 − cos(4.5π p) × exp(−(6 − 4 × bounce/100) p)`, clamped to 0…1.15, and rescaled so `p'(1) = 1` exactly (`p' ← p' / p'(1)` evaluated before clamping). While `p' > 1` (overshoot) the strip left uncovered behind `B` shows `B`'s edge texels repeated (clamp). |
| `zoom-in` | zoom, punch, camera | `A` scales 100 % → `scale` and fades out over `p ∈ [0.4, 0.6]` while `B` scales `10000/scale` % → 100 %; zoom blur of strength `blur × sin(π p)`. |
| `zoom-out` | zoom, pull back | `A` scales 100 % → `10000/scale` %, `B` scales `scale` → 100 %, same cross-fade window and blur. |
| `whip-pan` | swish, pan, fast | As `push` with directional blur of length `blur × 4 × s × sin(π p)` px along `dir`. |
| `spin` | rotate, twirl, camera | Both layers rotate about the centre by `turns × 360° × p` (`A`) and `turns × 360° × (p − 1)` (`B`) in `direction`, cross-fade over `p ∈ [0.4, 0.6]`, radial blur `blur × sin(π p)`. |
| `roll` | roll, rotate | `A` rotates rigidly by `90° × p` about the bottom-left canvas corner (clockwise) or by `−90° × p` about the bottom-right corner (counter-clockwise), drawn over a static `B`; at `p = 1` it has left the canvas. |
| `shake-cut` | shake, impact, hit | Hard switch from `A` to `B` at `p = 0.5`; both translated by `intensity × 0.6 × s` px × value-noise(24 Hz, seed) × `sin(π p)`. |
| `pull-focus` | rack focus, defocus | Gaussian blur of sigma `blur / 5 × s × sin(π p)` px on `mix(A, B, smoothstep(0.35, 0.65, p))`. |
| `blur-dissolve` | soft, blur, fade | Gaussian sigma `blur / 5 × s × sin(π p)` px on `mix(A, B, p)`. |
| `directional-blur-wipe` | motion, streak | Directional blur along `angle` of length `blur × 4 × s × sin(π p)` px on `mix(A, B, p)`. |
| `zoom-blur-dissolve` | zoom, burst | Zoom blur from the centre of strength `blur × sin(π p)` on `mix(A, B, p)`. |
| `ripple-dissolve` | water, wave | Both layers displaced radially by `amplitude × 0.3 × s × sin(π p)` px × `sin(2π frequency r − 6π p)`, mixed by `p`. |
| `swirl` | twirl, spiral | Twirl about the centre by `angle × sin(π p)` (falling to 0 at the canvas corner), mixed by `smoothstep(0.3, 0.7, p)`. |
| `liquid-warp` | fluid, melt, morph | Displace both layers by `strength × 0.5 × s × sin(π p)` px along the gradient of 2-octave value noise of cell `scale × 8 × s` px (seeded), mixed by `p`. |
| `domain-warp` | domain, fluid, bend | Two seeded 2-octave noise fields offset the outgoing and incoming UVs in opposite directions by up to `strength × 0.9 × s × sin(π p)` px; the layers mix by `p`. |
| `stretch` | smear, elastic | `A` scaled along the axis of `dir` by `1 + amount/100 × 4 × p` anchored at the far edge while fading out over `p ∈ [0.5, 1]`; `B` the mirror image, fading in over `p ∈ [0, 0.5]`. |
| `glitch-cut` | digital, corrupt | Hard switch at `p = 0.5`; for `p ∈ [0.2, 0.8]` rows in 16 × s px bands shift by `±intensity × 0.8 × s` px where `rand(band, floor(p × 12)) < 0.5`, with a 3 px RGB split. |
| `rgb-split-cut` | chromatic, split | `mix(A, B, p)` with red and blue offset by `±amount × 0.6 × s × sin(π p)` px horizontally. |
| `chromatic-split` | chromatic, prism, colour | `mix(A, B, p)` with red and blue offset by `±amount × 0.7 × s × sin(π p)` px along `direction`; green remains centred. |
| `pixelate` | mosaic, blocks | Mosaic of cell `max(1, maxBlock × s × sin(π p))` px on `mix(A, B, step(0.5, p))`. |
| `signal-noise` | static, tv | `mix(A, B, step(0.5, p))` mixed with mono noise by `intensity/100 × sin(π p)`; noise re-seeded per frame from `hash(seed, frameIndex)`. |
| `flash` | white flash, pop | `mix(A, B, step(0.5, p)) + color × intensity/100 × (1 − abs(2p − 1))²`, clamped. |
| `light-sweep` | shine, streak | `x` = position along `angle` normalised 0…1 over the canvas (as `linear-wipe`); `B` weight `= 1 − smoothstep(p'' − 0.05, p'' + 0.05, x)` with `p'' = 1.1 p − 0.05`; plus a band of light `color × exp(−((x − p'') / (width / 200))²) × sin(π p)` at alpha `max(A.a, B.a)`, added. |
| `film-burn` | burn, leak, analog | `x` = 3-octave `vnoise` (cells 0.25, 0.125 and 0.0625 `W`; weights 0.5, 0.3, 0.2; seeded with `seed`); wipe(x) with `w = 0.02`; plus `color × intensity / 100 × (1 − smoothstep(0, 0.08, |x − p'|))` added at alpha `max(A.a, B.a)`. |
| `glow-dissolve` | bloom, dreamy | `mix(A, B, p)` plus Gaussian (sigma 12 × s px) of the bright-pass above 0.6 × `intensity/50 × sin(π p)`. |
| `light-leak-transition` | film, flare, warm | `mix(A, B, p)` plus `color × intensity/100 × sin(π p)` under a soft vertical Gaussian band centred at `0.5 + position/200 + 0.32 × (p − 0.5)`, with a gentle vertical falloff; the added light uses alpha `max(A.a, B.a)`. |
| `split-horizontal` | split, doors | `A` is cut along the horizontal centre line; the upper half moves up and the lower half down by `p / 2` of `H`, revealing `B` between them; each half's cut edge fades over `softness / 200` of `H` (alpha ramp inside the half), 0 = hard. |
| `split-vertical` | split, curtains | As `split-horizontal` along the vertical centre line: halves move left and right by `p / 2` of `W`, edge fade over `softness / 200` of `W`. |
| `diagonal-split` | diagonal, slash | `A` splits along a line through the centre at `angle`; halves move apart along the line's normal by `p × D`; edges are hard. |
| `shutter-slices` | blinds, slices | Canvas cut into `count` slices along `orientation`; slice `k` (0 … `count` − 1) reveals `B` by a hard wipe across the slice with progress `clamp(p × 2 − k / count, 0, 1)`. |
| `iris-circle` | circle, iris | `x` = distance of the pixel from (`centerX`, `centerY`) divided by the distance from that point to the farthest canvas corner; wipe(x). |
| `iris-shape` | shape, star, heart | As `iris-circle` (wipe on the normalised shape distance) with the signed-distance shape `shape` of `masks-blending-keying.Box-like masks` and `masks-blending-keying.Star mask` (5 points, inner ratio 0.45), centred, scaled so `p = 1` covers the canvas. |
| `luma-fade` | luma, bright first | `x = 1 − luma(A)` (luma of the un-premultiplied colour; `invert` uses `x = luma(A)`); wipe(x), so the brightest areas of `A` change first. |
| `noise-dissolve` | grain, dither | `x = vnoise(pixel, scale × 2 × s px)` (seeded with `seed`); wipe(x). |
| `checkerboard` | squares, grid | Cells of a `rows × columns` grid; cells with even `row + column` reveal `B` over `p ∈ [0, 0.5]`, the others over `p ∈ [0.5, 1]`, each by a hard left-to-right wipe inside its cell. |
| `ink-spread` | ink, blot, paint | Five points `P_i = (rand(2i), rand(2i + 1))` in `uv`. `f = min_i |x − P_i| / (2D) + 0.15 × (n − 0.5)` with `n` = 2-octave `vnoise` of cell 0.08 `W` (second octave half the cell, half the weight). Ink (the `color` at alpha `max(A.a, B.a)`) covers where `f < 2.4 p` for `p < 0.5` and where `f > 2.4 p − 1.3` for `p ≥ 0.5`; under the ink `A` is replaced by `B` at `p = 0.5`; outside the ink the picture is `A` before and `B` after 0.5; the ink edge is `soft` with `w = softness / 200`. |
| `paper-tear` | tear, rip, paper | Tear front at `e = 1.06 × (1 − p) − 0.03` in `along`, offset per pixel by `j = 0.03 × (2 × vnoise1(v × 12) − 1)`, `v` = the normalised coordinate across `dir` (12 noise cells across the canvas, seeded 0). `B` is shown where `along > e + j`, `A` elsewhere (A does not move); a rim `6 × s` px wide in `edgeColor` lies on `A`'s side of the front. |
| `color-bars` | bars, stripes, motion graphics | With `e_k = clamp((p − 0.12 k) / 0.5, 0, 1)` for `k` = 0, 1, 2 and `t = clamp((p − 0.5) / 0.5, 0, 1)`, per pixel by its `along`: `along < t` → `B`; else `along < e_2` → `colorC`; else `along < e_1` → `colorB`; else `along < e_0` → `colorA`; else `A`. Bars span the full canvas across `dir`; edges are hard. |
| `circle-burst` | rings, burst, motion graphics | Ring `k` (0 … `rings` − 1) has outer radius `R_k = clamp((p − k × 0.5 / rings) / 0.5, 0, 1) × 1.12 D` and inner radius `max(0, R_k − 0.12 D)` about the canvas centre, filled with `color`; rings are hard-edged. `B` is shown inside the inner radius of the last ring (`k = rings − 1`); elsewhere `A`, with the rings drawn over it. |
| `swipe-up` | story, vertical, swipe | As `push` with direction up and progress remapped `p' = p + bounce/100 × 0.1 × sin(2π p) × (1 − p)`. |
| `flip` | card, flip, 3d | A card rotates by `180° × p` about the canvas centre axis (vertical axis for `horizontal`, horizontal axis for `vertical`), viewed by a perspective camera on the canvas normal at a distance of 2.5 × the canvas extent across the axis; the card shows `A` while the angle is below 90° and `B` (mirrored back so it reads normally) above; uncovered pixels are transparent. |
| `page-turn` | page, book, curl | For `left` (others by rotation): curl line at `x0 = 1.16 − 1.48 p` in canvas widths, cylinder radius `r = 0.08`. A point of `A` at `x ≤ x0` stays flat. A point of `A` at distance `d = x − x0 > 0` beyond the line is wrapped: for `d < πr` it is drawn at `x0 + r × sin(d / r)`, front side for `d / r < π/2` and back side (mirrored, × 0.7 brightness) for `d / r ≥ π/2`; for `d ≥ πr` it lies flat on top at `x0 − (d − πr)`, back side. Where the page has lifted, `B` shows, darkened by a shadow of alpha `shadow / 100 × 0.5 × exp(−max(0, x − x0 − r) / 0.05)` for `x > x0`. |
| `cube-rotate` | cube, 3d, rotate | `A` and `B` are adjacent faces of a box whose face is the canvas and whose depth equals the canvas extent along `dir`; the box rotates by `90° × p` about its centre axis perpendicular to `dir`; perspective camera on the canvas normal with vertical field of view `20° + perspective × 0.4°`, placed so the front face exactly fills the canvas at `p = 0` and at `p = 1`; uncovered pixels are transparent. |
