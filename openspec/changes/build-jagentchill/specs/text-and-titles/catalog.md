# text-and-titles — normative catalogue

This file is normative for `text-and-titles` (cited by the requirements "Bundled fonts", "Text effect presets", "Text bubbles", "Text animations in, out and loop" and "Text templates"). Every row is shipped content authored for JAgentChill; nothing here is taken from another product. Ids are stable: an id is never reused for different content, and a removed id keeps resolving through the missing-resource rule of the spec. The data lives in `packages/editor-core/src/content/text/` and a unit test compares it cell by cell with these tables.

Conventions: colours are `#rrggbb` or `#rrggbbaa`; "—" means the feature is disabled; percentages of "fs" are percentages of the rendered font size; positions are the element centre as % of canvas width, % of canvas height from the canvas centre (+x right, +y down).

## 1. Bundled fonts

All files ship inside the engine bundle (`packages/render/assets/fonts/`), each with a provenance row (source URL, licence id, copyright line) and a SHA-256 in `fonts.manifest.json`. "Engine" = loaded with the engine; "On demand" = loaded from the app bundle when first needed.

| Family | Resolves the name(s) | Styles bundled | Scripts | Licence | Load |
|---|---|---|---|---|---|
| Arimo | Arial, Helvetica | 400, 400 italic, 700, 700 italic | Latin, Latin Extended, Vietnamese, Cyrillic, Greek, Hebrew | Apache-2.0 | Engine |
| Tinos | Times New Roman | 400, 400 italic, 700, 700 italic | Latin, Latin Extended, Vietnamese, Cyrillic, Greek, Hebrew | Apache-2.0 | Engine |
| Cousine | Courier New | 400, 400 italic, 700, 700 italic | Latin, Latin Extended, Vietnamese, Cyrillic, Greek, Hebrew | Apache-2.0 | Engine |
| Gelasio | Georgia | 400, 400 italic, 700, 700 italic | Latin, Latin Extended, Vietnamese | OFL-1.1 | Engine |
| DejaVu Sans | Verdana | 400, 400 oblique, 700, 700 oblique | Latin, Latin Extended, Cyrillic, Greek | Bitstream-Vera | Engine |
| Noto Sans | sans-serif; fallback 1 | 400, 400 italic, 700, 700 italic | Latin, Latin Extended, Vietnamese, Cyrillic, Greek | OFL-1.1 | Engine |
| Noto Serif | serif | 400, 400 italic, 700, 700 italic | Latin, Latin Extended, Vietnamese, Cyrillic, Greek | OFL-1.1 | Engine |
| Noto Sans Mono | monospace | 400, 700 | Latin, Latin Extended, Vietnamese, Cyrillic, Greek | OFL-1.1 | Engine |
| Noto Sans JP | fallback 2 | 400, 700 | Japanese (kana, kanji) | OFL-1.1 | On demand |
| Noto Sans SC | fallback 3 | 400, 700 | Simplified Chinese | OFL-1.1 | On demand |
| Noto Sans KR | fallback 4 | 400, 700 | Korean | OFL-1.1 | On demand |
| Noto Naskh Arabic | fallback 5 | 400, 700 | Arabic | OFL-1.1 | On demand |
| Noto Sans Hebrew | fallback 6 | 400, 700 | Hebrew | OFL-1.1 | On demand |
| Noto Sans Thai | fallback 7 | 400, 700 | Thai | OFL-1.1 | On demand |
| Noto Sans Devanagari | fallback 8 | 400, 700 | Devanagari (Hindi) | OFL-1.1 | On demand |
| Noto Color Emoji | fallback 9 (emoji) | regular (colour, COLR/CPAL) plus the 512 px bitmap set used as the fallback of decision E5 | Emoji | OFL-1.1 | On demand |

A weight that is not bundled for a family is synthesised from the nearest bundled weight by the rules of the requirement "Font weight, italic, underline and strikethrough". The weight select lists only the bundled weights.

## 2. Text effect presets (40)

Stroke = `colour width position` (width in % fs). Shadow = `colour opacity blur distance angle` (blur and distance in % fs). Glow = `colour intensity radius` (radius in % fs). Gradient = `second colour @ angle`.

