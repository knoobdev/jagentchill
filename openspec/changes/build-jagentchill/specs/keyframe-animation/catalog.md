# keyframe-animation — normative catalogue of clip animations

This file is normative. It is cited by `keyframe-animation.Bundled clip animation library` and
`keyframe-animation.Clip animation model`. All content is authored for JAgentChill.

## Conventions

- `u` = normalised position inside the slot: `u = (clipTime − slotStart) / slot.duration`, evaluated at the frame start
  time; `t` = seconds since `slotStart` (used by the periodic Combo animations).
- Channels and units at strength 100:
  - `x`, `y` — translation in percent of the canvas width (`x`) or height (`y`); positive `x` is right, positive `y` is
    down. Added to the element's own position.
  - `scale`, `scaleX`, `scaleY` — percent, multiplied with the element's own `transform.scale.x` / `transform.scale.y`
    (`scale` drives both axes). These are channel names of this catalogue's tables, not document paths. A negative
    `scaleX` mirrors the layer horizontally.
  - `rotation` — degrees clockwise, added to the element's own rotation. Pivot = element centre unless a row says otherwise.
  - `opacity` — 0…1, multiplied with the element's own opacity.
  - `blur` — Gaussian sigma in px on the reference canvas, multiplied by the pixel scale factor of
    `visual-effects-filters.Resolution-independent effect parameters`.
  - `reveal` — 0…1 progress of a left-to-right linear wipe of the layer's alpha with 10 % softness: the layer's alpha
    is multiplied by `1 − smoothstep(reveal' − 0.05, reveal' + 0.05, xNorm)` with `reveal' = reveal × 1.1 − 0.05`, so
    `reveal = 0` hides the layer, `reveal = 0.5` shows its left half and `reveal = 1` shows it fully; `xNorm` is the
    horizontal position inside the element's box (the effect frame of
    `visual-effects-filters.Resolution-independent effect parameters`), 0 at its left edge.
- A channel table is a list `u: value` in increasing `u`; the easing in brackets after a value applies to the segment
  that STARTS at that key. Easings: `lin` = linear; `in` = cubic-bezier(0.42, 0, 1, 1); `out` = cubic-bezier(0, 0, 0.58, 1);
  `io` = cubic-bezier(0.42, 0, 0.58, 1); `pop` = cubic-bezier(0.175, 0.885, 0.32, 1.275). Before the first and after the
  last key the value holds. Channels not listed stay at their neutral value (x, y, rotation, blur = 0; scale = 100;
  opacity = 1; reveal = 1).
- Strength `s = strength / 100` scales: `x`, `y`, `rotation`, `blur` and jitter amplitudes by `s`; scales as
  `100 + (value − 100) × s`. `opacity` and `reveal` are not scaled.
- Jitter: `jit(c, A) = A × (2 × h(elementSeed, floor(t × 12), c) − 1)`, held constant for each 1/12 s step, where `h` is the
  engine's 32-bit integer hash mapped to 0…1, `elementSeed` is the FNV-1a 32-bit hash of the element id, and `c` is the
  channel index (0 = x, 1 = y, 2 = rotation). `A` is the amplitude given in the row (percent or degrees).

## In (16)

| Type id | Channels (normative) |
|---|---|
| `fade-in` | opacity — 0: 0 [lin]; 1: 1 |
| `zoom-in` | scale — 0: 50 [out]; 1: 100 · opacity — 0: 0 [lin]; 0.3: 1 |
| `zoom-out-in` | scale — 0: 160 [out]; 1: 100 · opacity — 0: 0 [lin]; 0.3: 1 |
| `slide-in-left` | x — 0: −100 [out]; 1: 0 |
| `slide-in-right` | x — 0: 100 [out]; 1: 0 |
| `slide-in-up` | y — 0: 100 [out]; 1: 0 |
| `slide-in-down` | y — 0: −100 [out]; 1: 0 |
| `spin-in` | rotation — 0: −360 [out]; 1: 0 · scale — 0: 30 [out]; 1: 100 |
| `swing-in` | rotation — 0: −30 [io]; 0.6: 8 [io]; 0.8: −3 [io]; 1: 0 · opacity — 0: 0 [lin]; 0.3: 1 |
| `bounce-in` | scale — 0: 30 [out]; 0.5: 112 [io]; 0.75: 96 [io]; 1: 100 · opacity — 0: 0 [lin]; 0.2: 1 |
| `drop-in` | y — 0: −100 [in]; 0.45: 0 [out]; 0.6: −12 [in]; 0.75: 0 [out]; 0.87: −4 [in]; 1: 0 |
| `pop-in` | scale — 0: 0 [out]; 0.7: 120 [io]; 1: 100 |
| `blur-in` | blur — 0: 40 [out]; 1: 0 · opacity — 0: 0 [out]; 1: 1 |
| `flip-in` | scaleX — 0: −100 [out]; 1: 100 |
| `wipe-in` | reveal — 0: 0 [lin]; 1: 1 |
| `shake-in` | x = jit(0, A), y = jit(1, A) with A — 0: 6 [lin]; 1: 0 · opacity — 0: 0 [lin]; 0.2: 1 |

