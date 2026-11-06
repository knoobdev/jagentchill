//! Colour wheel puck mapping: stored pucks and luminance values to per-channel lift, gamma and gain.

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WheelPuck {
    pub x: f32,
    pub y: f32,
    /// −100…100.
    pub luminance: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WheelChannels {
    pub lift: [f32; 3],
    pub gamma: [f32; 3],
    pub gain: [f32; 3],
}

const THIRD_TURN: f32 = 2.094_395_1;

/// `a × k` for a puck: amount times the chroma vector `(cos θ, cos(θ − 120°), cos(θ + 120°))`; zero when centred.
fn chroma(puck: WheelPuck) -> [f32; 3] {
    let amount = (puck.x * puck.x + puck.y * puck.y).sqrt().min(1.0);
    if amount == 0.0 {
        return [0.0; 3];
    }
    let theta = puck.y.atan2(puck.x);
    [amount * theta.cos(), amount * (theta - THIRD_TURN).cos(), amount * (theta + THIRD_TURN).cos()]
}

pub fn wheel_channels(shadows: WheelPuck, midtones: WheelPuck, highlights: WheelPuck) -> WheelChannels {
    let (s, m, h) = (chroma(shadows), chroma(midtones), chroma(highlights));
    let mut out = WheelChannels { lift: [0.0; 3], gamma: [1.0; 3], gain: [1.0; 3] };
    for channel in 0..3 {
        out.lift[channel] = 0.25 * (s[channel] + shadows.luminance / 100.0);
        out.gamma[channel] = 2.0_f32.powf(m[channel] + midtones.luminance / 100.0);
        out.gain[channel] = 2.0_f32.powf(h[channel] + highlights.luminance / 100.0);
    }
    out
}

/// `out = clamp(gain × (in + lift × (1 − in)), 0, 1)^(1 / gamma)` per channel.
pub fn wheel_transfer(channels: &WheelChannels, input: [f32; 3]) -> [f32; 3] {
    let mut out = [0.0; 3];
    for channel in 0..3 {
        let lifted = input[channel] + channels.lift[channel] * (1.0 - input[channel]);
        out[channel] = (channels.gain[channel] * lifted).clamp(0.0, 1.0).powf(1.0 / channels.gamma[channel]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{WheelPuck, wheel_channels, wheel_transfer};

    fn near(actual: [f32; 3], expected: [f32; 3], tolerance: f32) {
        for channel in 0..3 {
            assert!((actual[channel] - expected[channel]).abs() <= tolerance, "{actual:?} instead of {expected:?}");
        }
    }

    #[test]
    fn centred_pucks_are_the_identity() {
        let channels = wheel_channels(WheelPuck::default(), WheelPuck::default(), WheelPuck::default());
        assert_eq!(channels.lift, [0.0; 3]);
        assert_eq!(channels.gamma, [1.0; 3]);
        assert_eq!(channels.gain, [1.0; 3]);
    }

    #[test]
    fn highlights_pushed_fully_to_red() {
        let channels = wheel_channels(WheelPuck::default(), WheelPuck::default(), WheelPuck { x: 1.0, y: 0.0, luminance: 0.0 });
        near(channels.gain, [2.0, 0.7071, 0.7071], 1e-4);
        near(wheel_transfer(&channels, [0.5; 3]), [1.0, 0.3536, 0.3536], 1e-3);
    }

    #[test]
    fn shadows_luminance_only() {
        let channels = wheel_channels(WheelPuck { x: 0.0, y: 0.0, luminance: 40.0 }, WheelPuck::default(), WheelPuck::default());
        near(channels.lift, [0.1; 3], 1e-6);
        near(wheel_transfer(&channels, [0.0; 3]), [0.1; 3], 1e-6);
    }

    #[test]
    fn midtones_toward_green() {
        let angle = 120.0_f32.to_radians();
        let puck = WheelPuck { x: 0.5 * angle.cos(), y: 0.5 * angle.sin(), luminance: 0.0 };
        let channels = wheel_channels(WheelPuck::default(), puck, WheelPuck::default());
        near(channels.gamma, [0.8409, 1.4142, 0.8409], 1e-4);
    }
}