| # | id | Name | Group | Fill | Gradient | Stroke | Shadow | Glow |
|---|---|---|---|---|---|---|---|---|
| 1 | `plain-white` | Plain white | Basic | `#ffffff` | — | — | — | — |
| 2 | `plain-black` | Plain black | Basic | `#000000` | — | — | — | — |
| 3 | `soft-shadow` | Soft shadow | Basic | `#ffffff` | — | — | `#000000` 60 20 6 −45 | — |
| 4 | `hard-shadow` | Hard shadow | Basic | `#ffffff` | — | — | `#000000` 100 0 8 −45 | — |
| 5 | `yellow-pop` | Yellow pop | Basic | `#ffd400` | — | `#000000` 8 outside | — | — |
| 6 | `red-alert` | Red alert | Basic | `#ff3b30` | — | `#ffffff` 6 outside | — | — |
| 7 | `ink` | Ink | Basic | `#111111` | — | `#ffffff` 8 outside | — | — |
| 8 | `paper` | Paper | Basic | `#fff8e7` | — | — | `#5a3e1b` 50 12 4 −60 | — |
| 9 | `outline-black` | Black outline | Outline | `#ffffff` | — | `#000000` 6 outside | — | — |
| 10 | `outline-white` | White outline | Outline | `#000000` | — | `#ffffff` 6 outside | — | — |
| 11 | `outline-thick` | Thick outline | Outline | `#ffffff` | — | `#000000` 14 outside | — | — |
| 12 | `outline-blue` | Blue outline | Outline | `#ffffff` | — | `#1e6bff` 8 outside | — | — |
| 13 | `outline-pink` | Pink outline | Outline | `#ffffff` | — | `#ff2d92` 8 outside | — | — |
| 14 | `outline-green` | Green outline | Outline | `#eaffea` | — | `#0a8f3c` 8 outside | — | — |
| 15 | `hollow-white` | Hollow white | Outline | `#ffffff00` | — | `#ffffff` 4 center | — | — |
| 16 | `hollow-yellow` | Hollow yellow | Outline | `#ffffff00` | — | `#ffd400` 4 center | — | — |
| 17 | `drop-long` | Long drop | Shadow | `#ffffff` | — | — | `#000000` 80 0 14 −45 | — |
| 18 | `drop-blue` | Blue drop | Shadow | `#ffffff` | — | — | `#1e6bff` 100 0 8 −45 | — |
| 19 | `drop-pink` | Pink drop | Shadow | `#ffffff` | — | — | `#ff2d92` 100 0 8 −45 | — |
| 20 | `lifted` | Lifted | Shadow | `#ffffff` | — | — | `#000000` 45 40 12 −90 | — |
| 21 | `retro-duo` | Retro duo | Shadow | `#ffd400` | — | `#1a1a1a` 6 outside | `#ff3b30` 100 0 10 −45 | — |
| 22 | `comic` | Comic | Shadow | `#ffffff` | — | `#000000` 10 outside | `#000000` 100 0 10 −45 | — |
| 23 | `emboss` | Emboss | Shadow | `#d9d9d9` | — | — | `#ffffff` 80 2 3 135 | — |
| 24 | `night` | Night | Shadow | `#cfe3ff` | — | — | `#001a4d` 90 30 8 −90 | — |
| 25 | `neon-pink` | Neon pink | Neon | `#ffe6f4` | — | — | — | `#ff2d92` 80 30 |
| 26 | `neon-blue` | Neon blue | Neon | `#e6f4ff` | — | — | — | `#009dff` 80 30 |
| 27 | `neon-green` | Neon green | Neon | `#eaffea` | — | — | — | `#34c759` 80 30 |
| 28 | `neon-yellow` | Neon yellow | Neon | `#fffbe0` | — | — | — | `#ffcc00` 80 30 |
| 29 | `neon-purple` | Neon purple | Neon | `#f3e6ff` | — | — | — | `#af52de` 80 30 |
| 30 | `neon-red` | Neon red | Neon | `#ffe9e6` | — | — | — | `#ff3b30` 80 30 |
| 31 | `neon-tube` | Neon tube | Neon | `#ffffff00` | — | `#ffffff` 3 center | — | `#00e5ff` 90 35 |
| 32 | `halo-white` | White halo | Neon | `#ffffff` | — | — | — | `#ffffff` 60 45 |
| 33 | `sunset` | Sunset | Gradient | `#ffcc00` | `#ff3b30` @ 90 | — | — | — |
| 34 | `ocean` | Ocean | Gradient | `#00e5ff` | `#1e6bff` @ 90 | — | — | — |
| 35 | `candy` | Candy | Gradient | `#ff2d92` | `#af52de` @ 45 | — | — | — |
| 36 | `lime` | Lime | Gradient | `#d4ff3b` | `#34c759` @ 90 | — | — | — |
| 37 | `gold` | Gold | Gradient | `#fff2b0` | `#c98a00` @ 90 | `#5a3e00` 4 outside | — | — |
| 38 | `silver` | Silver | Gradient | `#ffffff` | `#8e8e93` @ 90 | `#2c2c2e` 4 outside | — | — |
| 39 | `fire` | Fire | Gradient | `#ffe600` | `#ff3b30` @ 90 | — | — | `#ff9500` 60 25 |
| 40 | `aurora` | Aurora | Gradient | `#34c759` | `#af52de` @ 0 | — | `#000000` 60 16 5 −45 | — |

