# render-engine — normative catalogue

This file is normative. `render-engine` requirements cite its sections by name. A build-time check compares the
"Engine-owned shaders" and "Blend formulas" tables with the Rust registry and fails on any difference.

## Engine-owned shaders

Shaders that belong to the engine itself (not to an effect, filter or transition catalogue). Uniform types: `f32`,
`i32`, `vec2`, `vec3`, `vec4`, `mat3`, `tex` (texture slot). Every shader also receives `u_resolution: vec2`, and
every effect, filter and mask shader additionally receives `u_boxInverse: mat3` and `u_boxSize: vec2`
(`render-engine.Effect coordinate frame`). A body-effect shader declares the texture slot `matte`
(`render-engine.Body-effect matte inputs and frame history`).

| Shader id | Stage or use | Uniforms |
|---|---|---|
| `stabilise` | stage `stabilise` | `u_matrix: mat3`, `u_zoom: f32` |
| `chroma-key` | stage `chroma-key` | `u_keyColor: vec3`, `u_similarity: f32`, `u_smoothness: f32`, `u_shadow: f32`, `u_spill: f32` |
| `matte` | stage `matte` | `u_matte: tex`, `u_inverted: i32`, `u_feather: f32`, `u_shift: f32` |
| `deflicker` | stage `retouch` | `u_gains: tex` (4×4 grid), `u_strength: f32` |
| `retouch` | stage `retouch` | `u_landmarks: tex`, `u_faceCount: i32`, `u_smooth: f32`, `u_brighten: f32`, `u_darkCircles: f32`, `u_smileLines: f32`, `u_teeth: f32`, `u_blemish: f32`, `u_eyes: f32`, `u_skinTone: f32` |
| `makeup` | stage `retouch` | `u_landmarks: tex`, `u_faceCount: i32`, `u_layerColors: tex` (6 layers × RGBA), `u_layerIntensity: tex`, `u_yawFade: f32` |
| `reshape` | stage `retouch` | `u_displacement: tex` (2-channel warp field built on the TypeScript side from face and body sliders), `u_amount: f32` |
| `eye-contact` | stage `retouch` | `u_landmarks: tex`, `u_gazeOffset: vec2`, `u_strength: f32` |
| `relight` | stage `retouch` | `u_depth: tex`, `u_lightDir: vec3`, `u_intensity: f32`, `u_temperature: f32`, `u_ambient: f32`, `u_scopeMask: tex` |
| `lut3d` | stage `color-chain` step 1; stage `filter` | `u_lut: tex`, `u_size: i32`, `u_intensity: f32` |
| `color-chain` (wheel values per `render-engine.Colour wheel puck mapping`) | stage `color-chain` steps 2–5 | `u_basic: tex` (12 values: exposure, brightness, contrast, highlights, shadows, whites, blacks, temperature, tint, saturation, vibrance, hue), `u_wheels: tex` (lift, gamma, gain × RGB + luminance), `u_curves: tex` (4 × 256), `u_hsl: tex` (8 bands × hue, saturation, lightness) |
| `color-spatial` | stage `color-chain` step 6 | `u_sharpness: f32`, `u_clarity: f32`, `u_fade: f32`, `u_vignette: f32`, `u_grain: f32`, `u_seed: f32`, `u_frame: i32` |
| `gaussian-blur` | effect passes, background blur | `u_sigma: f32`, `u_step: f32`, `u_direction: vec2` |
| `frame-blend` | retime `smooth: "blend"` | `u_a: tex`, `u_b: tex`, `u_mix: f32` |
| `optical-flow-estimate` | retime `smooth: "flow"` (WebGPU only) | `u_a: tex`, `u_b: tex`, `u_level: i32` |
| `optical-flow-warp` | retime `smooth: "flow"` (WebGPU only) | `u_a: tex`, `u_b: tex`, `u_flow: tex`, `u_mix: f32` |
| `jump-flood` | mask feather | `u_step: i32`, `u_pass: i32` |
| `mask-combine` | stage `masks` | `u_mask: tex`, `u_mode: i32` (0 add, 1 subtract, 2 intersect, 3 exclude), `u_opacity: f32`, `u_inverted: i32`, `u_feather: f32` |
| `mask-stroke` | stage `masks` | `u_stroke: tex`, `u_color: vec4` |
| `cutout-background` | stage `matte` (`render-engine.Cutout background and stroke stage`) | `u_subject: tex`, `u_background: tex`, `u_kind: i32` (0 colour, 1 blur, 2 texture), `u_color: vec4`, `u_boxInverse: mat3` |
| `cutout-stroke` | stage `matte` (drawn before masks, so masks clip it) | `u_matte: tex`, `u_style: i32` (0 solid, 1 dashed, 2 glow, 3 offset-shadow), `u_width: f32`, `u_color: vec4`, `u_offset: f32`, `u_opacity: f32`, `u_dash: vec2` (on, off; arc length in px) |
| `wipe-reveal` | stage `masks` (clip-animation reveal) | `u_progress: f32`, `u_angle: f32`, `u_softness: f32`, `u_shape: i32` |
| `motion-blur` | stage `motion-blur` | `u_previous: mat3`, `u_current: mat3`, `u_samples: i32`, `u_shutter: f32` |
| `blend` | stage `blend` | `u_backdrop: tex`, `u_mode: i32` (0–16), `u_opacity: f32` |
| `present` | final present | `u_scene: tex` |

