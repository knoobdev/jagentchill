use std::ops::{Add, Neg, Sub};

use bridge::export;
use serde::{Deserialize, Serialize};

use crate::frame_rate::FrameRate;

#[export]
pub const TICKS_PER_SECOND: i64 = 120_000;
const TICKS_PER_SECOND_F64: f64 = TICKS_PER_SECOND as f64;

/// Largest magnitude a media time may have: the largest integer a JavaScript number holds exactly.
pub const MAX_SAFE_TICKS: i64 = 9_007_199_254_740_991;

/// The three failures of the time API. The code string is what crosses the wasm boundary and what the TypeScript
/// implementation throws, so the two sides are compared code for code by the shared vectors.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TimeError {
    NonIntegerTicks,
    InvalidFrameRate,
    OutOfRange,
}

impl TimeError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::NonIntegerTicks => "time/non-integer-ticks",
            Self::InvalidFrameRate => "time/invalid-frame-rate",
            Self::OutOfRange => "time/out-of-range",
        }
    }
}

impl From<TimeError> for String {
    fn from(error: TimeError) -> Self {
        error.code().to_string()
    }
}

pub type TimeResult<T> = Result<T, TimeError>;

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi, into_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub struct MediaTime(i64);

/// Rounds half away from zero. `f64::round` has exactly that rule.
pub fn round_half_away(value: f64) -> f64 {
    value.round()
}

fn in_range(ticks: i128) -> TimeResult<i64> {
    if ticks.unsigned_abs() > MAX_SAFE_TICKS as u128 {
        return Err(TimeError::OutOfRange);
    }
    Ok(ticks as i64)
}

/// Start of frame `frame` for an already checked rate. `q × (120000 × den) + roundHalfAway(r × 120000 × den / num)`
/// with every product in `i128`; a negative frame is the mirror image of the positive one.
fn frame_ticks_unchecked(frame: i128, rate: FrameRate) -> i128 {
    let numerator = i128::from(rate.numerator);
    let per_numerator = i128::from(TICKS_PER_SECOND) * i128::from(rate.denominator);
    let magnitude = frame.abs();
    let whole = magnitude / numerator;
    let rest = magnitude % numerator;
    let ticks = whole * per_numerator + (2 * rest * per_numerator + numerator) / (2 * numerator);
    if frame < 0 { -ticks } else { ticks }
}

/// Index of the frame whose interval contains `ticks`: the greatest `n` with `frameTime(n) ≤ ticks`.
fn frame_floor_unchecked(ticks: i128, rate: FrameRate) -> i128 {
    let numerator = i128::from(rate.numerator);
    let per_numerator = i128::from(TICKS_PER_SECOND) * i128::from(rate.denominator);
    let mut frame = (ticks * numerator).div_euclid(per_numerator);
    while frame_ticks_unchecked(frame, rate) > ticks {
        frame -= 1;
    }
    while frame_ticks_unchecked(frame + 1, rate) <= ticks {
        frame += 1;
    }
    frame
}

impl MediaTime {
    pub const ZERO: Self = Self(0);
    pub const ONE_TICK: Self = Self(1);

    pub const fn from_ticks(ticks: i64) -> Self {
        Self(ticks)
    }

    pub const fn as_ticks(self) -> i64 {
        self.0
    }

    /// A media time from a number that may not be an integer: the constructor of the JavaScript side.
    pub fn from_number(value: f64) -> TimeResult<Self> {
        if !value.is_finite() || value.fract() != 0.0 {
            return Err(TimeError::NonIntegerTicks);
        }
        if value.abs() > MAX_SAFE_TICKS as f64 {
            return Err(TimeError::OutOfRange);
        }
        Ok(Self(value as i64))
    }

    pub fn from_seconds_f64(seconds: f64) -> TimeResult<Self> {
        if !seconds.is_finite() {
            return Err(TimeError::OutOfRange);
        }
        let ticks = round_half_away(seconds * TICKS_PER_SECOND_F64);
        if ticks.abs() > MAX_SAFE_TICKS as f64 {
            return Err(TimeError::OutOfRange);
        }
        Ok(Self(ticks as i64))
    }

    pub fn to_seconds_f64(self) -> f64 {
        self.0 as f64 / TICKS_PER_SECOND_F64
    }