## 3. Text bubbles (20)

Paths are SVG path data on a 100×100 box (y down), filled with the even-odd rule unless marked "stroke only". The text area is `x, y, w, h` in the same units. Defaults: fill, stroke colour, stroke width (in the bubble's own 0–20 scale). Text colour is not changed by a bubble.

| # | id | Name | Group | Path | Text area | Fill | Stroke | Width |
|---|---|---|---|---|---|---|---|---|
| 1 | `speech-round-left` | Speech, tail left | Speech | `M10 5 H90 Q95 5 95 10 V65 Q95 70 90 70 H35 L18 92 L22 70 H10 Q5 70 5 65 V10 Q5 5 10 5 Z` | 10, 10, 80, 55 | `#ffffff` | `#000000` | 4 |
| 2 | `speech-round-right` | Speech, tail right | Speech | `M10 5 H90 Q95 5 95 10 V65 Q95 70 90 70 H78 L82 92 L65 70 H10 Q5 70 5 65 V10 Q5 5 10 5 Z` | 10, 10, 80, 55 | `#ffffff` | `#000000` | 4 |
| 3 | `speech-oval-left` | Oval speech, tail left | Speech | `M50 5 C78 5 95 20 95 38 C95 56 78 71 50 71 C44 71 38 70 33 69 L16 92 L22 64 C11 58 5 49 5 38 C5 20 22 5 50 5 Z` | 18, 15, 64, 46 | `#ffffff` | `#000000` | 4 |
| 4 | `speech-oval-right` | Oval speech, tail right | Speech | `M50 5 C22 5 5 20 5 38 C5 56 22 71 50 71 C56 71 62 70 67 69 L84 92 L78 64 C89 58 95 49 95 38 C95 20 78 5 50 5 Z` | 18, 15, 64, 46 | `#ffffff` | `#000000` | 4 |
| 5 | `speech-square` | Square speech | Speech | `M5 5 H95 V70 H58 L50 90 L42 70 H5 Z` | 10, 10, 80, 55 | `#ffffff` | `#000000` | 4 |
| 6 | `thought-cloud` | Thought cloud | Thought | `M25 60 C10 60 5 48 12 40 C6 30 14 16 28 20 C32 8 52 4 60 16 C72 8 90 16 86 32 C97 38 94 58 78 60 C70 68 56 68 50 62 C42 68 30 68 25 60 Z M16 74 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 Z M8 88 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 Z` | 20, 22, 60, 34 | `#ffffff` | `#000000` | 4 |
| 7 | `thought-oval` | Thought oval | Thought | `M50 6 C76 6 95 19 95 36 C95 53 76 66 50 66 C24 66 5 53 5 36 C5 19 24 6 50 6 Z M20 76 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 Z M10 90 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 Z` | 18, 16, 64, 40 | `#ffffff` | `#000000` | 4 |
| 8 | `shout-burst` | Burst | Shout | `M50 2 L58 20 L74 8 L74 27 L93 22 L84 39 L98 50 L84 61 L93 78 L74 73 L74 92 L58 80 L50 98 L42 80 L26 92 L26 73 L7 78 L16 61 L2 50 L16 39 L7 22 L26 27 L26 8 L42 20 Z` | 26, 30, 48, 40 | `#ffd400` | `#000000` | 4 |
| 9 | `shout-jagged` | Jagged shout | Shout | `M5 12 L18 5 L30 12 L42 5 L54 12 L66 5 L78 12 L95 5 L90 22 L97 36 L90 50 L95 68 L70 64 L60 70 L40 64 L24 92 L26 66 L5 68 L10 50 L3 36 L10 22 Z` | 16, 18, 68, 42 | `#ffffff` | `#000000` | 4 |
| 10 | `label-rect` | Rectangle label | Label | `M0 0 H100 V100 H0 Z` | 8, 15, 84, 70 | `#111111` | `#000000` | 0 |
| 11 | `label-rounded` | Rounded label | Label | `M12 0 H88 Q100 0 100 12 V88 Q100 100 88 100 H12 Q0 100 0 88 V12 Q0 0 12 0 Z` | 8, 15, 84, 70 | `#111111` | `#000000` | 0 |
| 12 | `label-pill` | Pill label | Label | `M25 0 H75 A25 50 0 0 1 75 100 H25 A25 50 0 0 1 25 0 Z` | 16, 18, 68, 64 | `#1e6bff` | `#000000` | 0 |
| 13 | `banner-ribbon` | Ribbon | Banner | `M0 15 H100 L90 50 L100 85 H0 L10 50 Z` | 16, 25, 68, 50 | `#ff3b30` | `#000000` | 0 |
| 14 | `banner-fold` | Folded banner | Banner | `M10 10 H90 V70 H10 Z M0 25 H10 V85 H0 L6 55 Z M100 25 H90 V85 H100 L94 55 Z` | 15, 18, 70, 44 | `#ffd400` | `#000000` | 3 |
| 15 | `banner-arrow` | Arrow banner | Banner | `M0 10 H80 L100 50 L80 90 H0 Z` | 6, 22, 70, 56 | `#34c759` | `#000000` | 0 |
| 16 | `tag-left` | Tag with hole | Tag | `M22 5 H95 V95 H22 L2 50 Z M10 50 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 Z` | 30, 18, 60, 64 | `#ff9500` | `#000000` | 3 |
| 17 | `tag-corner` | Cut-corner tag | Tag | `M0 0 H82 L100 18 V100 H0 Z` | 8, 15, 80, 70 | `#af52de` | `#000000` | 0 |
| 18 | `frame-thin` | Thin frame | Frame | `M0 0 H100 V100 H0 Z` | 10, 15, 80, 70 | `#ffffff00` | `#ffffff` | 3 |
| 19 | `frame-brackets` | Brackets (stroke only) | Frame | `M18 0 H0 V100 H18 M82 0 H100 V100 H82` | 12, 12, 76, 76 | `#ffffff00` | `#ffffff` | 4 |
| 20 | `frame-underline` | Underline bar | Frame | `M0 88 H100 V100 H0 Z` | 0, 0, 100, 82 | `#ffd400` | `#000000` | 0 |

## 4. Text animations

General rules. Progress `p` runs 0→1 over the animation's duration (In, Out) and cycle position `φ = ((t − inEnd) mod period) / period` (Loop). Units: `block` = whole element; `line`, `word`, `character` = each unit animates separately. Stagger for units other than block, with `n` units and index `i` from 0 in reading order: each unit runs over a window of length `0.5 × D` starting at `i × 0.5 × D / (n − 1)` (for `n = 1` the window is the whole duration); Typewriter uses its own rule. Easings: `linear`; `out-cubic` = cubic-bezier(0.33, 1, 0.68, 1); `in-cubic` = cubic-bezier(0.32, 0, 0.67, 0); `out-back` = cubic-bezier(0.34, 1.56, 0.64, 1); `step` = value changes at the stated instants. `bh` = block height, `bw` = block width. `hash(a, b, c)` is the engine's deterministic hash to [−1, 1] of `render-engine` seeded by the element id. Opacity ramps are not scaled by `strength`; every other quantity is multiplied by `strength / 100`.

### 4.1 In (20)

| # | id | Name | Unit | Motion at strength 100 (start → end) | Easing |
|---|---|---|---|---|---|
| 1 | `in-fade` | Fade | block | opacity 0 → 1 | linear |
| 2 | `in-typewriter` | Typewriter | character | character `i` of `n` switches from opacity 0 to 1 at `p = i / n` | step |
| 3 | `in-slide-up` | Slide up | block | translateY +100 % bh → 0; opacity 0 → 1 | out-cubic |
| 4 | `in-slide-down` | Slide down | block | translateY −100 % bh → 0; opacity 0 → 1 | out-cubic |
| 5 | `in-slide-left` | Slide left | block | translateX +100 % bw → 0; opacity 0 → 1 | out-cubic |
| 6 | `in-slide-right` | Slide right | block | translateX −100 % bw → 0; opacity 0 → 1 | out-cubic |
| 7 | `in-zoom-in` | Zoom in | block | scale 0.5 → 1; opacity 0 → 1 | out-cubic |
| 8 | `in-zoom-out` | Zoom out | block | scale 1.6 → 1; opacity 0 → 1 | out-cubic |
| 9 | `in-pop` | Pop | word | scale 0 → 1; opacity 0 → 1 during the first 30 % of the window | out-back |
| 10 | `in-bounce` | Bounce | character | translateY keyframes (p: % fs) 0: −80, 0.55: 0, 0.70: −18, 0.85: 0, 0.93: −6, 1: 0; opacity 0 → 1 during the first 20 % | linear between keys |
| 11 | `in-blur` | Blur | block | Gaussian blur radius 40 % fs → 0; opacity 0 → 1 | out-cubic |
| 12 | `in-wipe-right` | Wipe right | line | reveal mask edge moves from the line's left edge to its right edge | linear |
| 13 | `in-wipe-left` | Wipe left | line | reveal mask edge moves from the line's right edge to its left edge | linear |
| 14 | `in-rise` | Rise | word | translateY +60 % fs → 0; opacity 0 → 1 | out-cubic |
| 15 | `in-drop` | Drop | word | translateY −60 % fs → 0; opacity 0 → 1 | out-cubic |
| 16 | `in-spin` | Spin | character | rotate −180° → 0°; scale 0.4 → 1; opacity 0 → 1 | out-cubic |
| 17 | `in-flicker` | Flicker | block | opacity 0, 1, 0, 1, 0.3, 1 at p = 0, 0.15, 0.30, 0.50, 0.70, 1 | step |
| 18 | `in-stretch` | Stretch | block | scaleX 2.2 → 1; opacity 0 → 1 | out-cubic |
| 19 | `in-wave` | Wave | character | translateY keyframes (p: % fs) 0: +40, 0.6: −15, 1: 0; opacity 0 → 1 during the first 40 % | out-cubic per segment |
| 20 | `in-shake` | Shake | block | translateX (% fs) +12, −10, +8, −6, +3, 0 at p = 0, 0.2, 0.4, 0.6, 0.8, 1; opacity 0 → 1 during the first 20 % | linear between keys |

### 4.2 Out (20)

Each Out animation runs over the last `D` seconds of the element. Units are staggered in reverse reading order (the last unit leaves first) except where noted.

| # | id | Name | Unit | Motion at strength 100 (start → end) | Easing |
|---|---|---|---|---|---|
| 1 | `out-fade` | Fade | block | opacity 1 → 0 | linear |
| 2 | `out-typewriter` | Typewriter | character | character `i` of `n` switches from opacity 1 to 0 at `p = (n − 1 − i) / n` (last character first) | step |
| 3 | `out-slide-up` | Slide up | block | translateY 0 → −100 % bh; opacity 1 → 0 | in-cubic |
| 4 | `out-slide-down` | Slide down | block | translateY 0 → +100 % bh; opacity 1 → 0 | in-cubic |
| 5 | `out-slide-left` | Slide left | block | translateX 0 → −100 % bw; opacity 1 → 0 | in-cubic |
| 6 | `out-slide-right` | Slide right | block | translateX 0 → +100 % bw; opacity 1 → 0 | in-cubic |
| 7 | `out-zoom-in` | Zoom in | block | scale 1 → 1.6; opacity 1 → 0 | in-cubic |
| 8 | `out-zoom-out` | Zoom out | block | scale 1 → 0.5; opacity 1 → 0 | in-cubic |
| 9 | `out-pop` | Pop | word | scale 1 → 1.15 at 30 % of the window → 0; opacity 1 → 0 during the last 30 % | in-cubic |
| 10 | `out-bounce` | Bounce | character | translateY keyframes (p: % fs) 0: 0, 0.15: −18, 0.35: 0, 1: +80; opacity 1 → 0 during the last 20 % | linear between keys |
| 11 | `out-blur` | Blur | block | Gaussian blur radius 0 → 40 % fs; opacity 1 → 0 | in-cubic |
| 12 | `out-wipe-right` | Wipe right | line | hide mask edge moves from the line's left edge to its right edge (text disappears left to right); lines in reading order | linear |
| 13 | `out-wipe-left` | Wipe left | line | hide mask edge moves from the line's right edge to its left edge; lines in reading order | linear |
| 14 | `out-rise` | Rise | word | translateY 0 → −60 % fs; opacity 1 → 0 | in-cubic |
| 15 | `out-drop` | Drop | word | translateY 0 → +60 % fs; opacity 1 → 0 | in-cubic |
| 16 | `out-spin` | Spin | character | rotate 0° → +180°; scale 1 → 0.4; opacity 1 → 0 | in-cubic |
| 17 | `out-flicker` | Flicker | block | opacity 1, 0.3, 1, 0, 1, 0 at p = 0, 0.30, 0.50, 0.70, 0.85, 1 | step |
| 18 | `out-stretch` | Stretch | block | scaleX 1 → 2.2; opacity 1 → 0 | in-cubic |
| 19 | `out-wave` | Wave | character | translateY keyframes (p: % fs) 0: 0, 0.4: −15, 1: +40; opacity 1 → 0 during the last 40 % | in-cubic per segment |
| 20 | `out-shake` | Shake | block | translateX (% fs) 0, +3, −6, +8, −10, +12 at p = 0, 0.2, 0.4, 0.6, 0.8, 1; opacity 1 → 0 during the last 20 % | linear between keys |

### 4.3 Loop (12)

| # | id | Name | Unit | Motion at strength 100 as a function of cycle position φ | Easing |
|---|---|---|---|---|---|
| 1 | `loop-pulse` | Pulse | block | scale = 1 + 0.08 × sin(2πφ) | continuous |
| 2 | `loop-wobble` | Wobble | block | rotate = 4° × sin(2πφ) about the block centre | continuous |
| 3 | `loop-float` | Float | block | translateY = −8 % fs × sin(2πφ) | continuous |
| 4 | `loop-blink` | Blink | block | opacity = 1 for φ < 0.5, 0 otherwise (not scaled by strength) | step |
| 5 | `loop-swing` | Swing | block | rotate = 10° × sin(2πφ) about the top centre of the block | continuous |
| 6 | `loop-wave` | Wave | character | translateY = −15 % fs × sin(2π(φ − i / 8)) | continuous |
| 7 | `loop-jitter` | Jitter | character | translate (x, y) = 3 % fs × (hash(k, i, 0), hash(k, i, 1)) with k = floor(t × 12) | step at 12 Hz |
| 8 | `loop-rainbow` | Rainbow | block | fill hue rotated by 360° × φ in HSL, saturation and lightness kept | continuous |
| 9 | `loop-breathe` | Breathe | block | opacity = 0.75 + 0.25 × cos(2πφ) (not scaled by strength) | continuous |
| 10 | `loop-heartbeat` | Heartbeat | block | scale 1, 1.15, 1, 1.10, 1 at φ = 0, 0.14, 0.28, 0.42, 0.70; 1 until φ = 1 | linear between keys |
| 11 | `loop-scroll` | Scroll | line | translateX from +100 % of the box width to −100 % of the box width, clipped to the text box | linear |
| 12 | `loop-glitch` | Glitch | block | for φ in [0.9, 1): red and blue channels offset by ±4 % fs × hash(k, 0, 0) on X and the block split into 6 horizontal slices each shifted by 6 % fs × hash(k, slice, 1), with k = floor(t × 24); no change for φ < 0.9 | step at 24 Hz |

The period of every loop keeps flashing at or below 3 changes per second for the default period (1 s); the reduced-motion and flashing rules of `i18n-accessibility.Reduced motion and flashing` apply to the editor UI previews, not to rendered output.

## 5. Text templates (30)

Notation. `T` = text element: «sample text» · family weight · `fontSize` · look (preset id from section 2, bubble id from section 3, or explicit values) · alignment · position · animations (ids from section 4 with duration or period in seconds). `S` = shape element (`stickers-shapes.Shape parameter table`): definition · size as % of canvas width × % of canvas height · fill · position · keyframes. Elements start at the group start and last the whole template duration unless "from a s to b s" is stated. Font families are baseline names resolved by section 1. Sample text is the content inserted with the template. `fontSize` values use one decimal (step 0.1 of the requirement "Text parameter table"). Stored keyframes use the canonical paths of `project-document.Animatable property paths`: "scaleX", "scaleY", "positionX" and "positionY" in the rows below abbreviate `transform.scale.x`, `transform.scale.y`, `transform.position.x` and `transform.position.y`. Every element carries its own animations anchored to its own start and end; a template has no group-level animation.

| # | id | Name | Category | Duration | Elements |
|---|---|---|---|---|---|
| 1 | `title-clean` | Clean title | Titles | 4 s | T1 «Your title» · Arial 700 · 12 · `plain-white` · center · (0, 0) · `in-fade` 0.5, `out-fade` 0.5 |
| 2 | `title-outline` | Bold outline | Titles | 4 s | T1 «BIG TITLE» · Arial 700, case upper · 16 · `outline-thick` · center · (0, 0) · `in-pop` 0.6, `out-zoom-out` 0.4 |
| 3 | `title-stack` | Stacked title | Titles | 5 s | T1 «Main title» · Georgia 700 · 12 · `plain-white` · center · (0, −6) · `in-rise` 0.6, `out-fade` 0.4; S1 rectangle · 30 × 0.6 · `#ffd400` · (0, 2) · scaleX 0 → 1 from 0 s to 0.4 s (out-cubic); T2 «Subtitle goes here» from 0.3 s · Arial 400 · 6 · `plain-white` · center · (0, 8) · `in-fade` 0.6, `out-fade` 0.4 |
| 4 | `title-neon` | Neon sign | Titles | 4 s | T1 «NEON» · sans-serif 700 · 18 · `neon-pink` · center · (0, 0) · `in-flicker` 0.8, `loop-breathe` 2.0, `out-fade` 0.4 |
| 5 | `title-cinema` | Cinematic | Titles | 6 s | T1 «A FILM TITLE» · Times New Roman 400, case upper · 10 · `plain-white` · center · (0, 0) · `letterSpacing` keyframes 40 at 0 s → 60 at 6 s (linear) · `in-blur` 1.2, `out-fade` 1.0 |
| 6 | `title-typed` | Typed title | Titles | 4 s | T1 «Typing a title…» · Courier New 700 · 10 · `plain-white` · left, box fixed 70 · (0, 0) · `in-typewriter` 1.5, `out-fade` 0.3 |
| 7 | `lower-third-bar` | Name bar | Lower thirds | 4 s | S1 rectangle · 36 × 9 · `#111111cc` · (−28, 34) · scaleX 0 → 1 from 0 s to 0.3 s (out-cubic); T1 «Full Name» · Arial 700 · 6 · `plain-white` · left · (−28, 32) · `in-slide-right` 0.4, `out-fade` 0.3; T2 «Title or role» · Arial 400 · 4 · fill `#ffd400` · left · (−28, 37) · `in-fade` 0.4, `out-fade` 0.3 |
| 8 | `lower-third-line` | Accent line | Lower thirds | 4 s | S1 rectangle · 0.5 × 8 · `#ff3b30` · (−45, 34) · scaleY 0 → 1 from 0 s to 0.3 s; T1 «Full Name» · Arial 700 · 6 · `soft-shadow` · left · (−27, 32) · `in-slide-right` 0.4, `out-fade` 0.3; T2 «Title or role» · Arial 400 · 4 · `soft-shadow` · left · (−27, 37) · `in-slide-right` 0.5, `out-fade` 0.3 |
| 9 | `lower-third-box` | Boxed name | Lower thirds | 4 s | T1 «Full Name» · Arial 700 · 6 · fill `#111111`, background `#ffffff` radius 0 padding 30 × 42 · left · (−30, 31) · `in-wipe-right` 0.4, `out-fade` 0.3; T2 «Title or role» · Arial 400 · 4 · fill `#ffffff`, background `#111111` radius 0 padding 30 × 42 · left · (−30, 38) · `in-wipe-right` 0.5, `out-fade` 0.3 |
| 10 | `lower-third-pill` | Pill tag | Lower thirds | 4 s | T1 «Full Name» · Arial 700 · 5 · fill `#ffffff`, bubble `label-pill` · center · (−30, 36) · `in-pop` 0.4, `out-fade` 0.3 |
| 11 | `lower-third-two-tone` | Two-tone | Lower thirds | 5 s | S1 rectangle · 40 × 6 · `#ffd400` · (−26, 32) · scaleX 0 → 1 from 0 s to 0.3 s; S2 rectangle · 30 × 4 · `#111111` · (−31, 37.5) · scaleX 0 → 1 from 0.15 s to 0.45 s; T1 «Full Name» · Arial 700 · 5 · fill `#111111` · left · (−26, 32) · `in-fade` 0.4, `out-fade` 0.3; T2 «Title or role» · Arial 400 · 3.5 · fill `#ffffff` · left · (−31, 37.5) · `in-fade` 0.5, `out-fade` 0.3 |
| 12 | `lower-third-minimal` | Minimal | Lower thirds | 4 s | T1 «Full Name» · Georgia 700 · 6 · `soft-shadow` · left · (−30, 33) · `in-rise` 0.5, `out-fade` 0.3; T2 «Location · Date» · Arial 400 · 3.5, `letterSpacing` 20 · `soft-shadow` · left · (−30, 38) · `in-fade` 0.6, `out-fade` 0.3 |
| 13 | `subtitle-plain` | Plain subtitle | Subtitles | 3 s | T1 «Subtitle text goes here» · Arial 700 · 5 · `outline-black` · center, box fixed 80 · (0, 40) |
| 14 | `subtitle-boxed` | Boxed subtitle | Subtitles | 3 s | T1 «Subtitle text goes here» · Arial 400 · 5 · fill `#ffffff`, background `#000000b3` radius 20 padding 30 × 42 · center, box fixed 80 · (0, 40) |
| 15 | `subtitle-yellow` | Yellow subtitle | Subtitles | 3 s | T1 «Subtitle text goes here» · Arial 700 · 5 · `yellow-pop` · center, box fixed 80 · (0, 40) |
| 16 | `subtitle-speaker` | Speaker subtitle | Subtitles | 3 s | T1 «SPEAKER» · Arial 700 · 3.5 · fill `#ffd400`, stroke `#000000` 6 outside · center · (0, 35) ; T2 «What they say goes here» · Arial 400 · 5 · `outline-black` · center, box fixed 80 · (0, 41) |
| 17 | `social-follow` | Follow prompt | Social | 3 s | T1 «Follow for more» · Arial 700 · 6 · fill `#ffffff`, bubble `label-pill` with `bubble.color` `#ff2d92` · center · (0, 30) · `in-pop` 0.4, `loop-pulse` 1.0, `out-fade` 0.3 |
| 18 | `social-handle` | Handle tag | Social | 4 s | T1 «@yourname» · Arial 700 · 5 · fill `#ffffff`, bubble `label-rounded` · center · (0, −40) · `in-drop` 0.4, `out-fade` 0.3 |
| 19 | `social-countdown` | Countdown | Social | 3 s | T1 «3» from 0 s to 1 s, T2 «2» from 1 s to 2 s, T3 «1» from 2 s to 3 s · each Arial 700 · 30 · `outline-thick` · center · (0, 0) · `in-zoom-out` 0.3, `out-fade` 0.2 |
| 20 | `social-swipe` | Swipe hint | Social | 3 s | S1 arrow, rotation −90° · 6 × 6 · `#ffffff` · (0, 30) · positionY keyframes 30 → 27 → 30 (% of canvas height) every 1 s, out-cubic; T1 «Swipe up» · Arial 700 · 6 · `soft-shadow` · center · (0, 38) · `in-fade` 0.3, `loop-float` 1.0 |
| 21 | `social-new` | New badge | Social | 3 s | T1 «NEW» · Arial 700 · 8 · fill `#111111`, bubble `shout-burst` · center · (30, −30) · `in-spin` 0.5, `loop-wobble` 1.0, `out-zoom-out` 0.3 |
| 22 | `quote-classic` | Classic quote | Quotes | 5 s | T1 «“» · Georgia 700 · 30 · fill `#ffd400` · center · (−36, −18) · `in-fade` 0.5; T2 «Quote text goes here, two lines at most.» · Georgia 400 italic · 7 · `plain-white` · center, box fixed 70 · (0, 0) · `in-fade` 0.8, `out-fade` 0.5; T3 «— Author» · Arial 400 · 4 · `plain-white` · center · (0, 20) · `in-fade` 0.8, `out-fade` 0.5 |
| 23 | `quote-card` | Quote card | Quotes | 5 s | S1 rectangle, `cornerRadius` 6 · 80 × 44 · `#ffffff` · (0, 0) · opacity 0 → 1 from 0 s to 0.4 s; T1 «Quote text goes here, two lines at most.» · Georgia 400 · 6 · fill `#111111` · center, box fixed 68 · (0, −3) · `in-rise` 0.6, `out-fade` 0.4; T2 «— Author» · Arial 700 · 3.5 · fill `#111111` · center · (0, 15) · `in-fade` 0.6, `out-fade` 0.4 |
| 24 | `quote-bold` | Bold statement | Quotes | 4 s | T1 «ONE STRONG LINE» · Arial 700, case upper · 12 · `hard-shadow` · center, box fixed 80 · (0, 0) · `in-rise` 0.8, `out-fade` 0.4 |
| 25 | `quote-bubble` | Speech quote | Quotes | 4 s | T1 «Something worth saying» · Arial 700 · 6 · fill `#111111`, bubble `speech-round-left` · center · (0, −10) · `in-pop` 0.4, `out-fade` 0.3 |
| 26 | `callout-arrow` | Arrow label | Callouts | 3 s | S1 arrow · 14 × 6 · `#ffd400` · (−10, 0) · positionX keyframes −10 → −8 → −10 (% of canvas width) every 0.8 s; T1 «Look here» · Arial 700 · 5 · `outline-black` · left · (12, 0) · `in-slide-right` 0.3, `out-fade` 0.3 |
| 27 | `callout-circle` | Circle highlight | Callouts | 3 s | S1 ellipse · width and height 24 % of canvas height · fill `#ffffff00`, stroke `#ff3b30` width 8 · (0, 0) · scale 1.3 → 1 and opacity 0 → 1 from 0 s to 0.3 s; T1 «Note» · Arial 700 · 5 · `outline-black` · center · (0, 18) · `in-fade` 0.3, `out-fade` 0.3 |
| 28 | `callout-tag` | Price tag | Callouts | 3 s | T1 «$19» · Arial 700 · 8 · fill `#ffffff`, bubble `tag-left` with `bubble.color` `#ff3b30` · center · (28, −28) · `in-drop` 0.4, `loop-swing` 1.5, `out-fade` 0.3 |
| 29 | `callout-step` | Step number | Callouts | 3 s | S1 ellipse · width and height 12 % of canvas height · `#1e6bff` · (−36, −36) · scale 0 → 1 from 0 s to 0.3 s (out-back); T1 «1» · Arial 700 · 8 · `plain-white` · center · (−36, −36) · `in-fade` 0.3; T2 «Step title» · Arial 700 · 6 · `soft-shadow` · left · (−10, −36) · `in-slide-right` 0.4, `out-fade` 0.3 |
| 30 | `callout-warning` | Warning banner | Callouts | 3 s | T1 «IMPORTANT» · Arial 700 · 6 · fill `#111111`, bubble `banner-ribbon` with `bubble.color` `#ffcc00` · center · (0, −38) · `in-stretch` 0.4, `loop-pulse` 1.0, `out-fade` 0.3 |
