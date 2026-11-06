# color-adjustment — normative catalogue

This file is normative. It is cited by `color-adjustment.Bundled LUTs`. Each built-in LUT is defined by a recipe of
`color-adjustment` parameters (or, where stated, a transfer formula) and is baked to a 33×33×33 `.cube` table by the
deterministic build script `scripts/bake-luts` (the same script that bakes the filters of
`visual-effects-filters.Bundled filter library`). All content is authored for JAgentChill; no row reproduces a
third-party LUT.

Notation: `B{…}` basic sliders; `W{shadows|midtones|highlights: angle°, amount, luminance}` a colour-wheel puck in polar
form — the stored puck is `x = amount × cos(angle)`, `y = amount × sin(angle)` and its effect on R, G and B is the closed
formula of `render-engine.Colour wheel puck mapping` (0° = red, 120° = green, 240° = blue, counter-clockwise);
`C{master|r|g|b: (x, y)…}` extra curve points between (0,0) and (1,1) unless an end point is restated;
`H{band: hue, saturation, lightness}`. Every value not listed is at its default. Recipes are baked by
`color-adjustment.LUT bake procedure`, without the spatial pass (`fade` is baked as its pointwise tone lift; sharpness,
clarity, vignette and grain are never part of a LUT recipe). Four of the twelve rows use `W{…}`. `eotf` is the sRGB
EOTF and `oetf` its inverse (the piecewise sRGB transfer function).

| Id | Name | Definition (normative) |
|---|---|---|
| `neutral` | Neutral | Identity: every lattice point maps to itself. |
| `log-to-display` | Log to Display | Per channel, input `v` is a generic log encoding decoded as `lin = 0.18 × 2^((v − 0.41) × 14)`, then encoded with `oetf` (the inverse sRGB EOTF, the engine's working transfer) and clamped to 0…1. No colour-gamut conversion. |
| `soft-s-curve` | Soft S-Curve | C{master: (0.25, 0.22), (0.75, 0.78)} |
| `strong-s-curve` | Strong S-Curve | C{master: (0.25, 0.15), (0.75, 0.85)} |
| `warm-film` | Warm Film | B{temperature 18, tint 3, contrast 8, saturation −5, fade 6}; W{highlights: 40°, 0.15, 0}; C{master: (0.25, 0.23), (0.75, 0.78)} |
| `cool-film` | Cool Film | B{temperature −16, contrast 8, saturation −8, fade 6}; W{shadows: 210°, 0.15, 0}; C{master: (0.25, 0.23), (0.75, 0.78)} |
| `teal-orange` | Teal & Orange | B{contrast 10, vibrance 8}; W{shadows: 185°, 0.30, 0; highlights: 30°, 0.26, 0} |
| `high-key` | High Key | B{exposure 12, contrast −8, whites 10} |
| `day-for-night` | Day for Night | B{exposure −30, temperature −40, saturation −30, contrast 12, highlights −20}; W{midtones: 220°, 0.15, −6} |
| `faded-matte` | Faded Matte | B{fade 28, contrast −10, saturation −12}; C{master: (0, 0.09), (1, 0.95)} |
| `vivid` | Vivid | B{vibrance 35, saturation 10, contrast 12} |
| `display-gamma-24` | Display Gamma 2.4 | Per channel `out = eotf(v)^(1 / 2.4)`: re-encodes sRGB-encoded values for a display with a pure 2.4 power response. No colour-gamut conversion. |
