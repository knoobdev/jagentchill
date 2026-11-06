//! The 17 blend functions `B(Cb, Cs)` of `specs/render-engine/catalog.md` section "Blend formulas", on
//! gamma-encoded sRGB, and the straight-alpha compositing that uses them.

/// Kebab-case ids in shader-code order (0–16).
pub const BLEND_MODE_IDS: [&str; 17] = [
    "normal", "darken", "multiply", "color-burn", "lighten", "screen", "plus-lighter", "color-dodge", "overlay",
    "soft-light", "hard-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity",
];

fn hard_light(backdrop: f32, source: f32) -> f32 {
    if source <= 0.5 {
        backdrop * 2.0 * source
    } else {
        let doubled = 2.0 * source - 1.0;
        backdrop + doubled - backdrop * doubled
    }
}

fn soft_light(backdrop: f32, source: f32) -> f32 {
    if source <= 0.5 {
        backdrop - (1.0 - 2.0 * source) * backdrop * (1.0 - backdrop)
    } else {
        let d = if backdrop <= 0.25 {
            ((16.0 * backdrop - 12.0) * backdrop + 4.0) * backdrop
        } else {
            backdrop.sqrt()
        };
        backdrop + (2.0 * source - 1.0) * (d - backdrop)
    }
}

/// The separable modes, per channel. `None` for a non-separable mode.
pub fn blend_channel_modes(mode: u32, backdrop: f32, source: f32) -> Option<f32> {
    Some(match mode {
        0 => source,
        1 => backdrop.min(source),
        2 => backdrop * source,
        3 => {
            if backdrop >= 1.0 {
                1.0
            } else if source <= 0.0 {
                0.0
            } else {
                1.0 - ((1.0 - backdrop) / source).min(1.0)
            }
        }
        4 => backdrop.max(source),
        5 => backdrop + source - backdrop * source,
        6 => (backdrop + source).min(1.0),
        7 => {
            if backdrop <= 0.0 {
                0.0
            } else if source >= 1.0 {
                1.0
            } else {
                (backdrop / (1.0 - source)).min(1.0)
            }
        }
        8 => hard_light(source, backdrop),
        9 => soft_light(backdrop, source),
        10 => hard_light(backdrop, source),
        11 => (backdrop - source).abs(),
        12 => backdrop + source - 2.0 * backdrop * source,
        _ => return None,
    })
}

fn lum(color: [f32; 3]) -> f32 {
    0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2]
}

fn sat(color: [f32; 3]) -> f32 {
    color[0].max(color[1]).max(color[2]) - color[0].min(color[1]).min(color[2])
}

fn clip_color(color: [f32; 3]) -> [f32; 3] {
    let l = lum(color);
    let n = color[0].min(color[1]).min(color[2]);
    let x = color[0].max(color[1]).max(color[2]);
    let mut out = color;
    if n < 0.0 {
        for channel in &mut out {
            *channel = l + (*channel - l) * l / (l - n);
        }
    }
    if x > 1.0 {
        for channel in &mut out {
            *channel = l + (*channel - l) * (1.0 - l) / (x - l);
        }
    }
    out
}

fn set_lum(color: [f32; 3], l: f32) -> [f32; 3] {
    let d = l - lum(color);
    clip_color([color[0] + d, color[1] + d, color[2] + d])
}

fn set_sat(color: [f32; 3], s: f32) -> [f32; 3] {
    let max = color[0].max(color[1]).max(color[2]);
    let min = color[0].min(color[1]).min(color[2]);
    if max <= min {
        return [0.0; 3];
    }
    // Scaling every channel's distance from the minimum is the W3C min/mid/max procedure in closed form.
    [
        (color[0] - min) * s / (max - min),
        (color[1] - min) * s / (max - min),
        (color[2] - min) * s / (max - min),
    ]
}