    pub fn from_frame(frame: i64, rate: FrameRate) -> TimeResult<Self> {
        let rate = rate.checked()?;
        in_range(frame_ticks_unchecked(i128::from(frame), rate)).map(Self)
    }

    /// Index of the frame that contains this time.
    pub fn to_frame(self, rate: FrameRate) -> TimeResult<i64> {
        let rate = rate.checked()?;
        in_range(frame_floor_unchecked(i128::from(self.0), rate))
    }

    /// Nearest frame boundary; a tie goes away from zero.
    pub fn round_to_frame(self, rate: FrameRate) -> TimeResult<Self> {
        let rate = rate.checked()?;
        let ticks = i128::from(self.0);
        let frame = frame_floor_unchecked(ticks, rate);
        let below = frame_ticks_unchecked(frame, rate);
        let above = frame_ticks_unchecked(frame + 1, rate);
        let (down, up) = (ticks - below, above - ticks);
        let snapped = if down < up || (down == up && ticks < 0) { below } else { above };
        in_range(snapped).map(Self)
    }

    pub fn floor_to_frame(self, rate: FrameRate) -> TimeResult<Self> {
        let rate = rate.checked()?;
        let frame = frame_floor_unchecked(i128::from(self.0), rate);
        in_range(frame_ticks_unchecked(frame, rate)).map(Self)
    }

    pub fn is_frame_aligned(self, rate: FrameRate) -> TimeResult<bool> {
        Ok(self.floor_to_frame(rate)? == self)
    }

    /// Start of the final frame fully contained in a duration; 0 when the duration is shorter than one frame.
    pub fn last_frame_time(self, rate: FrameRate) -> TimeResult<Self> {
        let rate = rate.checked()?;
        if self.0 <= 0 {
            return Ok(Self::ZERO);
        }
        let frame = frame_floor_unchecked(i128::from(self.0), rate);
        if frame < 1 {
            return Ok(Self::ZERO);
        }
        in_range(frame_ticks_unchecked(frame - 1, rate)).map(Self)
    }

    /// Clamps to `[0, lastFrameTime(duration)]`, then floors to a frame.
    pub fn snapped_seek_time(self, duration: Self, rate: FrameRate) -> TimeResult<Self> {
        let last = duration.last_frame_time(rate)?;
        self.clamp(Self::ZERO, last).floor_to_frame(rate)
    }

    pub fn checked_add(self, rhs: Self) -> TimeResult<Self> {
        in_range(i128::from(self.0) + i128::from(rhs.0)).map(Self)
    }

    pub fn checked_sub(self, rhs: Self) -> TimeResult<Self> {
        in_range(i128::from(self.0) - i128::from(rhs.0)).map(Self)
    }

    pub fn clamp(self, min: Self, max: Self) -> Self {
        Self(self.0.max(min.0).min(max.0))
    }

    pub fn min(self, other: Self) -> Self {
        Self(self.0.min(other.0))
    }

    pub fn max(self, other: Self) -> Self {
        Self(self.0.max(other.0))
    }
}

impl Add for MediaTime {
    type Output = Self;

    fn add(self, rhs: Self) -> Self::Output {
        Self(self.0 + rhs.0)
    }
}

impl Sub for MediaTime {
    type Output = Self;

    fn sub(self, rhs: Self) -> Self::Output {
        Self(self.0 - rhs.0)
    }
}

impl Neg for MediaTime {
    type Output = Self;

    fn neg(self) -> Self::Output {
        Self(-self.0)
    }
}

macro_rules! options {
    ($name:ident { $($field:ident : $kind:ty),+ $(,)? }) => {
        #[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
        #[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        pub struct $name {
            $(pub $field: $kind,)+
        }
    };
}