## Blend formulas

`Cb` = backdrop colour, `Cs` = source colour, per channel in 0..1 on gamma-encoded sRGB. `Lum(C) = 0.3 R + 0.59 G +
0.11 B`; `Sat(C) = max(R,G,B) − min(R,G,B)`; `SetLum`, `SetSat` and `ClipColor` are the functions of W3C Compositing
and Blending Level 1 §10.

| Code | Id | `B(Cb, Cs)` |
|---|---|---|
| 0 | `normal` | `Cs` |
| 1 | `darken` | `min(Cb, Cs)` |
| 2 | `multiply` | `Cb × Cs` |
| 3 | `color-burn` | `1` if `Cb = 1`; else `0` if `Cs = 0`; else `1 − min(1, (1 − Cb) / Cs)` |
| 4 | `lighten` | `max(Cb, Cs)` |
| 5 | `screen` | `Cb + Cs − Cb × Cs` |
| 6 | `plus-lighter` | `min(1, Cb + Cs)` |
| 7 | `color-dodge` | `0` if `Cb = 0`; else `1` if `Cs = 1`; else `min(1, Cb / (1 − Cs))` |
| 8 | `overlay` | `hard-light` with the operands swapped: `B_hard-light(Cs, Cb)` |
| 9 | `soft-light` | if `Cs ≤ 0.5`: `Cb − (1 − 2Cs) × Cb × (1 − Cb)`; else `Cb + (2Cs − 1) × (D(Cb) − Cb)`, with `D(x) = ((16x − 12) × x + 4) × x` if `x ≤ 0.25`, else `sqrt(x)` |
| 10 | `hard-light` | if `Cs ≤ 0.5`: `Cb × 2Cs`; else `Cb + (2Cs − 1) − Cb × (2Cs − 1)` |
| 11 | `difference` | `abs(Cb − Cs)` |
| 12 | `exclusion` | `Cb + Cs − 2 × Cb × Cs` |
| 13 | `hue` | `SetLum(SetSat(Cs, Sat(Cb)), Lum(Cb))` |
| 14 | `saturation` | `SetLum(SetSat(Cb, Sat(Cs)), Lum(Cb))` |
| 15 | `color` | `SetLum(Cs, Lum(Cb))` |
| 16 | `luminosity` | `SetLum(Cb, Lum(Cs))` |

## Benchmark scene B1

| Property | Value |
|---|---|
| Canvas, frame rate, duration | 1920×1080, 30/1, 60 s |
| Main track | one 1080p30 H.264 High clip, 8 Mbit/s, keyframe interval 2 s |
| `overlay[0]` (topmost) | adjustment track: one adjustment element spanning the scene with a 33-point LUT at intensity 100 |
| `overlay[1]` | text track: text A (Arial 64 px with stroke) spanning the scene |
| `overlay[2]` | text track: text B (Times New Roman 48 px with shadow) spanning the scene |
| `overlay[3]` | video track: one 1080p30 H.264 clip scaled to 40 % at opacity 80 %, blend mode `screen` |
| `overlay[4]` (directly above main) | video track: one 1080p30 H.264 clip scaled to 60 %, Gaussian blur effect intensity 40, one ellipse mask with feather 40 px |
| Audio | one stereo AAC 48 kHz track spanning the scene |
| Source of media | synthetic fixtures under `packages/media/fixtures/` (`diagnostics-quality.Test fixtures`) |