/// `B(Cb, Cs)` for a mode code 0–16; an unknown code blends as `normal`.
pub fn blend_rgb(mode: u32, backdrop: [f32; 3], source: [f32; 3]) -> [f32; 3] {
    match mode {
        13 => set_lum(set_sat(source, sat(backdrop)), lum(backdrop)),
        14 => set_lum(set_sat(backdrop, sat(source)), lum(backdrop)),
        15 => set_lum(source, lum(backdrop)),
        16 => set_lum(backdrop, lum(source)),
        _ => {
            let mut out = [0.0; 3];
            for channel in 0..3 {
                out[channel] = blend_channel_modes(mode, backdrop[channel], source[channel]).unwrap_or(source[channel]);
            }
            out
        }
    }
}

/// Straight-alpha source-over with a blend function: `αo = αs + αb (1 − αs)` and
/// `Co = (αs (1 − αb) Cs + αs αb B(Cb, Cs) + (1 − αs) αb Cb) / αo`. `source[3]` already includes the layer opacity.
pub fn composite(mode: u32, backdrop: [f32; 4], source: [f32; 4]) -> [f32; 4] {
    let (alpha_b, alpha_s) = (backdrop[3], source[3]);
    let alpha_o = alpha_s + alpha_b * (1.0 - alpha_s);
    if alpha_o <= 0.0 {
        return [0.0; 4];
    }
    let blended = blend_rgb(mode, [backdrop[0], backdrop[1], backdrop[2]], [source[0], source[1], source[2]]);
    let mut out = [0.0, 0.0, 0.0, alpha_o];
    for channel in 0..3 {
        out[channel] = (alpha_s * (1.0 - alpha_b) * source[channel]
            + alpha_s * alpha_b * blended[channel]
            + (1.0 - alpha_s) * alpha_b * backdrop[channel])
            / alpha_o;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{BLEND_MODE_IDS, blend_rgb, composite};

    fn bytes(color: [f32; 3]) -> [i32; 3] {
        [(color[0] * 255.0).round() as i32, (color[1] * 255.0).round() as i32, (color[2] * 255.0).round() as i32]
    }

    fn rgb(r: u8, g: u8, b: u8) -> [f32; 3] {
        [f32::from(r) / 255.0, f32::from(g) / 255.0, f32::from(b) / 255.0]
    }

    #[test]
    fn has_seventeen_modes_in_shader_order() {
        assert_eq!(BLEND_MODE_IDS.len(), 17);
        assert_eq!(BLEND_MODE_IDS[0], "normal");
        assert_eq!(BLEND_MODE_IDS[6], "plus-lighter");
        assert_eq!(BLEND_MODE_IDS[16], "luminosity");
    }

    #[test]
    fn multiply_and_screen_match_the_specification() {
        assert_eq!(bytes(blend_rgb(2, rgb(200, 100, 50), rgb(128, 128, 128))), [100, 50, 25]);
        assert_eq!(bytes(blend_rgb(5, rgb(200, 100, 50), rgb(128, 128, 128))), [228, 178, 153]);
    }

    #[test]
    fn non_separable_modes_keep_the_backdrop_luminance() {
        let backdrop = rgb(200, 100, 50);
        let lum = |c: [f32; 3]| 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
        for mode in [13, 14, 15] {
            let out = blend_rgb(mode, backdrop, rgb(10, 200, 250));
            assert!((lum(out) - lum(backdrop)).abs() < 1e-4, "mode {mode}");
        }
        let out = blend_rgb(16, backdrop, rgb(10, 200, 250));
        assert!((lum(out) - lum(rgb(10, 200, 250))).abs() < 1e-4);
    }

    #[test]
    fn composites_with_straight_alpha() {
        // Opaque blue at opacity 0.5 over opaque red.
        let out = composite(0, [1.0, 0.0, 0.0, 1.0], [0.0, 0.0, 1.0, 0.5]);
        assert_eq!(bytes([out[0], out[1], out[2]]), [128, 0, 128]);
        assert_eq!(out[3], 1.0);
        // White at 0.5 over a transparent clear keeps its colour and accumulates alpha.
        let out = composite(0, [0.0, 0.0, 0.0, 0.0], [1.0, 1.0, 1.0, 0.5]);
        assert_eq!(out, [1.0, 1.0, 1.0, 0.5]);
        assert_eq!(composite(0, [0.0; 4], [1.0, 1.0, 1.0, 0.0]), [0.0; 4]);
    }
}