options!(MediaTimeOptions { value: f64 });
options!(MediaTimeFromSecondsOptions { seconds: f64 });
options!(MediaTimeToSecondsOptions { time: MediaTime });
options!(MediaTimeFromFrameOptions { frame: f64, rate: FrameRate });
options!(MediaTimeToFrameOptions { time: MediaTime, rate: FrameRate });
options!(RoundToFrameOptions { time: MediaTime, rate: FrameRate });
options!(FloorToFrameOptions { time: MediaTime, rate: FrameRate });
options!(IsFrameAlignedOptions { time: MediaTime, rate: FrameRate });
options!(LastFrameTimeOptions { duration: MediaTime, rate: FrameRate });
options!(SnappedSeekTimeOptions { time: MediaTime, duration: MediaTime, rate: FrameRate });
options!(MediaTimeAddOptions { lhs: MediaTime, rhs: MediaTime });
options!(MediaTimeSubOptions { lhs: MediaTime, rhs: MediaTime });
options!(MediaTimeMinOptions { lhs: MediaTime, rhs: MediaTime });
options!(MediaTimeMaxOptions { lhs: MediaTime, rhs: MediaTime });
options!(MediaTimeClampOptions { time: MediaTime, min: MediaTime, max: MediaTime });

/// Builds a media time from a number, refusing a fractional one with `time/non-integer-ticks`.
#[export]
pub fn media_time(MediaTimeOptions { value }: MediaTimeOptions) -> Result<MediaTime, String> {
    Ok(MediaTime::from_number(value)?)
}

#[export]
pub fn media_time_from_seconds(
    MediaTimeFromSecondsOptions { seconds }: MediaTimeFromSecondsOptions,
) -> Result<MediaTime, String> {
    Ok(MediaTime::from_seconds_f64(seconds)?)
}

#[export]
pub fn media_time_to_seconds(MediaTimeToSecondsOptions { time }: MediaTimeToSecondsOptions) -> f64 {
    time.to_seconds_f64()
}

#[export]
pub fn media_time_from_frame(
    MediaTimeFromFrameOptions { frame, rate }: MediaTimeFromFrameOptions,
) -> Result<MediaTime, String> {
    let frame = MediaTime::from_number(frame).map_err(|_| TimeError::OutOfRange)?;
    Ok(MediaTime::from_frame(frame.as_ticks(), rate)?)
}

/// The frame index is returned as a number: every valid index is a safe integer.
#[export]
pub fn media_time_to_frame(
    MediaTimeToFrameOptions { time, rate }: MediaTimeToFrameOptions,
) -> Result<f64, String> {
    Ok(time.to_frame(rate)? as f64)
}

#[export]
pub fn round_to_frame(
    RoundToFrameOptions { time, rate }: RoundToFrameOptions,
) -> Result<MediaTime, String> {
    Ok(time.round_to_frame(rate)?)
}

#[export]
pub fn floor_to_frame(
    FloorToFrameOptions { time, rate }: FloorToFrameOptions,
) -> Result<MediaTime, String> {
    Ok(time.floor_to_frame(rate)?)
}

#[export]
pub fn is_frame_aligned(
    IsFrameAlignedOptions { time, rate }: IsFrameAlignedOptions,
) -> Result<bool, String> {
    Ok(time.is_frame_aligned(rate)?)
}

#[export]
pub fn last_frame_time(
    LastFrameTimeOptions { duration, rate }: LastFrameTimeOptions,
) -> Result<MediaTime, String> {
    Ok(duration.last_frame_time(rate)?)
}

#[export]
pub fn snapped_seek_time(
    SnappedSeekTimeOptions {
        time,
        duration,
        rate,
    }: SnappedSeekTimeOptions,
) -> Result<MediaTime, String> {
    Ok(time.snapped_seek_time(duration, rate)?)
}

#[export]
pub fn media_time_add(
    MediaTimeAddOptions { lhs, rhs }: MediaTimeAddOptions,
) -> Result<MediaTime, String> {
    Ok(lhs.checked_add(rhs)?)
}

#[export]
pub fn media_time_sub(
    MediaTimeSubOptions { lhs, rhs }: MediaTimeSubOptions,
) -> Result<MediaTime, String> {
    Ok(lhs.checked_sub(rhs)?)
}

#[export]
pub fn media_time_min(MediaTimeMinOptions { lhs, rhs }: MediaTimeMinOptions) -> MediaTime {
    lhs.min(rhs)
}

#[export]
pub fn media_time_max(MediaTimeMaxOptions { lhs, rhs }: MediaTimeMaxOptions) -> MediaTime {
    lhs.max(rhs)
}

#[export]
pub fn media_time_clamp(
    MediaTimeClampOptions { time, min, max }: MediaTimeClampOptions,
) -> MediaTime {
    time.clamp(min, max)
}

