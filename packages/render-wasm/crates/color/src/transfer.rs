/// sRGB electro-optical transfer: a display-referred channel value to linear light.
pub fn srgb_eotf(value: f32) -> f32 {
    if value <= 0.040_45 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

/// Inverse of `srgb_eotf`.
pub fn srgb_oetf(value: f32) -> f32 {
    if value <= 0.003_130_8 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    }
}

/// BT.709 luma of a non-linear RGB value.
pub fn luma_709(rgb: [f32; 3]) -> f32 {
    0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

#[cfg(test)]
mod tests {
    use super::{srgb_eotf, srgb_oetf};

    #[test]
    fn transfer_round_trips() {
        for step in 0..=255 {
            let value = step as f32 / 255.0;
            assert!((srgb_oetf(srgb_eotf(value)) - value).abs() < 1e-5);
        }
        assert!((srgb_eotf(0.5) - 0.214_04).abs() < 1e-4);
    }
}
