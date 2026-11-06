use serde::{Deserialize, Serialize};

use crate::media_time::{TICKS_PER_SECOND, TimeError};

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub struct FrameRate {
    pub numerator: u32,
    pub denominator: u32,
}

const MAX_RATE_PART: u32 = 1_000_000;

impl FrameRate {
    pub const FPS_23_976: Self = Self {
        numerator: 24_000,
        denominator: 1_001,
    };
    pub const FPS_24: Self = Self {
        numerator: 24,
        denominator: 1,
    };
    pub const FPS_25: Self = Self {
        numerator: 25,
        denominator: 1,
    };
    pub const FPS_29_97: Self = Self {
        numerator: 30_000,
        denominator: 1_001,
    };
    pub const FPS_30: Self = Self {
        numerator: 30,
        denominator: 1,
    };
    pub const FPS_48: Self = Self {
        numerator: 48,
        denominator: 1,
    };
    pub const FPS_50: Self = Self {
        numerator: 50,
        denominator: 1,
    };
    pub const FPS_59_94: Self = Self {
        numerator: 60_000,
        denominator: 1_001,
    };
    pub const FPS_60: Self = Self {
        numerator: 60,
        denominator: 1,
    };
    pub const FPS_120: Self = Self {
        numerator: 120,
        denominator: 1,
    };

    pub const fn new(numerator: u32, denominator: u32) -> Self {
        Self {
            numerator,
            denominator,
        }
    }

    /// The rate reduced by its greatest common divisor; `time/invalid-frame-rate` when a part is zero or, once
    /// reduced, above 1 000 000.
    pub fn checked(self) -> Result<Self, TimeError> {
        if !self.is_valid() {
            return Err(TimeError::InvalidFrameRate);
        }
        let (mut a, mut b) = (self.numerator, self.denominator);
        while b != 0 {
            (a, b) = (b, a % b);
        }
        let reduced = Self::new(self.numerator / a, self.denominator / a);
        if reduced.numerator > MAX_RATE_PART || reduced.denominator > MAX_RATE_PART {
            return Err(TimeError::InvalidFrameRate);
        }
        Ok(reduced)
    }

    /// The frame rate rounded to a whole number of frames per second, half away from zero.
    pub fn rounded(self) -> Option<u32> {
        if !self.is_valid() {
            return None;
        }
        let (numerator, denominator) = (u64::from(self.numerator), u64::from(self.denominator));
        u32::try_from((2 * numerator + denominator) / (2 * denominator)).ok()
    }

    pub const fn is_valid(self) -> bool {
        self.numerator > 0 && self.denominator > 0
    }

    pub fn as_f64(self) -> Option<f64> {
        if !self.is_valid() {
            return None;
        }

        Some(f64::from(self.numerator) / f64::from(self.denominator))
    }

    pub fn frame_number_upper_bound(self) -> Option<u32> {
        if !self.is_valid() {
            return None;
        }

        Some(self.numerator.div_ceil(self.denominator))
    }

    pub fn ticks_per_frame(self) -> Option<i64> {
        if !self.is_valid() {
            return None;
        }

        let tick_numerator = TICKS_PER_SECOND.checked_mul(i64::from(self.denominator))?;
        let tick_denominator = i64::from(self.numerator);
        if tick_numerator % tick_denominator != 0 {
            return None;
        }

        Some(tick_numerator / tick_denominator)
    }
}

#[cfg(test)]
mod tests {
    use super::FrameRate;

    #[test]
    fn resolves_ticks_per_standard_frame_rate() {
        assert_eq!(FrameRate::FPS_23_976.ticks_per_frame(), Some(5_005));
        assert_eq!(FrameRate::FPS_24.ticks_per_frame(), Some(5_000));
        assert_eq!(FrameRate::FPS_25.ticks_per_frame(), Some(4_800));
        assert_eq!(FrameRate::FPS_29_97.ticks_per_frame(), Some(4_004));
        assert_eq!(FrameRate::FPS_30.ticks_per_frame(), Some(4_000));
        assert_eq!(FrameRate::FPS_48.ticks_per_frame(), Some(2_500));
        assert_eq!(FrameRate::FPS_50.ticks_per_frame(), Some(2_400));
        assert_eq!(FrameRate::FPS_59_94.ticks_per_frame(), Some(2_002));
        assert_eq!(FrameRate::FPS_60.ticks_per_frame(), Some(2_000));
        assert_eq!(FrameRate::FPS_120.ticks_per_frame(), Some(1_000));
    }

    #[test]
    fn reduces_and_bounds_rates() {
        assert_eq!(FrameRate::new(29_970_000, 1_000_000).checked(), Ok(FrameRate::new(2_997, 100)));
        assert!(FrameRate::new(2_000_003, 1).checked().is_err());
        assert_eq!(FrameRate::FPS_29_97.rounded(), Some(30));
        assert_eq!(FrameRate::new(10, 3).rounded(), Some(3));
    }

    #[test]
    fn rejects_invalid_or_unsupported_rates() {
        assert_eq!(FrameRate::new(0, 1).ticks_per_frame(), None);
        assert_eq!(FrameRate::new(1, 0).ticks_per_frame(), None);
        assert_eq!(FrameRate::new(7, 3).ticks_per_frame(), None);
    }
}