## Out (16)

Each Out animation is the exact time-mirror of its In counterpart (`value_out(u) = value_in(1 − u)`, easings mirrored);
the tables are written out so that no derivation is needed.

| Type id | Mirror of | Channels (normative) |
|---|---|---|
| `fade-out` | `fade-in` | opacity — 0: 1 [lin]; 1: 0 |
| `zoom-out` | `zoom-in` | scale — 0: 100 [in]; 1: 50 · opacity — 0.7: 1 [lin]; 1: 0 |
| `zoom-in-out` | `zoom-out-in` | scale — 0: 100 [in]; 1: 160 · opacity — 0.7: 1 [lin]; 1: 0 |
| `slide-out-left` | `slide-in-left` | x — 0: 0 [in]; 1: −100 |
| `slide-out-right` | `slide-in-right` | x — 0: 0 [in]; 1: 100 |
| `slide-out-up` | `slide-in-down` | y — 0: 0 [in]; 1: −100 |
| `slide-out-down` | `slide-in-up` | y — 0: 0 [in]; 1: 100 |
| `spin-out` | `spin-in` | rotation — 0: 0 [in]; 1: −360 · scale — 0: 100 [in]; 1: 30 |
| `swing-out` | `swing-in` | rotation — 0: 0 [io]; 0.2: −3 [io]; 0.4: 8 [io]; 1: −30 · opacity — 0.7: 1 [lin]; 1: 0 |
| `bounce-out` | `bounce-in` | scale — 0: 100 [io]; 0.25: 96 [io]; 0.5: 112 [in]; 1: 30 · opacity — 0.8: 1 [lin]; 1: 0 |
| `drop-out` | `drop-in` | y — 0: 0 [out]; 0.13: −4 [in]; 0.25: 0 [out]; 0.4: −12 [in]; 0.55: 0 [out]; 1: −100 |
| `pop-out` | `pop-in` | scale — 0: 100 [io]; 0.3: 120 [in]; 1: 0 |
| `blur-out` | `blur-in` | blur — 0: 0 [in]; 1: 40 · opacity — 0: 1 [in]; 1: 0 |
| `flip-out` | `flip-in` | scaleX — 0: 100 [in]; 1: −100 |
| `wipe-out` | `wipe-in` | reveal — 0: 1 [lin]; 1: 0 |
| `shake-out` | `shake-in` | x = jit(0, A), y = jit(1, A) with A — 0: 0 [lin]; 1: 6 · opacity — 0.8: 1 [lin]; 1: 0 |

## Combo (12)

Periodic rows are functions of `t` (seconds) and repeat for the whole combo range; table rows use `u`.

| Type id | Channels (normative) |
|---|---|
| `zoom-pulse` | scale = 100 + 15 × (1 − cos(2π t)) / 2 (period 1 s; peak 115 at t = 0.5 s, 1.5 s, …) |
| `slide-through` | x — 0: −100 [out]; 0.25: 0 [lin]; 0.75: 0 [in]; 1: 100 |
| `spin-through` | rotation — 0: −180 [out]; 0.25: 0 [lin]; 0.75: 0 [in]; 1: 180 · scale — 0: 40 [out]; 0.25: 100 [lin]; 0.75: 100 [in]; 1: 40 |
| `swing` | rotation = 10 × sin(2π t / 1.5) (period 1.5 s) |
| `pendulum` | rotation = 15 × sin(2π t / 2) (period 2 s); pivot = centre of the element's top edge |
| `bounce` | y = −8 × abs(sin(π t / 0.8)) (one hop per 0.8 s) |
| `wobble` | scaleX = 100 + 4 × sin(2π t / 0.6); scaleY = 100 − 4 × sin(2π t / 0.6) (period 0.6 s) |
| `shake` | x = jit(0, 3); y = jit(1, 3); rotation = jit(2, 1.5) |
| `flip-through` | scaleX — 0: −100 [out]; 0.25: 100 [lin]; 0.75: 100 [in]; 1: −100 |
| `stretch` | scaleX — 0: 100 [io]; 0.5: 130 [io]; 1: 100 · scaleY — 0: 100 [io]; 0.5: 80 [io]; 1: 100 |
| `drift-in` | scale — 0: 100 [lin]; 1: 120 |
| `drift-out` | scale — 0: 120 [lin]; 1: 100 |
