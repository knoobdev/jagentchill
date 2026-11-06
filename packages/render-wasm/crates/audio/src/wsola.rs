//! Waveform-similarity overlap-add (WSOLA): plays a signal at another speed without changing its pitch.
//!
//! The output is built from segments of the input, 40 ms long, laid down every 32 ms and joined over 8 ms.
//! Segment `k` is wanted at a nominal input position chosen by the caller (the retime map of a clip, so a constant
//! speed and a speed curve are the same thing here); it is taken from the place inside a 15 ms window around that
//! position where the input looks most like what would have followed the previous segment, so that the join does
//! not break a waveform. The engine is the caller's time map plus one number of state: where the previous segment
//! was taken from.

/// Segment length, 40 ms at 48 000 Hz.
pub const SEQUENCE: usize = 1920;
/// Width of the window a segment is sought in, 15 ms.
pub const SEEK: usize = 720;
/// Length of the join between two segments, 8 ms.
pub const OVERLAP: usize = 384;
/// Output frames a segment contributes: the sequence less its overlap with the next.
pub const HOP: usize = SEQUENCE - OVERLAP;

/// The correlation is taken on every fourth frame of the join: a 15 ms window is searched for the pitch period of
/// a signal, which needs no finer grid, and the best coarse offsets are then refined frame by frame.
const COARSE: usize = 4;

#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct Wsola {
    /// Input position the previous segment was taken from; `None` before the first segment.
    previous: Option<i64>,
}

/// A stereo input window: `left[i]` and `right[i]` are the input at position `base + i`; silence outside.
pub struct Input<'a> {
    pub left: &'a [f32],
    pub right: &'a [f32],
    pub base: i64,
}

impl Input<'_> {
    #[inline]
    fn at(&self, channel: &[f32], position: i64) -> f32 {
        let index = position - self.base;
        if index >= 0 && (index as usize) < channel.len() { channel[index as usize] } else { 0.0 }
    }
    #[inline]
    fn mono(&self, position: i64) -> f32 {
        self.at(self.left, position) + self.at(self.right, position)
    }
}

impl Wsola {
    pub fn new() -> Self {
        Self::default()
    }

    /// Starts over: the next segment is taken at its nominal position.
    pub fn reset(&mut self) {
        self.previous = None;
    }

    /// Continues from a known previous segment position (a checkpoint of an earlier run).
    pub fn resume(&mut self, previous: Option<i64>) {
        self.previous = previous;
    }

    pub fn previous(&self) -> Option<i64> {
        self.previous
    }

    /// The input range `[low, high)` that `process` reads for these nominal positions, given the current state.
    pub fn needed(&self, nominal: &[f64]) -> (i64, i64) {
        let half = (SEEK / 2) as i64;
        let (mut low, mut high) = (i64::MAX, i64::MIN);
        for &position in nominal {
            let position = position.round() as i64;
            low = low.min(position - half);
            // A segment found at the far end of the window, continued by one hop and one join.
            high = high.max(position + half + (HOP + OVERLAP) as i64);
        }
        if let Some(previous) = self.previous {
            low = low.min(previous + HOP as i64);
            high = high.max(previous + (HOP + OVERLAP) as i64);
        }
        if low > high { (0, 0) } else { (low, high) }
    }

    /// Produces `nominal.len()` hops of output: `HOP` frames per nominal position, into `left` and `right`.
    pub fn process(&mut self, input: &Input, nominal: &[f64], left: &mut [f32], right: &mut [f32]) {
        assert!(left.len() >= nominal.len() * HOP && right.len() >= nominal.len() * HOP, "output holds HOP frames per position");
        for (hop, &wanted) in nominal.iter().enumerate() {
            let wanted = wanted.round() as i64;
            let out = hop * HOP;
            let chosen = match self.previous {
                None => wanted,
                Some(previous) => {
                    let natural = previous + HOP as i64;
                    let chosen = seek(input, natural, wanted);
                    if chosen != natural {
                        // The join: what followed the previous segment fades into the new one.
                        for index in 0..OVERLAP {
                            let weight = (index as f32 + 0.5) / OVERLAP as f32;
                            let (from, to) = (natural + index as i64, chosen + index as i64);
                            left[out + index] = input.at(input.left, from) * (1.0 - weight) + input.at(input.left, to) * weight;
                            right[out + index] = input.at(input.right, from) * (1.0 - weight) + input.at(input.right, to) * weight;
                        }
                        for index in OVERLAP..HOP {
                            left[out + index] = input.at(input.left, chosen + index as i64);
                            right[out + index] = input.at(input.right, chosen + index as i64);
                        }
                        self.previous = Some(chosen);
                        continue;
                    }
                    chosen
                }
            };
            for index in 0..HOP {
                left[out + index] = input.at(input.left, chosen + index as i64);
                right[out + index] = input.at(input.right, chosen + index as i64);
            }
            self.previous = Some(chosen);
        }
    }
}

/// Normalised cross-correlation of the join at `candidate` with the join at `natural`, on a grid of `step` frames.
fn similarity(input: &Input, natural: i64, candidate: i64, step: usize) -> f64 {
    let (mut cross, mut energy) = (0.0f64, 0.0f64);
    let mut index = 0;
    while index < OVERLAP {
        let (a, b) = (input.mono(natural + index as i64) as f64, input.mono(candidate + index as i64) as f64);
        cross += a * b;
        energy += b * b;
        index += step;
    }
    cross / (energy + 1e-9).sqrt()
}