#[cfg(test)]
mod tests {
    use crate::frame_rate::FrameRate;

    use super::{MediaTime, TICKS_PER_SECOND, TimeError};

    fn ticks(value: i64) -> MediaTime {
        MediaTime::from_ticks(value)
    }

    #[test]
    fn converts_between_seconds_and_ticks() {
        assert_eq!(MediaTime::from_seconds_f64(1.5), Ok(ticks(180_000)));
        assert_eq!(MediaTime::from_seconds_f64(3_600.0), Ok(ticks(432_000_000)));
        assert_eq!(ticks(180_000).to_seconds_f64(), 1.5);
        assert_eq!(TICKS_PER_SECOND, 120_000);
    }

    #[test]
    fn rejects_non_finite_seconds_and_fractional_ticks() {
        assert_eq!(MediaTime::from_seconds_f64(f64::NAN), Err(TimeError::OutOfRange));
        assert_eq!(MediaTime::from_seconds_f64(f64::INFINITY), Err(TimeError::OutOfRange));
        assert_eq!(MediaTime::from_number(1000.5), Err(TimeError::NonIntegerTicks));
        assert_eq!(MediaTime::from_number(1000.0), Ok(ticks(1000)));
    }

    #[test]
    fn frame_time_is_a_single_multiplication_at_59_94() {
        assert_eq!(MediaTime::from_frame(215_784, FrameRate::FPS_59_94), Ok(ticks(431_999_568)));
    }

    #[test]
    fn snaps_between_frames_at_30_fps() {
        let rate = FrameRate::FPS_30;
        assert_eq!(ticks(5_999).round_to_frame(rate), Ok(ticks(4_000)));
        assert_eq!(ticks(6_000).round_to_frame(rate), Ok(ticks(8_000)));
        assert_eq!(ticks(-6_000).round_to_frame(rate), Ok(ticks(-8_000)));
        assert_eq!(ticks(4_000 * 5 + 1).to_frame(rate), Ok(5));
        assert_eq!(ticks(-1).to_frame(rate), Ok(-1));
    }

    #[test]
    fn seeks_beyond_the_end_land_on_the_last_frame() {
        let rate = FrameRate::FPS_30;
        assert_eq!(ticks(600_000).last_frame_time(rate), Ok(ticks(596_000)));
        assert_eq!(ticks(598_000).last_frame_time(rate), Ok(ticks(592_000)));
        assert_eq!(ticks(3_999).last_frame_time(rate), Ok(ticks(0)));
        assert_eq!(ticks(1_000_000).snapped_seek_time(ticks(600_000), rate), Ok(ticks(596_000)));
    }

    #[test]
    fn uneven_rational_does_not_drift() {
        let rate = FrameRate::new(7, 1);
        for frame in 0..=100_000_i64 {
            let rest = frame % 7;
            let expected = (frame / 7) * 120_000 + (2 * rest * 120_000 + 7) / 14;
            assert_eq!(MediaTime::from_frame(frame, rate), Ok(ticks(expected)));
            // Exact value is frame × 120000 / 7; the error is at most half a tick.
            assert!((expected * 14 - frame * 120_000 * 2).abs() <= 7);
        }
    }

    #[test]
    fn rejects_rates_out_of_bounds_and_reduces_others() {
        assert_eq!(
            MediaTime::from_frame(1, FrameRate::new(2_000_003, 1)),
            Err(TimeError::InvalidFrameRate)
        );
        assert_eq!(MediaTime::from_frame(1, FrameRate::new(0, 1)), Err(TimeError::InvalidFrameRate));
        assert_eq!(
            MediaTime::from_frame(2_997, FrameRate::new(29_970_000, 1_000_000)),
            Ok(ticks(12_000_000))
        );
    }

    #[test]
    fn rejects_results_beyond_the_safe_integer_range() {
        assert_eq!(
            MediaTime::from_frame(9_007_199_254_740_991, FrameRate::new(1, 1_000_000)),
            Err(TimeError::OutOfRange)
        );
        assert_eq!(
            ticks(9_007_199_254_740_991).checked_add(ticks(1)),
            Err(TimeError::OutOfRange)
        );
    }
}
