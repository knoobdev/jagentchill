#![cfg(target_arch = "wasm32")]

//! The audio crate as the engine calls it: the WSOLA time-stretch of `speed-retime.Pitch preservation`.
//!
//! Nothing is kept here between calls: the caller holds the one number of state (where the previous segment was
//! taken from), so a discarded wasm instance takes no stretch with it.

use audio::wsola::{Input, Wsola};
use wasm_bindgen::prelude::wasm_bindgen;

fn engine(previous: f64) -> Wsola {
    let mut engine = Wsola::new();
    engine.resume(if previous.is_finite() { Some(previous as i64) } else { None });
    engine
}

/// Output frames per nominal position.
#[wasm_bindgen(js_name = wsolaHop)]
pub fn wsola_hop() -> u32 {
    audio::HOP as u32
}

/// `[low, high)`: the input positions `wsolaProcess` reads for these nominal positions. `previous` is the position
/// the last segment was taken from, `NaN` before the first.
#[wasm_bindgen(js_name = wsolaNeeded)]
pub fn wsola_needed(nominal: &[f64], previous: f64) -> Vec<f64> {
    let (low, high) = engine(previous).needed(nominal);
    vec![low as f64, high as f64]
}

/// `left[i]` and `right[i]` are the input at position `base + i`. Returns `hop` frames per nominal position of
/// the left channel, then of the right channel, then one last value pair: the position the last segment was taken
/// from, split into its high part (multiples of 2^24) and its low part so that both are exact in an `f32`.
#[wasm_bindgen(js_name = wsolaProcess)]
pub fn wsola_process(left: &[f32], right: &[f32], base: f64, nominal: &[f64], previous: f64) -> Vec<f32> {
    let frames = nominal.len() * audio::HOP;
    let mut out = vec![0.0f32; frames * 2 + 2];
    let mut engine = engine(previous);
    {
        let (out_left, rest) = out.split_at_mut(frames);
        engine.process(&Input { left, right, base: base as i64 }, nominal, out_left, &mut rest[..frames]);
    }
    let last = engine.previous().unwrap_or(0);
    const SPLIT: i64 = 1 << 24;
    out[frames * 2] = last.div_euclid(SPLIT) as f32;
    out[frames * 2 + 1] = last.rem_euclid(SPLIT) as f32;
    out
}
