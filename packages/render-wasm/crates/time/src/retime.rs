//! Retime maths: the map between element-local time and source time for constant rates, speed curves, reverse and
//! freeze. `packages/editor-core/src/time/retime.ts` is the same code in TypeScript; the two are held together by
//! the shared vectors, so every floating-point expression here keeps the operand order of its twin.

use bridge::export;
use serde::Deserialize;

use crate::frame_rate::FrameRate;
use crate::media_time::{MediaTime, TimeError, TimeResult, round_half_away};

const TABLE_INTERVALS: usize = 1024;
const MIN_CURVE_RATE: f64 = 0.1;
const MAX_CURVE_RATE: f64 = 10.0;

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize, Clone, Copy, Debug)]
pub struct CurvePoint {
    pub u: f64,
    pub rate: f64,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Retime {
    #[serde(default)]
    pub rate: Option<f64>,
    #[serde(default)]
    pub reverse: Option<bool>,
    /// The points of the speed curve; ignored when they do not form a valid curve.
    #[serde(default)]
    pub curve: Option<Vec<CurvePoint>>,
}

/// What the time map needs to know about an element: `S0`, the visible source span and the element duration.
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RetimeClip {
    pub source_start: MediaTime,
    pub source_span: MediaTime,
    pub duration: MediaTime,
    #[serde(default)]
    pub retime: Option<Retime>,
    #[serde(default)]
    pub freeze_source_time: Option<MediaTime>,
}

fn constant_rate(retime: Option<&Retime>) -> f64 {
    match retime.and_then(|retime| retime.rate) {
        Some(rate) if rate.is_finite() && rate > 0.0 => rate,
        _ => 1.0,
    }
}

fn is_reverse(retime: Option<&Retime>) -> bool {
    retime.and_then(|retime| retime.reverse).unwrap_or(false)
}

fn valid_curve(retime: Option<&Retime>) -> Option<&[CurvePoint]> {
    let points = retime?.curve.as_deref()?;
    if points.len() < 2 || points.len() > 32 {
        return None;
    }
    if points[0].u != 0.0 || points[points.len() - 1].u != 1.0 {
        return None;
    }
    for (index, point) in points.iter().enumerate() {
        if !point.u.is_finite() || !point.rate.is_finite() || point.rate <= 0.0 {
            return None;
        }
        if index > 0 && point.u <= points[index - 1].u {
            return None;
        }
    }
    Some(points)
}

/// Fritsch–Carlson tangents of the monotone cubic through the points.
fn tangents(points: &[CurvePoint]) -> Vec<f64> {
    let count = points.len();
    let mut secants = Vec::with_capacity(count - 1);
    for index in 0..count - 1 {
        secants.push((points[index + 1].rate - points[index].rate) / (points[index + 1].u - points[index].u));
    }
    let mut slopes = vec![0.0; count];
    slopes[0] = secants[0];
    slopes[count - 1] = secants[count - 2];
    for index in 1..count - 1 {
        let (before, after) = (secants[index - 1], secants[index]);
        slopes[index] = if before == 0.0 || after == 0.0 || (before < 0.0) != (after < 0.0) {
            0.0
        } else {
            (before + after) / 2.0
        };
    }
    for index in 0..count - 1 {
        let secant = secants[index];
        if secant == 0.0 {
            slopes[index] = 0.0;
            slopes[index + 1] = 0.0;
            continue;
        }
        let alpha = slopes[index] / secant;
        let beta = slopes[index + 1] / secant;
        let length = alpha * alpha + beta * beta;
        if length > 9.0 {
            let scale = 3.0 / length.sqrt();
            slopes[index] = scale * alpha * secant;
            slopes[index + 1] = scale * beta * secant;
        }
    }
    slopes
}

fn rate_at(points: &[CurvePoint], slopes: &[f64], u: f64) -> f64 {
    let mut index = 0;
    while index < points.len() - 2 && u > points[index + 1].u {
        index += 1;
    }
    let (from, to) = (points[index], points[index + 1]);
    let width = to.u - from.u;
    let t = (u - from.u) / width;
    let t2 = t * t;
    let t3 = t2 * t;
    let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
    let h10 = t3 - 2.0 * t2 + t;
    let h01 = 3.0 * t2 - 2.0 * t3;
    let h11 = t3 - t2;
    let rate = h00 * from.rate + h10 * width * slopes[index] + h01 * to.rate + h11 * width * slopes[index + 1];
    rate.max(MIN_CURVE_RATE).min(MAX_CURVE_RATE)
}

/// `T[k]`: the element-local tick at which the source position `k / 1024` of the span is reached.
fn time_table(points: &[CurvePoint], source_span: i64) -> Vec<i64> {
    let slopes = tangents(points);
    let span = source_span as f64;
    let mut table = Vec::with_capacity(TABLE_INTERVALS + 1);
    table.push(0);
    let mut sum = 0.0;
    let mut previous = 1.0 / rate_at(points, &slopes, 0.0);
    for node in 1..=TABLE_INTERVALS {
        let next = 1.0 / rate_at(points, &slopes, node as f64 / TABLE_INTERVALS as f64);
        sum += (previous + next) / 2048.0;
        previous = next;
        table.push(round_half_away(span * sum) as i64);
    }
    table
}

/// `U(τ)`: the fraction of the source span reached at element-local tick `tau`.
fn span_fraction(table: &[i64], tau: i64) -> f64 {
    if tau <= 0 {
        return 0.0;
    }
    if tau >= table[TABLE_INTERVALS] {
        return 1.0;
    }
    let (mut low, mut high) = (0, TABLE_INTERVALS - 1);
    while low < high {
        let middle = (low + high + 1) / 2;
        if table[middle] <= tau {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    let width = table[low + 1] - table[low];
    if width == 0 {
        return low as f64 / TABLE_INTERVALS as f64;
    }
    (low as f64 + (tau - table[low]) as f64 / width as f64) / TABLE_INTERVALS as f64
}

fn clamp(value: i64, min: i64, max: i64) -> i64 {
    value.max(min).min(max)
}

/// Element duration for a visible source span: the constant-rate quotient or the curve integral, snapped to the
/// nearest project frame with a minimum of one frame.
pub fn duration_of(source_span: MediaTime, retime: Option<&Retime>, frame_rate: FrameRate) -> TimeResult<MediaTime> {
    let span = source_span.as_ticks().max(0);
    let raw = match valid_curve(retime) {
        Some(points) => time_table(points, span)[TABLE_INTERVALS],
        None => round_half_away(span as f64 / constant_rate(retime)) as i64,
    };
    let one_frame = MediaTime::from_frame(1, frame_rate)?;
    let snapped = MediaTime::from_number(raw as f64)
        .map_err(|_| TimeError::OutOfRange)?
        .round_to_frame(frame_rate)?;
    Ok(snapped.max(one_frame))
}

pub fn source_time_of(clip: &RetimeClip, clip_time: MediaTime) -> MediaTime {
    if let Some(frozen) = clip.freeze_source_time {
        return frozen;
    }
    let retime = clip.retime.as_ref();
    let (start, span, duration) = (clip.source_start.as_ticks(), clip.source_span.as_ticks().max(0), clip.duration.as_ticks());
    let local = clamp(clip_time.as_ticks(), 0, duration);
    let tau = if is_reverse(retime) { duration - local } else { local };
    let offset = match valid_curve(retime) {
        Some(points) => round_half_away(span as f64 * span_fraction(&time_table(points, span), tau)) as i64,
        None => round_half_away(tau as f64 * constant_rate(retime)) as i64,
    };
    MediaTime::from_ticks(start + clamp(offset, 0, span))
}

pub fn clip_time_of(clip: &RetimeClip, source_time: MediaTime) -> MediaTime {
    if clip.freeze_source_time.is_some() {
        return MediaTime::ZERO;
    }
    let retime = clip.retime.as_ref();
    let (start, span, duration) = (clip.source_start.as_ticks(), clip.source_span.as_ticks().max(0), clip.duration.as_ticks());
    let offset = clamp(source_time.as_ticks() - start, 0, span);
    let tau = match valid_curve(retime) {
        Some(points) if span > 0 => {
            let table = time_table(points, span);
            let position = offset as f64 / span as f64 * TABLE_INTERVALS as f64;
            let node = (position.floor() as usize).min(TABLE_INTERVALS - 1);
            let within = position - node as f64;
            round_half_away(table[node] as f64 + (table[node + 1] - table[node]) as f64 * within) as i64
        }
        Some(_) => 0,
        None => round_half_away(offset as f64 / constant_rate(retime)) as i64,
    };
    let tau = clamp(tau, 0, duration);
    MediaTime::from_ticks(if is_reverse(retime) { duration - tau } else { tau })
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetimedDurationOptions {
    pub source_span: MediaTime,
    #[serde(default)]
    pub retime: Option<Retime>,
    pub rate: FrameRate,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceTimeAtOptions {
    pub element: RetimeClip,
    pub clip_time: MediaTime,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipTimeAtOptions {
    pub element: RetimeClip,
    pub source_time: MediaTime,
}

#[export]
pub fn retimed_duration(
    RetimedDurationOptions { source_span, retime, rate }: RetimedDurationOptions,
) -> Result<MediaTime, String> {
    Ok(duration_of(source_span, retime.as_ref(), rate)?)
}

#[export]
pub fn source_time_at(SourceTimeAtOptions { element, clip_time }: SourceTimeAtOptions) -> MediaTime {
    source_time_of(&element, clip_time)
}

#[export]
pub fn clip_time_at(ClipTimeAtOptions { element, source_time }: ClipTimeAtOptions) -> MediaTime {
    clip_time_of(&element, source_time)
}

#[cfg(test)]
mod tests {
    use super::{CurvePoint, Retime, RetimeClip, clip_time_of, duration_of, source_time_of};
    use crate::frame_rate::FrameRate;
    use crate::media_time::MediaTime;

    fn ticks(value: i64) -> MediaTime {
        MediaTime::from_ticks(value)
    }

    fn curve(points: &[(f64, f64)]) -> Retime {
        Retime {
            rate: None,
            reverse: None,
            curve: Some(points.iter().map(|&(u, rate)| CurvePoint { u, rate }).collect()),
        }
    }

    const HERO: [(f64, f64); 6] = [(0.0, 1.0), (0.2, 5.0), (0.4, 0.5), (0.6, 0.5), (0.8, 5.0), (1.0, 1.0)];

    #[test]
    fn constant_mapping_in_ticks() {
        let clip = RetimeClip {
            source_start: ticks(240_000),
            source_span: ticks(1_200_000),
            duration: ticks(600_000),
            retime: Some(Retime { rate: Some(2.0), reverse: None, curve: None }),
            freeze_source_time: None,
        };
        assert_eq!(source_time_of(&clip, ticks(120_000)), ticks(480_000));
        assert_eq!(clip_time_of(&clip, ticks(480_000)), ticks(120_000));
    }

    #[test]
    fn preset_durations_of_a_ten_second_source() {
        let presets: [(&[(f64, f64)], i64); 6] = [
            (&[(0.0, 0.9), (0.25, 0.9), (0.4, 6.0), (0.6, 6.0), (0.75, 0.4), (1.0, 0.4)], 328),
            (&HERO, 239),
            (&[(0.0, 5.5), (0.3, 5.5), (0.45, 0.5), (0.55, 0.5), (0.7, 5.5), (1.0, 5.5)], 146),
            (&[(0.0, 0.6), (0.3, 0.6), (0.45, 5.5), (0.55, 5.5), (0.7, 0.6), (1.0, 0.6)], 354),
            (&[(0.0, 5.5), (0.4, 5.5), (0.6, 1.0), (1.0, 1.0)], 167),
            (&[(0.0, 1.0), (0.4, 1.0), (0.6, 5.5), (1.0, 5.5)], 167),
        ];
        for (points, frames) in presets {
            let duration = duration_of(ticks(1_200_000), Some(&curve(points)), FrameRate::FPS_30).unwrap();
            let actual = duration.as_ticks() / 4_000;
            assert!((actual - frames).abs() <= 1, "expected {frames} frames, got {actual}");
        }
    }

    #[test]
    fn hero_inverse_is_within_one_tick() {
        let retime = curve(&HERO);
        let duration = duration_of(ticks(1_200_000), Some(&retime), FrameRate::FPS_30).unwrap();
        let clip = RetimeClip {
            source_start: ticks(0),
            source_span: ticks(1_200_000),
            duration,
            retime: Some(retime),
            freeze_source_time: None,
        };
        let mut time = 0;
        while time < duration.as_ticks() {
            let back = clip_time_of(&clip, source_time_of(&clip, ticks(time)));
            assert!((back.as_ticks() - time).abs() <= 1, "{time} came back as {}", back.as_ticks());
            time += 4_000;
        }
    }

    #[test]
    fn reverse_and_freeze() {
        let mut clip = RetimeClip {
            source_start: ticks(0),
            source_span: ticks(600_000),
            duration: ticks(600_000),
            retime: Some(Retime { rate: Some(1.0), reverse: Some(true), curve: None }),
            freeze_source_time: None,
        };
        assert_eq!(source_time_of(&clip, ticks(0)), ticks(600_000));
        assert_eq!(source_time_of(&clip, ticks(600_000)), ticks(0));
        clip.freeze_source_time = Some(ticks(360_000));
        assert_eq!(source_time_of(&clip, ticks(123)), ticks(360_000));
    }
}