/// The position within the seek window around `wanted` whose join is most like the one at `natural`.
fn seek(input: &Input, natural: i64, wanted: i64) -> i64 {
    let half = (SEEK / 2) as i64;
    // The input simply continues when it may: unchanged speed is then the input itself, sample for sample.
    if (natural - wanted).abs() <= 1 {
        return natural;
    }
    let (mut best, mut best_score) = (wanted, f64::NEG_INFINITY);
    let mut offset = -half;
    while offset <= half {
        let score = similarity(input, natural, wanted + offset, COARSE);
        if score > best_score {
            best_score = score;
            best = wanted + offset;
        }
        offset += COARSE as i64;
    }
    // Refine around the coarse best on every frame.
    let centre = best;
    best_score = f64::NEG_INFINITY;
    for candidate in (centre - COARSE as i64 + 1).max(wanted - half)..=(centre + COARSE as i64 - 1).min(wanted + half) {
        let score = similarity(input, natural, candidate, 1);
        if score > best_score {
            best_score = score;
            best = candidate;
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f64 = 48_000.0;

    fn tone(frequency: f64, frames: usize) -> Vec<f32> {
        (0..frames).map(|frame| (2.0 * std::f64::consts::PI * frequency * frame as f64 / RATE).sin() as f32).collect()
    }

    /// Stretches `input` to `factor` times its length (speed `1 / factor`).
    fn stretch(input: &[f32], factor: f64) -> Vec<f32> {
        let hops = ((input.len() as f64 * factor) / HOP as f64).floor() as usize;
        let nominal: Vec<f64> = (0..hops).map(|hop| (hop * HOP) as f64 / factor).collect();
        let (mut left, mut right) = (vec![0.0; hops * HOP], vec![0.0; hops * HOP]);
        Wsola::new().process(&Input { left: input, right: input, base: 0 }, &nominal, &mut left, &mut right);
        left
    }

    /// Dominant frequency by counting upward zero crossings over the middle of the signal.
    fn frequency(signal: &[f32]) -> f64 {
        let (from, to) = (signal.len() / 8, signal.len() * 7 / 8);
        let crossings: Vec<f64> = (from..to).filter(|&index| signal[index - 1] <= 0.0 && signal[index] > 0.0)
            .map(|index| index as f64 - signal[index] as f64 / (signal[index] - signal[index - 1]) as f64).collect();
        (crossings.len() - 1) as f64 * RATE / (crossings[crossings.len() - 1] - crossings[0])
    }

    fn rms(signal: &[f32]) -> f64 {
        (signal.iter().map(|&value| (value as f64).powi(2)).sum::<f64>() / signal.len() as f64).sqrt()
    }

    #[test]
    fn unchanged_speed_is_the_input_itself() {
        let input = tone(440.0, 48_000);
        let output = stretch(&input, 1.0);
        assert_eq!(output[..], input[..output.len()]);
    }

    #[test]
    fn a_tone_keeps_its_pitch_and_level_at_every_speed() {
        for frequency_hz in [110.0, 440.0, 1000.0, 3000.0] {
            let input = tone(frequency_hz, 96_000);
            for factor in [0.25, 0.5, 0.8, 1.25, 2.0, 4.0] {
                let output = stretch(&input, factor);
                assert!((output.len() as f64 - 96_000.0 * factor).abs() <= HOP as f64, "length at factor {factor}");
                let measured = frequency(&output);
                assert!((measured / frequency_hz - 1.0).abs() < 0.01, "{frequency_hz} Hz at factor {factor} measured {measured}");
                // The joins neither cancel nor add: the level stays within 0.5 dB.
                let change = 20.0 * (rms(&output[HOP..output.len() - HOP]) / rms(&input)).log10();
                assert!(change.abs() < 0.5, "{frequency_hz} Hz at factor {factor}: level changed by {change} dB");
            }
        }
    }

    #[test]
    fn output_does_not_depend_on_how_it_is_cut_into_calls() {
        let input: Vec<f32> = (0..96_000).map(|frame| ((frame as f64 * 0.031).sin() * (frame as f64 * 0.0007).cos()) as f32).collect();
        let nominal: Vec<f64> = (0..40).map(|hop| (hop * HOP) as f64 * 1.7).collect();
        let whole = { let (mut l, mut r) = (vec![0.0; 40 * HOP], vec![0.0; 40 * HOP]); Wsola::new().process(&Input { left: &input, right: &input, base: 0 }, &nominal, &mut l, &mut r); l };
        let mut engine = Wsola::new();
        let mut parts = Vec::new();
        for chunk in nominal.chunks(7) {
            // Each call sees only the window it says it needs.
            let (low, high) = engine.needed(chunk);
            let window: Vec<f32> = (low..high).map(|position| if position >= 0 && (position as usize) < input.len() { input[position as usize] } else { 0.0 }).collect();
            let (mut l, mut r) = (vec![0.0; chunk.len() * HOP], vec![0.0; chunk.len() * HOP]);
            engine.process(&Input { left: &window, right: &window, base: low }, chunk, &mut l, &mut r);
            parts.extend(l);
        }
        assert_eq!(whole, parts);
    }

    #[test]
    fn channels_stay_aligned() {
        let left = tone(440.0, 48_000);
        let right: Vec<f32> = left.iter().map(|value| value * 0.5).collect();
        let nominal: Vec<f64> = (0..20).map(|hop| (hop * HOP) as f64 * 0.6).collect();
        let (mut l, mut r) = (vec![0.0; 20 * HOP], vec![0.0; 20 * HOP]);
        Wsola::new().process(&Input { left: &left, right: &right, base: 0 }, &nominal, &mut l, &mut r);
        for index in 0..l.len() { assert!((l[index] * 0.5 - r[index]).abs() < 1e-6); }
    }
}
